use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::types::agent_profile::AgentType;
use crate::types::agent_skill::{AgentSkillRecord, AgentSkillScope};

const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".worktrees",
];

#[derive(Debug, Default)]
pub struct SkillScanResult {
    pub skills: Vec<AgentSkillRecord>,
    pub errors: Vec<String>,
}

pub fn scan_global_skills(home_dir: Option<&Path>) -> Vec<AgentSkillRecord> {
    scan_global_skill_result(home_dir).skills
}

pub fn scan_global_skill_result(home_dir: Option<&Path>) -> SkillScanResult {
    let home_dir = home_dir
        .map(Path::to_path_buf)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from));

    let mut result = SkillScanResult::default();
    if let Some(home_dir) = home_dir {
        for root in [
            home_dir.join(".agents/skills"),
            home_dir.join(".codex/skills"),
            home_dir.join(".codex/superpowers/skills"),
        ] {
            result.append(scan_skill_root_result(
                &root,
                AgentType::Codex,
                AgentSkillScope::Global,
                None,
            ));
        }

        result.append(scan_skill_root_result(
            &home_dir.join(".claude/skills"),
            AgentType::Claude,
            AgentSkillScope::Global,
            None,
        ));
    }

    result.append(scan_skill_root_result(
        Path::new("/etc/codex/skills"),
        AgentType::Codex,
        AgentSkillScope::Global,
        None,
    ));
    sort_skills(&mut result.skills);
    result
}

pub fn scan_project_skills(project_id: i64, project_path: &Path) -> Vec<AgentSkillRecord> {
    let mut skills = Vec::new();

    for (root, agent_type) in find_project_skill_roots_with_types(project_path) {
        skills.extend(scan_skill_root(
            &root,
            agent_type,
            AgentSkillScope::Project,
            Some(project_id),
        ));
    }

    sort_skills(&mut skills);
    skills
}

pub fn scan_skill_root(
    root: &Path,
    agent_type: AgentType,
    scope: AgentSkillScope,
    project_id: Option<i64>,
) -> Vec<AgentSkillRecord> {
    scan_skill_root_result(root, agent_type, scope, project_id).skills
}

fn scan_skill_root_result(
    root: &Path,
    agent_type: AgentType,
    scope: AgentSkillScope,
    project_id: Option<i64>,
) -> SkillScanResult {
    if !root.is_dir() {
        return SkillScanResult::default();
    }

    let source_root = match root.canonicalize() {
        Ok(path) => path.to_string_lossy().to_string(),
        Err(error) => {
            return SkillScanResult {
                skills: Vec::new(),
                errors: vec![format!(
                    "无法解析 skill root {}: {}",
                    root.to_string_lossy(),
                    error
                )],
            };
        }
    };

    let mut skills = Vec::new();
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) => {
            return SkillScanResult {
                skills,
                errors: vec![format!("无法读取 skill root {}: {}", source_root, error)],
            };
        }
    };

    for entry in entries.flatten() {
        // 跟随符号链接：用户常把 .agents/skills 下的 skill 以软链放进 .claude/skills 等
        // root，应按所在 root 的 agent_type 识别，而不是跳过。broken symlink 等无法解析
        // 的条目由 metadata 返回 Err 直接跳过。
        let metadata = match fs::metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if !metadata.is_dir() {
            continue;
        }

        let skill_dir = entry.path();
        let skill_file = skill_dir.join("SKILL.md");
        if !skill_file.is_file() {
            continue;
        }

        let path = match skill_file.canonicalize() {
            Ok(path) => path.to_string_lossy().to_string(),
            Err(_) => continue,
        };
        let fallback_name = skill_dir
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string();
        if fallback_name.is_empty() {
            continue;
        }

        let name = fs::read_to_string(&skill_file)
            .ok()
            .and_then(|contents| frontmatter_name(&contents))
            .unwrap_or(fallback_name);

        skills.push(AgentSkillRecord {
            name,
            path,
            agent_type: agent_type.clone(),
            scope: scope.clone(),
            project_id,
            source_root: source_root.clone(),
        });
    }

    sort_skills(&mut skills);
    SkillScanResult {
        skills,
        errors: Vec::new(),
    }
}

impl SkillScanResult {
    fn append(&mut self, mut result: SkillScanResult) {
        self.skills.append(&mut result.skills);
        self.errors.append(&mut result.errors);
    }
}

pub fn find_project_skill_roots(project_path: &Path, suffix: &str) -> Vec<PathBuf> {
    let suffix = Path::new(suffix);
    let mut roots: Vec<PathBuf> = find_project_skill_roots_with_types(project_path)
        .into_iter()
        .map(|(root, _)| root)
        .filter(|root| root.ends_with(suffix))
        .collect();
    roots.sort();
    roots
}

fn find_project_skill_roots_with_types(project_path: &Path) -> Vec<(PathBuf, AgentType)> {
    let Ok(project_root) = project_path.canonicalize() else {
        return Vec::new();
    };

    let mut roots = Vec::new();
    let mut seen_dirs = HashSet::new();
    let mut seen_roots = HashSet::new();
    collect_project_skill_roots(
        &project_root,
        &project_root,
        &mut seen_dirs,
        &mut seen_roots,
        &mut roots,
    );
    roots.sort_by(|(left, _), (right, _)| left.cmp(right));
    roots
}

fn collect_project_skill_roots(
    current: &Path,
    project_root: &Path,
    seen_dirs: &mut HashSet<PathBuf>,
    seen_roots: &mut HashSet<PathBuf>,
    roots: &mut Vec<(PathBuf, AgentType)>,
) {
    let metadata = match fs::symlink_metadata(current) {
        Ok(metadata) => metadata,
        Err(_) => return,
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return;
    }

    let current = match current.canonicalize() {
        Ok(current) => current,
        Err(_) => return,
    };
    if !current.starts_with(project_root) || !seen_dirs.insert(current.clone()) {
        return;
    }

    if let Some(agent_type) = project_skill_root_agent_type(&current) {
        if seen_roots.insert(current.clone()) {
            roots.push((current, agent_type));
        }
        return;
    }

    let entries = match fs::read_dir(&current) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }

        let path = entry.path();
        if is_ignored_dir(&path) {
            continue;
        }
        collect_project_skill_roots(&path, project_root, seen_dirs, seen_roots, roots);
    }
}

fn project_skill_root_agent_type(path: &Path) -> Option<AgentType> {
    if path.ends_with(".agents/skills") || path.ends_with(".codex/skills") {
        Some(AgentType::Codex)
    } else if path.ends_with(".claude/skills") {
        Some(AgentType::Claude)
    } else {
        None
    }
}

fn is_ignored_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| IGNORED_DIRS.contains(&name))
        .unwrap_or(false)
}

fn frontmatter_name(contents: &str) -> Option<String> {
    let mut lines = contents.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }

    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            return None;
        }

        if let Some(value) = trimmed.strip_prefix("name:") {
            let name = trim_frontmatter_value(value);
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }

    None
}

fn trim_frontmatter_value(value: &str) -> &str {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'\'' && last == b'\'') || (first == b'"' && last == b'"') {
            return trimmed[1..trimmed.len() - 1].trim();
        }
    }
    trimmed
}

fn sort_skills(skills: &mut [AgentSkillRecord]) {
    skills.sort_by(|left, right| {
        left.source_root
            .cmp(&right.source_root)
            .then(left.path.cmp(&right.path))
    });
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use crate::types::agent_profile::AgentType;
    use crate::types::agent_skill::AgentSkillScope;

    use super::{
        find_project_skill_roots, scan_global_skills, scan_project_skills, scan_skill_root,
    };

    #[test]
    fn agent_skill_scanner_reads_frontmatter_name_and_falls_back_to_directory_name() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path().join("skills");
        write_skill(
            &root.join("frontmatter"),
            "---\nname: 'Review Skill'\ndescription: test\n---\nBody",
        );
        write_skill(&root.join("fallback-name"), "No frontmatter");

        let skills = scan_skill_root(&root, AgentType::Codex, AgentSkillScope::Global, None);

        assert_eq!(skills.len(), 2);
        assert!(skills.iter().any(|skill| skill.name == "Review Skill"));
        assert!(skills.iter().any(|skill| skill.name == "fallback-name"));
        assert!(skills
            .iter()
            .any(|skill| skill.path == canonical(&root.join("frontmatter").join("SKILL.md"))));
        assert!(skills
            .iter()
            .any(|skill| skill.path == canonical(&root.join("fallback-name").join("SKILL.md"))));
        assert!(skills
            .iter()
            .all(|skill| skill.source_root == canonical(&root)));
    }

    #[test]
    fn agent_skill_scanner_finds_nested_project_roots_and_skips_ignored_directories() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let project = temp_dir.path();
        write_skill(&project.join(".agents/skills/root-codex"), "Root Codex");
        write_skill(
            &project.join("packages/app/.agents/skills/nested-codex"),
            "Nested Codex",
        );
        write_skill(
            &project.join("node_modules/pkg/.agents/skills/ignored-codex"),
            "Ignored Codex",
        );

        let roots = find_project_skill_roots(project, ".agents/skills");
        let skills = scan_project_skills(7, project);

        assert!(roots.contains(&project.join(".agents/skills").canonicalize().unwrap()));
        assert!(roots.contains(
            &project
                .join("packages/app/.agents/skills")
                .canonicalize()
                .unwrap()
        ));
        assert!(!roots
            .iter()
            .any(|root| root.to_string_lossy().contains("node_modules")));
        assert!(skills.iter().any(|skill| skill.name == "root-codex"));
        assert!(skills.iter().any(|skill| skill.name == "nested-codex"));
        assert!(!skills.iter().any(|skill| skill.name == "ignored-codex"));
        assert!(skills
            .iter()
            .filter(|skill| skill.name.ends_with("codex"))
            .all(|skill| skill.agent_type == AgentType::Codex
                && skill.scope == AgentSkillScope::Project
                && skill.project_id == Some(7)));
    }

    #[cfg(unix)]
    #[test]
    fn agent_skill_scanner_does_not_follow_project_symlink_directories() {
        use std::os::unix::fs::symlink;

        let temp_dir = tempfile::tempdir().expect("temp dir");
        let project = temp_dir.path().join("project");
        let external = temp_dir.path().join("external");
        fs::create_dir_all(&project).expect("project dir");
        write_skill(&project.join(".agents/skills/local-codex"), "Local Codex");
        write_skill(
            &external.join(".agents/skills/external-codex"),
            "External Codex",
        );
        symlink(&external, project.join("linked-external")).expect("external symlink");

        let roots = find_project_skill_roots(&project, ".agents/skills");
        let skills = scan_project_skills(7, &project);

        assert!(roots.contains(&project.join(".agents/skills").canonicalize().unwrap()));
        assert!(!roots
            .iter()
            .any(|root| root.to_string_lossy().contains("external")));
        assert!(skills.iter().any(|skill| skill.name == "local-codex"));
        assert!(!skills.iter().any(|skill| skill.name == "external-codex"));
    }

    #[test]
    fn agent_skill_scanner_scans_codex_and_claude_global_roots() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let home = temp_dir.path();
        write_skill(&home.join(".agents/skills/codex-global"), "Codex Global");
        write_skill(&home.join(".claude/skills/claude-global"), "Claude Global");

        let skills = scan_global_skills(Some(home));

        assert!(skills.iter().any(|skill| {
            skill.name == "codex-global"
                && skill.agent_type == AgentType::Codex
                && skill.scope == AgentSkillScope::Global
        }));
        assert!(skills.iter().any(|skill| {
            skill.name == "claude-global"
                && skill.agent_type == AgentType::Claude
                && skill.scope == AgentSkillScope::Global
        }));
    }

    #[cfg(unix)]
    #[test]
    fn agent_skill_scanner_follows_symlinked_global_skill_per_root() {
        use std::os::unix::fs::symlink;

        let temp_dir = tempfile::tempdir().expect("temp dir");
        let home = temp_dir.path();
        // 真实 skill 位于 .agents/skills（Codex root）
        write_skill(&home.join(".agents/skills/implement"), "Implement");
        // .claude/skills/implement 以软链指向同一个 skill，应按所在 root 识别为 Claude
        fs::create_dir_all(home.join(".claude/skills")).expect("claude skills root");
        symlink(
            home.join(".agents/skills/implement"),
            home.join(".claude/skills/implement"),
        )
        .expect("symlink skill");

        let skills = scan_global_skills(Some(home));

        assert!(skills
            .iter()
            .any(|skill| skill.name == "implement" && skill.agent_type == AgentType::Claude));
        assert!(skills
            .iter()
            .any(|skill| skill.name == "implement" && skill.agent_type == AgentType::Codex));
    }

    fn write_skill(skill_dir: &Path, contents: &str) {
        fs::create_dir_all(skill_dir).expect("skill dir");
        fs::write(skill_dir.join("SKILL.md"), contents).expect("skill file");
    }

    fn canonical(path: &Path) -> String {
        path.canonicalize()
            .expect("canonical path")
            .to_string_lossy()
            .to_string()
    }
}
