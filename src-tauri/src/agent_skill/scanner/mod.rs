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
        for (root, agent_types) in global_skill_roots(&home_dir) {
            result.append(scan_skill_root_result(
                &root,
                agent_types,
                AgentSkillScope::Global,
                None,
            ));
        }
    }

    result.append(scan_skill_root_result(
        Path::new("/etc/codex/skills"),
        CODEX_ONLY_OWNERS,
        AgentSkillScope::Global,
        None,
    ));
    sort_skills(&mut result.skills);
    result
}

pub fn scan_project_skills(project_id: i64, project_path: &Path) -> Vec<AgentSkillRecord> {
    let mut skills = Vec::new();

    for (root, agent_types) in find_project_skill_roots_with_types(project_path) {
        skills.extend(scan_skill_root(
            &root,
            agent_types,
            AgentSkillScope::Project,
            Some(project_id),
        ));
    }

    sort_skills(&mut skills);
    skills
}

pub fn scan_skill_root(
    root: &Path,
    agent_types: &[AgentType],
    scope: AgentSkillScope,
    project_id: Option<i64>,
) -> Vec<AgentSkillRecord> {
    scan_skill_root_result(root, agent_types, scope, project_id).skills
}

fn scan_skill_root_result(
    root: &Path,
    agent_types: &[AgentType],
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

        for agent_type in agent_types {
            skills.push(AgentSkillRecord {
                name: name.clone(),
                path: path.clone(),
                agent_type: agent_type.clone(),
                scope: scope.clone(),
                project_id,
                source_root: source_root.clone(),
            });
        }
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

fn find_project_skill_roots_with_types(
    project_path: &Path,
) -> Vec<(PathBuf, &'static [AgentType])> {
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
    roots: &mut Vec<(PathBuf, &'static [AgentType])>,
) {
    // 先按入口路径后缀判定是否为已知 skill root：命中即按该 root 约定登记 agentType
    // 并停止下钻。判定在「是否下钻」之前完成，使 root 本身是软链（如
    // `.claude/skills -> ../.agents/skills`）时也能被跟随——agentType 由入口 root 约定
    // 决定（非 canonical 目标），同一物理技能可归属多个 Agent（ADR-0025）。
    if let Some(agent_types) = project_skill_root_agent_types(current) {
        // current 可能是软链；is_dir 跟随软链，broken symlink 等非目录直接放弃。
        if !current.is_dir() {
            return;
        }
        let resolved = match current.canonicalize() {
            Ok(resolved) => resolved,
            Err(_) => return,
        };
        // 软链 root 的目标必须落在项目内，避免越过项目边界扫描外部目录。
        if !resolved.starts_with(project_root) {
            return;
        }
        // 按入口路径去重：`.claude/skills` 软链与 `.agents/skills` 真实 root 入口不同，
        // 可共存为两条 root；存入 canonical 以维持 find_project_skill_roots 既有返回。
        if seen_roots.insert(current.to_path_buf()) {
            roots.push((resolved, agent_types));
        }
        return;
    }

    // 非 root：仅下钻真实目录。软链非 root 目录在下方 is_symlink 判定处返回不跟随，
    // 保留「不跟随任意项目软链」护栏（防环路、防经软链越出项目）。
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

    let entries = match fs::read_dir(&current) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        // 真实目录与软链都递归：软链若为已知 root 会在函数顶部被跟随，软链非 root
        // 则在下钻分支被跳过。
        if !file_type.is_dir() && !file_type.is_symlink() {
            continue;
        }

        let path = entry.path();
        if is_ignored_dir(&path) {
            continue;
        }
        collect_project_skill_roots(&path, project_root, seen_dirs, seen_roots, roots);
    }
}

const AGENTS_SHARED_OWNERS: &[AgentType] =
    &[AgentType::Codex, AgentType::OpenCode, AgentType::Grok];
const CLAUDE_SHARED_OWNERS: &[AgentType] =
    &[AgentType::Claude, AgentType::OpenCode, AgentType::Grok];
const CODEX_ONLY_OWNERS: &[AgentType] = &[AgentType::Codex];
const OPENCODE_ONLY_OWNERS: &[AgentType] = &[AgentType::OpenCode];
const GROK_ONLY_OWNERS: &[AgentType] = &[AgentType::Grok];

fn global_skill_roots(home_dir: &Path) -> Vec<(PathBuf, &'static [AgentType])> {
    vec![
        (home_dir.join(".agents/skills"), AGENTS_SHARED_OWNERS),
        (home_dir.join(".codex/skills"), CODEX_ONLY_OWNERS),
        (
            home_dir.join(".codex/superpowers/skills"),
            CODEX_ONLY_OWNERS,
        ),
        (home_dir.join(".claude/skills"), CLAUDE_SHARED_OWNERS),
        (
            home_dir.join(".config/opencode/skills"),
            OPENCODE_ONLY_OWNERS,
        ),
        (home_dir.join(".grok/skills"), GROK_ONLY_OWNERS),
    ]
}

fn project_skill_root_agent_types(path: &Path) -> Option<&'static [AgentType]> {
    if path.ends_with(".agents/skills") {
        Some(AGENTS_SHARED_OWNERS)
    } else if path.ends_with(".claude/skills") {
        Some(CLAUDE_SHARED_OWNERS)
    } else if path.ends_with(".codex/skills") {
        Some(CODEX_ONLY_OWNERS)
    } else if path.ends_with(".opencode/skills") {
        Some(OPENCODE_ONLY_OWNERS)
    } else if path.ends_with(".grok/skills") {
        Some(GROK_ONLY_OWNERS)
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
mod tests;
