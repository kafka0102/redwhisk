use super::*;
use crate::agent::command_detector::AgentCommandDetector;
use crate::db::connection::DatabaseConfig;
use crate::db::migrations::MigrationRunner;
use crate::types::agent_profile::SaveAgentProfileInput;
use rusqlite::Connection;

/// 测试用 detector：默认把任何命令视为已装（原样返回），不阻断 save/test 路径。
#[derive(Default, Clone)]
struct TestDetector;

impl AgentCommandDetector for TestDetector {
    fn detect_command(&self, command_name: &str) -> Result<String, String> {
        Ok(command_name.to_string())
    }

    fn test_command(&self, command: &str) -> Result<String, String> {
        Ok(command.to_string())
    }
}

#[test]
fn save_project_label_rejects_name_longer_than_fifteen_chars() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = test_database(temp_dir.path());
    let service = test_settings_service(&database.connection);
    let project_id = insert_project(&database.connection, "repo-a");

    let error = service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "1234567890abcdef".to_string(),
            scope: ProjectLabelScope::Project,
            project_id: Some(project_id),
            color: "#112233".to_string(),
            workflow_skill: None,
        })
        .expect_err("long label should fail");

    assert_eq!(error.code, CommandErrorCode::AgentProfileValidationFailed);
}

#[test]
fn save_project_label_rejects_duplicate_name_within_same_project() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = test_database(temp_dir.path());
    let service = test_settings_service(&database.connection);
    let project_id = insert_project(&database.connection, "repo-a");

    service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "ops".to_string(),
            scope: ProjectLabelScope::Project,
            project_id: Some(project_id),
            color: "#112233".to_string(),
            workflow_skill: None,
        })
        .expect("first label");

    let error = service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "ops".to_string(),
            scope: ProjectLabelScope::Project,
            project_id: Some(project_id),
            color: "#445566".to_string(),
            workflow_skill: None,
        })
        .expect_err("duplicate should fail");

    assert_eq!(error.code, CommandErrorCode::AgentProfileValidationFailed);
}

#[test]
fn save_global_label_rejects_duplicate_name_within_global_scope() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = test_database(temp_dir.path());
    let service = test_settings_service(&database.connection);

    service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "ops".to_string(),
            scope: ProjectLabelScope::Global,
            project_id: None,
            color: "#112233".to_string(),
            workflow_skill: None,
        })
        .expect("first global label");

    let error = service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "ops".to_string(),
            scope: ProjectLabelScope::Global,
            project_id: None,
            color: "#445566".to_string(),
            workflow_skill: None,
        })
        .expect_err("global duplicate should fail");

    assert_eq!(error.code, CommandErrorCode::AgentProfileValidationFailed);
}

#[test]
fn save_global_label_allows_same_name_present_in_project_scope() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = test_database(temp_dir.path());
    let service = test_settings_service(&database.connection);
    let project_id = insert_project(&database.connection, "repo-a");

    let project_label = service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "hotfix".to_string(),
            scope: ProjectLabelScope::Project,
            project_id: Some(project_id),
            color: "#112233".to_string(),
            workflow_skill: None,
        })
        .expect("project label");

    let global_label = service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "hotfix".to_string(),
            scope: ProjectLabelScope::Global,
            project_id: None,
            color: "#445566".to_string(),
            workflow_skill: None,
        })
        .expect("global label should coexist with project label");

    assert_eq!(global_label.scope, ProjectLabelScope::Global);
    assert_ne!(global_label.id, project_label.id);

    service
        .save_project_label(SaveProjectLabelInput {
            id: Some(global_label.id),
            name: "hotfix".to_string(),
            scope: ProjectLabelScope::Global,
            project_id: None,
            color: "#778899".to_string(),
            workflow_skill: None,
        })
        .expect("editing global label should succeed");
}

#[test]
fn save_project_label_allows_workflow_skill_without_agent() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = test_database(temp_dir.path());
    let service = test_settings_service(&database.connection);
    let project_id = insert_project(&database.connection, "repo-a");

    let saved = service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "ops".to_string(),
            scope: ProjectLabelScope::Project,
            project_id: Some(project_id),
            color: "#112233".to_string(),
            workflow_skill: Some(" skill-a ".to_string()),
        })
        .expect("workflow skill without agent should save");

    assert_eq!(saved.workflow_skill.as_deref(), Some("skill-a"));
}

#[test]
fn save_project_label_allows_same_name_in_other_project() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = test_database(temp_dir.path());
    let service = test_settings_service(&database.connection);
    let project_a = insert_project(&database.connection, "repo-a");
    let project_b = insert_project(&database.connection, "repo-b");

    service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "ops".to_string(),
            scope: ProjectLabelScope::Project,
            project_id: Some(project_a),
            color: "#112233".to_string(),
            workflow_skill: None,
        })
        .expect("project a label");

    let saved = service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "ops".to_string(),
            scope: ProjectLabelScope::Project,
            project_id: Some(project_b),
            color: "#445566".to_string(),
            workflow_skill: None,
        })
        .expect("project b label");

    assert_eq!(saved.name, "ops");
    assert_eq!(saved.project_id, Some(project_b));
}

#[test]
fn save_global_label_allows_no_agent_profile() {
    // agent_profile_id 字段已在 decouple-label-agent-skills 中移除；
    // global label 不再因绑定 project agent 而被拒绝。
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = test_database(temp_dir.path());
    let service = test_settings_service(&database.connection);
    let _project_id = insert_project(&database.connection, "repo-a");

    let saved = service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "release".to_string(),
            scope: ProjectLabelScope::Global,
            project_id: None,
            color: "#112233".to_string(),
            workflow_skill: None,
        })
        .expect("global label without agent profile should save");

    assert_eq!(saved.name, "release");
}

fn test_database(data_dir: &std::path::Path) -> crate::db::connection::Database {
    let database = DatabaseConfig::new(data_dir).open().expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    database
}

fn test_settings_service<'a>(connection: &'a Connection) -> SettingsService<'a, TestDetector> {
    SettingsService::new(
        AgentProfileRepository::new(connection),
        ProjectLabelRepository::new(connection),
        SavedAgentSkillRepository::new(connection),
        ProjectRepository::new(connection),
        TestDetector,
    )
}

fn insert_project(connection: &Connection, repo_name: &str) -> i64 {
    ProjectRepository::new(connection)
        .insert(repo_name, &format!("/tmp/{repo_name}"))
        .expect("project")
        .id
}

#[allow(dead_code)]
fn insert_agent_profile(
    service: &SettingsService<'_, TestDetector>,
    project_id: Option<i64>,
    scope: crate::types::agent_profile::AgentScope,
) -> i64 {
    service
        .save_agent_profile(SaveAgentProfileInput {
            id: None,
            name: format!("agent-{scope:?}"),
            agent_type: crate::types::agent_profile::AgentType::Codex,
            command: "codex".to_string(),
            scope,
            project_id,
            mode: "default".to_string(),
            dangerous: true,
            default_skill: "".to_string(),
            prompt_template: "".to_string(),
            display_mode: "json".to_string(),
            enabled: true,
        })
        .expect("agent profile")
        .id
}
