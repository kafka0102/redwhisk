use std::path::Path;

use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::db::saved_agent_skill_repository::{SavedAgentSkillRepository, SavedAgentSkillRow};
use crate::types::agent_profile::AgentType;
use crate::types::agent_skill::{AgentSkillRecord, AgentSkillScope};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::saved_agent_skill::SavedAgentSkillPath;

/// 按 Codex → Claude → OpenCode → Grok，再按 path 字典序规范化 skill_paths，便于稳定比较与写回。
pub fn normalize_skill_paths(paths: &[SavedAgentSkillPath]) -> Vec<SavedAgentSkillPath> {
    let mut normalized = paths.to_vec();
    normalized.sort_by(|left, right| {
        agent_type_rank(&left.agent_type)
            .cmp(&agent_type_rank(&right.agent_type))
            .then_with(|| left.path.cmp(&right.path))
    });
    normalized
}

/// 从当前扫描结果中按 name（忽略大小写）收集全部路径条目并规范化。
/// 无匹配时返回空 Vec（调用方应写回空路径，不删已添加行）。
pub fn skill_paths_from_scanned(
    scanned: &[AgentSkillRecord],
    name: &str,
) -> Vec<SavedAgentSkillPath> {
    let paths: Vec<SavedAgentSkillPath> = scanned
        .iter()
        .filter(|skill| skill.name.eq_ignore_ascii_case(name))
        .map(|skill| SavedAgentSkillPath {
            agent_type: skill.agent_type.clone(),
            path: skill.path.clone(),
        })
        .collect();
    normalize_skill_paths(&paths)
}

/// 比较规范化后的 skill_paths 是否一致。
pub fn skill_paths_equivalent(
    left: &[SavedAgentSkillPath],
    right: &[SavedAgentSkillPath],
) -> bool {
    normalize_skill_paths(left) == normalize_skill_paths(right)
}

/// 构建对账用扫描源。
///
/// - 全局 scope：仅全局快照
/// - 项目 scope：项目快照 ∪ 全局快照；合并键为 name + agentType，冲突时项目优先
///   （与 `AgentSkillIndex::list` 的内存合并语义一致）
pub fn scanned_skills_for_reconcile(
    scope: &AgentSkillScope,
    global_skills: &[AgentSkillRecord],
    project_skills: &[AgentSkillRecord],
) -> Vec<AgentSkillRecord> {
    match scope {
        AgentSkillScope::Global => global_skills.to_vec(),
        AgentSkillScope::Project => crate::agent_skill::index::merge_global_with_project(
            global_skills.to_vec(),
            project_skills.to_vec(),
        ),
    }
}

/// 规划需要对账写回的已添加技能：返回 (id, 规范化后的新 paths)。
/// 仅包含 skill_paths 相对当前扫描有变化的行。
pub fn plan_saved_skill_path_updates(
    saved: &[SavedAgentSkillRow],
    scanned: &[AgentSkillRecord],
) -> Vec<(i64, Vec<SavedAgentSkillPath>)> {
    let mut updates = Vec::new();
    for row in saved {
        let next_paths = skill_paths_from_scanned(scanned, &row.name);
        if !skill_paths_equivalent(&row.skill_paths, &next_paths) {
            updates.push((row.id, next_paths));
        }
    }
    updates
}

/// 将扫描结果对账到指定 scope 的已添加技能并写回 DB；返回变更行数。
pub fn reconcile_saved_skills_in_data_dir(
    data_dir: impl AsRef<Path>,
    scanned: &[AgentSkillRecord],
    scope: &AgentSkillScope,
    project_id: Option<i64>,
) -> Result<u32, CommandError> {
    let database = open_database(data_dir)?;
    let repository = SavedAgentSkillRepository::new(&database.connection);
    let saved = repository
        .list_skills(Some(scope), project_id)
        .map_err(database_error)?;
    let updates = plan_saved_skill_path_updates(&saved, scanned);

    for (id, skill_paths) in &updates {
        let Some(existing) = repository
            .find_skill_by_id(*id)
            .map_err(database_error)?
        else {
            continue;
        };
        repository
            .save_skill(
                Some(existing.id),
                &existing.name,
                &existing.scope,
                existing.project_id,
                skill_paths,
            )
            .map_err(database_error)?;
    }

    Ok(updates.len() as u32)
}

fn agent_type_rank(agent_type: &AgentType) -> u8 {
    match agent_type {
        AgentType::Codex => 0,
        AgentType::Claude => 1,
        AgentType::OpenCode => 2,
        AgentType::Grok => 3,
    }
}

fn open_database(data_dir: impl AsRef<Path>) -> Result<crate::db::connection::Database, CommandError> {
    let database = DatabaseConfig::new(data_dir)
        .open()
        .map_err(CommandError::from)?;
    MigrationRunner::default()
        .run(&database.connection)
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::SettingsPersistenceFailed,
                "设置保存失败。",
            )
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;
    Ok(database)
}

fn database_error(error: rusqlite::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::SettingsPersistenceFailed,
        "设置保存失败。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

#[cfg(test)]
#[path = "reconcile_tests.rs"]
mod tests;
