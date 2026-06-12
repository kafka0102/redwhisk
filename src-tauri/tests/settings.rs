use std::collections::HashMap;

use redwhisk_lib::agent::command_detector::AgentCommandDetector;
use redwhisk_lib::core::settings_service::SettingsService;
use redwhisk_lib::db::agent_profile_repository::AgentProfileRepository;
use redwhisk_lib::db::connection::DatabaseConfig;
use redwhisk_lib::db::migrations::MigrationRunner;
use redwhisk_lib::db::project_repository::ProjectRepository;
use redwhisk_lib::types::agent_profile::{
    AgentScope, AgentType, ListAgentProfilesInput, SaveAgentProfileInput, TestAgentCommandInput,
};
use redwhisk_lib::types::errors::CommandErrorCode;

#[test]
fn settings_migration_creates_restructured_agent_profiles_table() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");

    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");

    let profile_columns = table_columns(&database.connection, "agent_profiles");
    assert_eq!(
        profile_columns,
        vec![
            "id",
            "name",
            "agent_type",
            "command",
            "scope",
            "project_id",
            "mode",
            "dangerous",
            "default_skill",
            "prompt_template"
        ],
    );

    let override_exists: bool = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='project_agent_overrides'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .unwrap_or(false);
    assert!(
        !override_exists,
        "project_agent_overrides should be dropped"
    );
}

#[test]
fn save_global_agent_profile_resolves_command() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let service = settings_service(
        &database.connection,
        StubCommandDetector::with_test_result("codex", Ok("/usr/local/bin/codex")),
    );

    let profile = service
        .save_agent_profile(SaveAgentProfileInput {
            id: None,
            name: "  Codex Default  ".to_string(),
            agent_type: AgentType::Codex,
            command: " codex ".to_string(),
            scope: AgentScope::Global,
            project_id: None,
            mode: "full-auto".to_string(),
            dangerous: true,
            default_skill: "".to_string(),
            prompt_template: "".to_string(),
        })
        .expect("saved agent profile");

    assert!(profile.id > 0);
    assert_eq!(profile.name, "Codex Default");
    assert_eq!(profile.command, "/usr/local/bin/codex");
    assert_eq!(profile.scope, AgentScope::Global);
    assert_eq!(profile.mode, "full-auto");
    assert!(profile.dangerous);

    let stored_profiles = service
        .list_agent_profiles(ListAgentProfilesInput {
            scope: AgentScope::Global,
            project_id: None,
        })
        .expect("list profiles")
        .profiles;
    assert_eq!(stored_profiles, vec![profile]);
}

#[test]
fn settings_save_global_claude_agent_profile_persists_and_lists_profile() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let service = settings_service(
        &database.connection,
        StubCommandDetector::with_test_result("claude", Ok("/usr/local/bin/claude")),
    );

    let profile = service
        .save_agent_profile(SaveAgentProfileInput {
            id: None,
            name: "Claude Default".to_string(),
            agent_type: AgentType::Claude,
            command: "claude".to_string(),
            scope: AgentScope::Global,
            project_id: None,
            mode: "default".to_string(),
            dangerous: false,
            default_skill: "review".to_string(),
            prompt_template: "".to_string(),
        })
        .expect("saved claude agent profile");

    assert_eq!(profile.agent_type, AgentType::Claude);
    assert_eq!(profile.command, "/usr/local/bin/claude");

    let stored_profiles = service
        .list_agent_profiles(ListAgentProfilesInput {
            scope: AgentScope::Global,
            project_id: None,
        })
        .expect("list profiles")
        .profiles;
    assert_eq!(stored_profiles, vec![profile]);
}

#[test]
fn save_agent_profile_rejects_unavailable_command_without_persisting() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let service = settings_service(
        &database.connection,
        StubCommandDetector::with_test_result("codex", Err("codex not found")),
    );

    let error = service
        .save_agent_profile(SaveAgentProfileInput {
            id: None,
            name: "Codex".to_string(),
            agent_type: AgentType::Codex,
            command: "codex".to_string(),
            scope: AgentScope::Global,
            project_id: None,
            mode: "full-auto".to_string(),
            dangerous: true,
            default_skill: "".to_string(),
            prompt_template: "".to_string(),
        })
        .expect_err("should fail without executable command");

    assert_eq!(error.code, CommandErrorCode::AgentCommandUnavailable);

    let count: i64 = database
        .connection
        .query_row("SELECT COUNT(*) FROM agent_profiles", [], |row| row.get(0))
        .expect("profile count");
    assert_eq!(count, 0);
}

#[test]
fn test_agent_command_supports_manual_path_validation() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let service = settings_service(
        &database.connection,
        StubCommandDetector::with_test_result("/opt/codex/bin/codex", Ok("/opt/codex/bin/codex")),
    );

    let result = service
        .test_agent_command(TestAgentCommandInput {
            command: "/opt/codex/bin/codex".to_string(),
        })
        .expect("manual command should validate");

    assert_eq!(result.command, "/opt/codex/bin/codex");
}

#[test]
fn project_scope_agent_only_visible_to_target_project() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "redwhisk");
    let other_project_id = insert_project(&database.connection, "agents-lab");
    let service = settings_service(
        &database.connection,
        StubCommandDetector::with_test_result("/usr/local/bin/codex", Ok("/usr/local/bin/codex")),
    );

    let profile = service
        .save_agent_profile(SaveAgentProfileInput {
            id: None,
            name: "Project Codex".to_string(),
            agent_type: AgentType::Codex,
            command: "/usr/local/bin/codex".to_string(),
            scope: AgentScope::Project,
            project_id: Some(project_id),
            mode: "full-auto".to_string(),
            dangerous: false,
            default_skill: "".to_string(),
            prompt_template: "".to_string(),
        })
        .expect("saved project profile");

    assert_eq!(profile.scope, AgentScope::Project);
    assert_eq!(profile.project_id, Some(project_id));

    let project_profiles = service
        .list_agent_profiles(ListAgentProfilesInput {
            scope: AgentScope::Project,
            project_id: Some(project_id),
        })
        .expect("project profiles")
        .profiles;
    assert_eq!(project_profiles, vec![profile]);

    let other_profiles = service
        .list_agent_profiles(ListAgentProfilesInput {
            scope: AgentScope::Project,
            project_id: Some(other_project_id),
        })
        .expect("other project profiles")
        .profiles;
    assert!(other_profiles.is_empty());
}

struct StubCommandDetector {
    detect_result: Result<String, String>,
    test_results: HashMap<String, Result<String, String>>,
}

impl StubCommandDetector {
    fn with_test_result(command: &str, result: Result<&str, &str>) -> Self {
        let mut test_results = HashMap::new();
        test_results.insert(
            command.to_string(),
            result
                .map(|value| value.to_string())
                .map_err(|value| value.to_string()),
        );

        Self {
            detect_result: Err("unused detect result".to_string()),
            test_results,
        }
    }
}

impl AgentCommandDetector for StubCommandDetector {
    fn detect_codex_command(&self) -> Result<String, String> {
        self.detect_result.clone()
    }

    fn test_command(&self, command: &str) -> Result<String, String> {
        self.test_results
            .get(command)
            .cloned()
            .unwrap_or_else(|| Err(format!("unexpected command: {}", command)))
    }
}

fn settings_service<'connection>(
    connection: &'connection rusqlite::Connection,
    detector: StubCommandDetector,
) -> SettingsService<'connection, StubCommandDetector> {
    SettingsService::new(
        AgentProfileRepository::new(connection),
        ProjectRepository::new(connection),
        detector,
    )
}

fn migrated_database(data_dir: &std::path::Path) -> redwhisk_lib::db::connection::Database {
    let database = DatabaseConfig::new(data_dir).open().expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    database
}

fn insert_project(connection: &rusqlite::Connection, name: &str) -> i64 {
    connection
        .execute(
            "INSERT INTO projects (name, repo_path, created_at, last_opened_at, completion_policy)
             VALUES (?1, ?2, 1780624800000, 1780624800000, 'manual')",
            rusqlite::params![name, format!("/tmp/{}", name)],
        )
        .expect("insert project");
    connection.last_insert_rowid()
}

fn table_columns(connection: &rusqlite::Connection, table_name: &str) -> Vec<String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({})", table_name))
        .expect("table info");
    statement
        .query_map([], |row| row.get::<_, String>(1))
        .expect("query columns")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect columns")
}
