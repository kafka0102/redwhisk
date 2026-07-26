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
mod tests {
    use super::*;
    use crate::types::agent_profile::AgentType;
    use crate::types::agent_skill::{AgentSkillRecord, AgentSkillScope};

    #[test]
    fn normalize_skill_paths_orders_by_agent_then_path() {
        let paths = vec![
            path(AgentType::Grok, "/z"),
            path(AgentType::Codex, "/b"),
            path(AgentType::Codex, "/a"),
            path(AgentType::Claude, "/c"),
            path(AgentType::OpenCode, "/d"),
        ];

        assert_eq!(
            normalize_skill_paths(&paths),
            vec![
                path(AgentType::Codex, "/a"),
                path(AgentType::Codex, "/b"),
                path(AgentType::Claude, "/c"),
                path(AgentType::OpenCode, "/d"),
                path(AgentType::Grok, "/z"),
            ]
        );
    }

    #[test]
    fn skill_paths_from_scanned_collects_all_matching_names_case_insensitive() {
        let scanned = vec![
            scanned("Demo", AgentType::Codex, "/codex/demo"),
            scanned("other", AgentType::Claude, "/other"),
            scanned("demo", AgentType::OpenCode, "/opencode/demo"),
            scanned("DEMO", AgentType::Grok, "/grok/demo"),
        ];

        assert_eq!(
            skill_paths_from_scanned(&scanned, "demo"),
            vec![
                path(AgentType::Codex, "/codex/demo"),
                path(AgentType::OpenCode, "/opencode/demo"),
                path(AgentType::Grok, "/grok/demo"),
            ]
        );
    }

    #[test]
    fn skill_paths_from_scanned_returns_empty_when_name_missing() {
        let scanned = vec![scanned("kept", AgentType::Codex, "/kept")];
        assert!(skill_paths_from_scanned(&scanned, "missing").is_empty());
    }

    #[test]
    fn plan_updates_when_paths_added_removed_or_changed() {
        let saved = vec![
            row(
                1,
                "alpha",
                vec![path(AgentType::Codex, "/old-alpha")],
            ),
            row(
                2,
                "beta",
                vec![
                    path(AgentType::Claude, "/beta-claude"),
                    path(AgentType::Codex, "/beta-codex"),
                ],
            ),
            row(3, "gone", vec![path(AgentType::Grok, "/gone")]),
            row(
                4,
                "same",
                vec![
                    path(AgentType::OpenCode, "/same-b"),
                    path(AgentType::Codex, "/same-a"),
                ],
            ),
        ];
        let scanned = vec![
            scanned("alpha", AgentType::Codex, "/new-alpha"),
            scanned("alpha", AgentType::Claude, "/alpha-claude"),
            scanned("beta", AgentType::Codex, "/beta-codex"),
            // beta loses Claude; same keeps both paths but different order in saved
            scanned("same", AgentType::Codex, "/same-a"),
            scanned("same", AgentType::OpenCode, "/same-b"),
        ];

        let updates = plan_saved_skill_path_updates(&saved, &scanned);

        assert_eq!(updates.len(), 3);
        assert_eq!(
            updates
                .iter()
                .map(|(id, _)| *id)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(
            updates[0].1,
            vec![
                path(AgentType::Codex, "/new-alpha"),
                path(AgentType::Claude, "/alpha-claude"),
            ]
        );
        assert_eq!(updates[1].1, vec![path(AgentType::Codex, "/beta-codex")]);
        assert!(updates[2].1.is_empty());
    }

    #[test]
    fn plan_keeps_row_with_empty_paths_when_scan_has_no_match() {
        let saved = vec![row(9, "orphan", vec![path(AgentType::Codex, "/x")])];
        let updates = plan_saved_skill_path_updates(&saved, &[]);
        assert_eq!(updates, vec![(9, Vec::new())]);
    }

    #[test]
    fn plan_counts_zero_when_only_order_differs() {
        let saved = vec![row(
            1,
            "same",
            vec![
                path(AgentType::Grok, "/g"),
                path(AgentType::Codex, "/c"),
            ],
        )];
        let scanned = vec![
            scanned("same", AgentType::Codex, "/c"),
            scanned("same", AgentType::Grok, "/g"),
        ];
        assert!(plan_saved_skill_path_updates(&saved, &scanned).is_empty());
    }

    #[test]
    fn reconcile_writes_empty_paths_and_returns_changed_count() {
        let temp = tempfile::tempdir().expect("temp");
        let database = DatabaseConfig::new(temp.path()).open().expect("db");
        MigrationRunner::default()
            .run(&database.connection)
            .expect("migrate");
        let repository = SavedAgentSkillRepository::new(&database.connection);
        let kept = repository
            .save_skill(
                None,
                "kept",
                &AgentSkillScope::Global,
                None,
                &[path(AgentType::Codex, "/old")],
            )
            .expect("save kept");
        let missing = repository
            .save_skill(
                None,
                "missing",
                &AgentSkillScope::Global,
                None,
                &[path(AgentType::Claude, "/gone")],
            )
            .expect("save missing");
        drop(repository);
        drop(database);

        let scanned = vec![
            scanned("kept", AgentType::Codex, "/new"),
            scanned("kept", AgentType::OpenCode, "/opencode"),
        ];
        let changed = reconcile_saved_skills_in_data_dir(
            temp.path(),
            &scanned,
            &AgentSkillScope::Global,
            None,
        )
        .expect("reconcile");

        assert_eq!(changed, 2);

        let database = DatabaseConfig::new(temp.path()).open().expect("db");
        let repository = SavedAgentSkillRepository::new(&database.connection);
        let kept_row = repository.find_skill_by_id(kept.id).expect("read").unwrap();
        let missing_row = repository
            .find_skill_by_id(missing.id)
            .expect("read")
            .unwrap();
        assert_eq!(
            kept_row.skill_paths,
            vec![
                path(AgentType::Codex, "/new"),
                path(AgentType::OpenCode, "/opencode"),
            ]
        );
        assert!(missing_row.skill_paths.is_empty());
        assert_eq!(missing_row.del, 0);
    }

    fn path(agent_type: AgentType, path: &str) -> SavedAgentSkillPath {
        SavedAgentSkillPath {
            agent_type,
            path: path.to_string(),
        }
    }

    fn scanned(name: &str, agent_type: AgentType, path: &str) -> AgentSkillRecord {
        AgentSkillRecord {
            name: name.to_string(),
            path: path.to_string(),
            agent_type,
            scope: AgentSkillScope::Global,
            project_id: None,
            source_root: "/root".to_string(),
        }
    }

    fn row(id: i64, name: &str, skill_paths: Vec<SavedAgentSkillPath>) -> SavedAgentSkillRow {
        SavedAgentSkillRow {
            id,
            name: name.to_string(),
            scope: AgentSkillScope::Global,
            project_id: None,
            skill_paths,
            del: 0,
        }
    }
}
