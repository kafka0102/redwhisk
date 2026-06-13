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

pub fn scan_global_skills(home_dir: Option<&Path>) -> Vec<AgentSkillRecord> {
    let home_dir = home_dir
        .map(Path::to_path_buf)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from));

    let mut skills = Vec::new();
    if let Some(home_dir) = home_dir {
        for root in [
            home_dir.join(".agents/skills"),
            home_dir.join(".codex/skills"),
            home_dir.join(".codex/superpowers/skills"),
        ] {
            skills.extend(scan_skill_root(
                &root,
                AgentType::Codex,
                AgentSkillScope::Global,
                None,
            ));
        }

        skills.extend(scan_skill_root(
            &home_dir.join(".claude/skills"),
            AgentType::Claude,
            AgentSkillScope::Global,
            None,
        ));
    }

    skills.extend(scan_skill_root(
        Path::new("/etc/codex/skills"),
        AgentType::Codex,
        AgentSkillScope::Global,
        None,
    ));
    sort_skills(&mut skills);
    skills
}

pub fn scan_project_skills(project_id: i64, project_path: &Path) -> Vec<AgentSkillRecord> {
    let mut skills = Vec::new();

    for suffix in [".agents/skills", ".codex/skills"] {
        for root in find_project_skill_roots(project_path, suffix) {
            skills.extend(scan_skill_root(
                &root,
                AgentType::Codex,
                AgentSkillScope::Project,
                Some(project_id),
            ));
        }
    }

    for root in find_project_skill_roots(project_path, ".claude/skills") {
        skills.extend(scan_skill_root(
            &root,
            AgentType::Claude,
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
    if !root.is_dir() {
        return Vec::new();
    }

    let source_root = match root.canonicalize() {
        Ok(path) => path.to_string_lossy().to_string(),
        Err(_) => return Vec::new(),
    };

    let mut skills = Vec::new();
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    for entry in entries.flatten() {
        let skill_dir = entry.path();
        if !skill_dir.is_dir() {
            continue;
        }

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
    skills
}

pub fn find_project_skill_roots(project_path: &Path, suffix: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut seen = HashSet::new();
    let suffix = Path::new(suffix);
    collect_project_skill_roots(project_path, suffix, &mut seen, &mut roots);
    roots.sort();
    roots
}

fn collect_project_skill_roots(
    current: &Path,
    suffix: &Path,
    seen: &mut HashSet<PathBuf>,
    roots: &mut Vec<PathBuf>,
) {
    if !current.is_dir() {
        return;
    }

    if current.ends_with(suffix) {
        if let Ok(root) = current.canonicalize() {
            if seen.insert(root.clone()) {
                roots.push(root);
            }
        }
        return;
    }

    let entries = match fs::read_dir(current) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || is_ignored_dir(&path) {
            continue;
        }
        collect_project_skill_roots(&path, suffix, seen, roots);
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
