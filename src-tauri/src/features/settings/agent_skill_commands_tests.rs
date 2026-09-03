use crate::agent_skill::index::AgentSkillIndex;
use crate::agent_skill::reconcile::{
    reconcile_saved_skills_in_data_dir, scanned_skills_for_reconcile,
};
use crate::agent_skill::service::AgentSkillService;
use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::db::saved_agent_skill_repository::SavedAgentSkillRepository;
use crate::types::agent_profile::AgentType;
use crate::types::agent_skill::{AgentSkillRecord, AgentSkillScope, ListAgentSkillsInput};
use crate::types::saved_agent_skill::SavedAgentSkillPath;
use std::fs;
use std::path::Path;

use super::list_agent_skills_from_index;

#[test]
fn agent_skill_command_list_reads_only_cached_index() {
    let index = AgentSkillIndex::default();
    index.replace_global(vec![AgentSkillRecord {
        name: "cached".to_string(),
        path: "/tmp/cached/SKILL.md".to_string(),
        agent_type: AgentType::Codex,
        scope: AgentSkillScope::Global,
        project_id: None,
        source_root: "/tmp/cached".to_string(),
    }]);

    let response = list_agent_skills_from_index(
        &index,
        ListAgentSkillsInput {
            agent_type: Some(AgentType::Codex),
            project_id: None,
        },
    );

    assert_eq!(response.skills.len(), 1);
    assert_eq!(response.skills[0].name, "cached");
}

#[test]
fn refresh_and_reconcile_updates_global_and_project_saved_skills() {
    let home = tempfile::tempdir().expect("home");
    let project_dir = tempfile::tempdir().expect("project");
    let data_dir = tempfile::tempdir().expect("data");

    write_skill(&home.path().join(".agents/skills/global-skill"));
    write_skill(&project_dir.path().join(".claude/skills/project-skill"));

    let database = DatabaseConfig::new(data_dir.path()).open().expect("db");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrate");
    let repository = SavedAgentSkillRepository::new(&database.connection);
    repository
        .save_skill(
            None,
            "global-skill",
            &AgentSkillScope::Global,
            None,
            &[SavedAgentSkillPath {
                agent_type: AgentType::Codex,
                path: "/stale-global".to_string(),
            }],
        )
        .expect("save global");
    repository
        .save_skill(
            None,
            "project-skill",
            &AgentSkillScope::Project,
            Some(42),
            &[SavedAgentSkillPath {
                agent_type: AgentType::Claude,
                path: "/stale-project".to_string(),
            }],
        )
        .expect("save project");
    repository
        .save_skill(
            None,
            "missing-global",
            &AgentSkillScope::Global,
            None,
            &[SavedAgentSkillPath {
                agent_type: AgentType::Grok,
                path: "/gone".to_string(),
            }],
        )
        .expect("save missing");
    drop(repository);
    drop(database);

    // refresh_global_from_home 使用真实 home；此处用 index 手动模拟扫描后对账路径，
    // 并用 service 刷新 project；全局扫描改走 index 注入以隔离环境 HOME。
    let index = AgentSkillIndex::default();
    // 直接注入全局扫描结果，避免依赖进程 HOME
    index.replace_global(vec![
        AgentSkillRecord {
            name: "global-skill".to_string(),
            path: home
                .path()
                .join(".agents/skills/global-skill/SKILL.md")
                .to_string_lossy()
                .to_string(),
            agent_type: AgentType::Codex,
            scope: AgentSkillScope::Global,
            project_id: None,
            source_root: home
                .path()
                .join(".agents/skills")
                .to_string_lossy()
                .to_string(),
        },
        AgentSkillRecord {
            name: "global-skill".to_string(),
            path: home
                .path()
                .join(".agents/skills/global-skill/SKILL.md")
                .to_string_lossy()
                .to_string(),
            agent_type: AgentType::OpenCode,
            scope: AgentSkillScope::Global,
            project_id: None,
            source_root: home
                .path()
                .join(".agents/skills")
                .to_string_lossy()
                .to_string(),
        },
        AgentSkillRecord {
            name: "global-skill".to_string(),
            path: home
                .path()
                .join(".agents/skills/global-skill/SKILL.md")
                .to_string_lossy()
                .to_string(),
            agent_type: AgentType::Grok,
            scope: AgentSkillScope::Global,
            project_id: None,
            source_root: home
                .path()
                .join(".agents/skills")
                .to_string_lossy()
                .to_string(),
        },
    ]);

    let global_changed = reconcile_saved_skills_in_data_dir(
        data_dir.path(),
        &index.snapshot_global(),
        &AgentSkillScope::Global,
        None,
    )
    .expect("global reconcile");
    AgentSkillService::refresh_project(&index, 42, project_dir.path());
    let project_scanned = scanned_skills_for_reconcile(
        &AgentSkillScope::Project,
        &index.snapshot_global(),
        &index.snapshot_project(42),
    );
    let project_changed = reconcile_saved_skills_in_data_dir(
        data_dir.path(),
        &project_scanned,
        &AgentSkillScope::Project,
        Some(42),
    )
    .expect("project reconcile");

    assert_eq!(global_changed + project_changed, 3);

    let database = DatabaseConfig::new(data_dir.path()).open().expect("db");
    let repository = SavedAgentSkillRepository::new(&database.connection);
    let global = repository
        .list_skills(Some(&AgentSkillScope::Global), None)
        .expect("list global");
    let project = repository
        .list_skills(Some(&AgentSkillScope::Project), Some(42))
        .expect("list project");

    let global_skill = global
        .iter()
        .find(|row| row.name == "global-skill")
        .expect("global skill");
    assert!(global_skill
        .skill_paths
        .iter()
        .any(|entry| entry.agent_type == AgentType::Codex));
    assert!(global_skill
        .skill_paths
        .iter()
        .any(|entry| entry.agent_type == AgentType::OpenCode));
    let missing = global
        .iter()
        .find(|row| row.name == "missing-global")
        .expect("missing");
    assert!(missing.skill_paths.is_empty());
    assert_eq!(missing.del, 0);

    let project_skill = project
        .iter()
        .find(|row| row.name == "project-skill")
        .expect("project skill");
    assert!(project_skill.skill_paths.iter().any(|entry| {
        entry.agent_type == AgentType::Claude && entry.path.contains("project-skill")
    }));

    // 规范化后再次对账应计 0
    let again_global = reconcile_saved_skills_in_data_dir(
        data_dir.path(),
        &index.snapshot_global(),
        &AgentSkillScope::Global,
        None,
    )
    .expect("again global");
    let again_project_scanned = scanned_skills_for_reconcile(
        &AgentSkillScope::Project,
        &index.snapshot_global(),
        &index.snapshot_project(42),
    );
    let again_project = reconcile_saved_skills_in_data_dir(
        data_dir.path(),
        &again_project_scanned,
        &AgentSkillScope::Project,
        Some(42),
    )
    .expect("again project");
    assert_eq!(again_global + again_project, 0);
}

#[test]
fn project_reconcile_fills_paths_from_global_when_absent_in_project() {
    let data_dir = tempfile::tempdir().expect("data");
    let database = DatabaseConfig::new(data_dir.path()).open().expect("db");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrate");
    let repository = SavedAgentSkillRepository::new(&database.connection);
    repository
        .save_skill(
            None,
            "shared-skill",
            &AgentSkillScope::Project,
            Some(7),
            &[],
        )
        .expect("save project skill empty paths");
    drop(repository);
    drop(database);

    let index = AgentSkillIndex::default();
    index.replace_global(vec![AgentSkillRecord {
        name: "shared-skill".to_string(),
        path: "/home/u/.agents/skills/shared-skill/SKILL.md".to_string(),
        agent_type: AgentType::Codex,
        scope: AgentSkillScope::Global,
        project_id: None,
        source_root: "/home/u/.agents/skills".to_string(),
    }]);
    // 项目扫描未检出该 skill
    index.replace_project(7, vec![]);

    let scanned = scanned_skills_for_reconcile(
        &AgentSkillScope::Project,
        &index.snapshot_global(),
        &index.snapshot_project(7),
    );
    let changed = reconcile_saved_skills_in_data_dir(
        data_dir.path(),
        &scanned,
        &AgentSkillScope::Project,
        Some(7),
    )
    .expect("project reconcile with global fallback");
    assert_eq!(changed, 1);

    let database = DatabaseConfig::new(data_dir.path()).open().expect("db");
    let repository = SavedAgentSkillRepository::new(&database.connection);
    let rows = repository
        .list_skills(Some(&AgentSkillScope::Project), Some(7))
        .expect("list");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].name, "shared-skill");
    assert_eq!(rows[0].del, 0);
    assert_eq!(
        rows[0].skill_paths,
        vec![SavedAgentSkillPath {
            agent_type: AgentType::Codex,
            path: "/home/u/.agents/skills/shared-skill/SKILL.md".to_string(),
        }]
    );
}

#[test]
fn project_reconcile_prefers_project_path_when_global_has_same_key() {
    let data_dir = tempfile::tempdir().expect("data");
    let database = DatabaseConfig::new(data_dir.path()).open().expect("db");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrate");
    let repository = SavedAgentSkillRepository::new(&database.connection);
    repository
        .save_skill(
            None,
            "review",
            &AgentSkillScope::Project,
            Some(7),
            &[SavedAgentSkillPath {
                agent_type: AgentType::Codex,
                path: "/stale".to_string(),
            }],
        )
        .expect("save");
    drop(repository);
    drop(database);

    let index = AgentSkillIndex::default();
    index.replace_global(vec![AgentSkillRecord {
        name: "review".to_string(),
        path: "/global/review/SKILL.md".to_string(),
        agent_type: AgentType::Codex,
        scope: AgentSkillScope::Global,
        project_id: None,
        source_root: "/global".to_string(),
    }]);
    index.replace_project(
        7,
        vec![AgentSkillRecord {
            name: "review".to_string(),
            path: "/project/review/SKILL.md".to_string(),
            agent_type: AgentType::Codex,
            scope: AgentSkillScope::Project,
            project_id: Some(7),
            source_root: "/project".to_string(),
        }],
    );

    let scanned = scanned_skills_for_reconcile(
        &AgentSkillScope::Project,
        &index.snapshot_global(),
        &index.snapshot_project(7),
    );
    let changed = reconcile_saved_skills_in_data_dir(
        data_dir.path(),
        &scanned,
        &AgentSkillScope::Project,
        Some(7),
    )
    .expect("reconcile");
    assert_eq!(changed, 1);

    let database = DatabaseConfig::new(data_dir.path()).open().expect("db");
    let repository = SavedAgentSkillRepository::new(&database.connection);
    let rows = repository
        .list_skills(Some(&AgentSkillScope::Project), Some(7))
        .expect("list");
    assert_eq!(
        rows[0].skill_paths,
        vec![SavedAgentSkillPath {
            agent_type: AgentType::Codex,
            path: "/project/review/SKILL.md".to_string(),
        }]
    );
}

fn write_skill(skill_dir: &Path) {
    fs::create_dir_all(skill_dir).expect("skill dir");
    fs::write(skill_dir.join("SKILL.md"), "skill").expect("skill file");
}
