use std::collections::HashMap;

use redwhisk_lib::agent::command_detector::AgentCommandDetector;
use redwhisk_lib::core::settings_service::SettingsService;
use redwhisk_lib::core::user_profile_service::UserProfileService;
use redwhisk_lib::db::agent_profile_repository::AgentProfileRepository;
use redwhisk_lib::db::connection::DatabaseConfig;
use redwhisk_lib::db::migrations::MigrationRunner;
use redwhisk_lib::db::project_label_repository::ProjectLabelRepository;
use redwhisk_lib::db::project_repository::ProjectRepository;
use redwhisk_lib::db::saved_agent_skill_repository::SavedAgentSkillRepository;
use redwhisk_lib::types::agent_profile::{
    AgentScope, AgentType, ListAgentProfilesInput, SaveAgentProfileInput, TestAgentCommandInput,
};
use redwhisk_lib::types::agent_skill::AgentSkillScope;
use redwhisk_lib::types::errors::CommandErrorCode;
use redwhisk_lib::types::project_label::{ProjectLabelScope, SaveProjectLabelInput};
use redwhisk_lib::types::saved_agent_skill::{
    ListSavedAgentSkillsInput, SaveSavedAgentSkillInput, SavedAgentSkillPath,
};
use redwhisk_lib::types::user_profile::UpdateUserProfileInput;

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
            "prompt_template",
            "del",
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
fn settings_migration_creates_saved_agent_skills_table() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");

    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");

    let columns = table_columns(&database.connection, "saved_agent_skills");
    assert_eq!(
        columns,
        vec![
            "id",
            "name",
            "scope",
            "project_id",
            "skill_paths_json",
            "del",
            "created_at",
            "updated_at",
        ],
    );
}

#[test]
fn settings_migration_creates_user_profiles_table() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");

    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");

    assert_eq!(
        table_columns(&database.connection, "user_profiles"),
        vec!["id", "name", "avatar_path"],
    );
}

#[test]
fn user_profile_saves_name() {
    let temp_dir = tempfile::tempdir().expect("temp dir");

    let profile = UserProfileService::update_profile_in_data_dir(
        temp_dir.path(),
        UpdateUserProfileInput {
            name: Some("RedWhisk".to_string()),
            avatar_source_path: None,
        },
    )
    .expect("save profile");

    assert_eq!(profile.name, "RedWhisk");
    assert_eq!(profile.avatar_path, None);
}

#[test]
fn save_and_list_saved_agent_skill_round_trip() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let service = settings_service(
        &database.connection,
        StubCommandDetector::with_test_result("codex", Ok("/usr/local/bin/codex")),
    );

    let saved = service
        .save_saved_agent_skill(SaveSavedAgentSkillInput {
            id: None,
            name: "build".to_string(),
            scope: AgentSkillScope::Global,
            project_id: None,
            skill_paths: vec![SavedAgentSkillPath {
                agent_type: AgentType::Codex,
                path: "/skills/build".to_string(),
            }],
        })
        .expect("saved agent skill");

    assert!(saved.id > 0);
    assert_eq!(saved.name, "build");
    assert_eq!(saved.scope, AgentSkillScope::Global);

    let response = service
        .list_saved_agent_skills(ListSavedAgentSkillsInput {
            scope: None,
            project_id: None,
        })
        .expect("list saved agent skills");

    assert_eq!(response.skills, vec![saved]);
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
    assert_eq!(profile.command, "codex");
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
    assert_eq!(profile.command, "claude");

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
fn delete_agent_profile_marks_profile_deleted_and_excludes_from_lists() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let service = settings_service(
        &database.connection,
        StubCommandDetector::with_test_result("codex", Ok("/usr/local/bin/codex")),
    );

    let profile = service
        .save_agent_profile(SaveAgentProfileInput {
            id: None,
            name: "Codex Default".to_string(),
            agent_type: AgentType::Codex,
            command: "codex".to_string(),
            scope: AgentScope::Global,
            project_id: None,
            mode: "full-auto".to_string(),
            dangerous: true,
            default_skill: "".to_string(),
            prompt_template: "".to_string(),
        })
        .expect("saved agent profile");

    service
        .delete_agent_profile(
            redwhisk_lib::types::agent_profile::DeleteAgentProfileInput { id: profile.id },
        )
        .expect("delete agent profile");

    let stored_del: i64 = database
        .connection
        .query_row(
            "SELECT del FROM agent_profiles WHERE id = ?1",
            [profile.id],
            |row| row.get(0),
        )
        .expect("stored del");
    assert_eq!(stored_del, 1);

    let listed_profiles = service
        .list_agent_profiles(ListAgentProfilesInput {
            scope: AgentScope::Global,
            project_id: None,
        })
        .expect("list profiles")
        .profiles;
    assert!(listed_profiles.is_empty());

    let historical_profile = AgentProfileRepository::new(&database.connection)
        .find_profile_by_id(profile.id)
        .expect("find profile")
        .expect("historical profile");
    assert_eq!(historical_profile.id, profile.id);
    assert_eq!(historical_profile.del, 1);
}

#[test]
fn settings_migrations_upgrade_existing_codex_only_profiles_schema_for_claude_profiles() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");

    MigrationRunner::from_static_migrations(old_codex_only_agent_profile_migrations())
        .run(&database.connection)
        .expect("old migrations");
    let codex_only_migration_count: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = '0007_restructure_agent_profiles'",
            [],
            |row| row.get(0),
        )
        .expect("codex-only migration count");
    assert_eq!(codex_only_migration_count, 1);
    let current_version: String = database
        .connection
        .query_row(
            "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .expect("current migration");
    assert_eq!(current_version, "0008_agent_sessions_and_session_events");
    database
        .connection
        .execute(
            "INSERT INTO agent_profiles (
               name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template
             ) VALUES ('Codex Existing', 'codex', '/usr/local/bin/codex', 'global', NULL, 'full-auto', 1, 'onespec', 'prompt')",
            [],
        )
        .expect("insert existing codex profile");
    let codex_profile_id = database.connection.last_insert_rowid();
    database
        .connection
        .execute(
            "INSERT INTO agent_sessions (
               issue_id,
               title,
               agent_profile_id,
               status,
               attention,
               working_dir,
               command_snapshot,
               prompt_snapshot,
               log_path,
               last_active_at,
               started_at,
               closed_at
             ) VALUES (NULL, 'Existing Session', ?1, 'running', 'none', '/tmp/repo', 'codex', 'prompt', '/tmp/log', 1780638500000, 1780638500000, NULL)",
            [codex_profile_id],
        )
        .expect("insert existing agent session");

    MigrationRunner::default()
        .run(&database.connection)
        .expect("default migrations");
    let service = settings_service(
        &database.connection,
        StubCommandDetector::with_test_result("claude", Ok("/usr/local/bin/claude")),
    );

    let profile = service
        .save_agent_profile(SaveAgentProfileInput {
            id: None,
            name: "Claude Upgraded".to_string(),
            agent_type: AgentType::Claude,
            command: "claude".to_string(),
            scope: AgentScope::Global,
            project_id: None,
            mode: "default".to_string(),
            dangerous: false,
            default_skill: "review".to_string(),
            prompt_template: "".to_string(),
        })
        .expect("saved claude profile after schema upgrade");

    assert_eq!(profile.agent_type, AgentType::Claude);
    let existing_codex_profile_count: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM agent_profiles
             WHERE name = 'Codex Existing'
               AND agent_type = 'codex'
               AND command = '/usr/local/bin/codex'
               AND scope = 'global'
               AND mode = 'full-auto'
               AND dangerous = 1
               AND default_skill = 'onespec'
               AND prompt_template = 'prompt'",
            [],
            |row| row.get(0),
        )
        .expect("existing codex profile count");
    assert_eq!(existing_codex_profile_count, 1);
    let existing_session_count: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM agent_sessions WHERE agent_profile_id = ?1",
            [codex_profile_id],
            |row| row.get(0),
        )
        .expect("existing session count");
    assert_eq!(existing_session_count, 1);
    let foreign_key_violation_count = foreign_key_violation_count(&database.connection);
    assert_eq!(foreign_key_violation_count, 0);
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

#[test]
fn save_global_project_label_rejects_duplicate_name_from_project_scope() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let service = settings_service(
        &database.connection,
        StubCommandDetector::with_test_result("/usr/local/bin/codex", Ok("/usr/local/bin/codex")),
    );
    let project_id = insert_project(&database.connection, "redwhisk");

    service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "ops".to_string(),
            scope: ProjectLabelScope::Project,
            project_id: Some(project_id),
            color: "#112233".to_string(),
            workflow_skill: None,
        })
        .expect("project label");

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
fn save_project_label_allows_same_name_in_other_project() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let service = settings_service(
        &database.connection,
        StubCommandDetector::with_test_result("/usr/local/bin/codex", Ok("/usr/local/bin/codex")),
    );
    let project_a = insert_project(&database.connection, "redwhisk");
    let project_b = insert_project(&database.connection, "agents-lab");

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
fn save_project_label_allows_workflow_skill_without_agent() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let service = settings_service(
        &database.connection,
        StubCommandDetector::with_test_result("/usr/local/bin/codex", Ok("/usr/local/bin/codex")),
    );
    let project_id = insert_project(&database.connection, "redwhisk");

    let saved = service
        .save_project_label(SaveProjectLabelInput {
            id: None,
            name: "ops".to_string(),
            scope: ProjectLabelScope::Project,
            project_id: Some(project_id),
            color: "#112233".to_string(),
            workflow_skill: Some("triage".to_string()),
        })
        .expect("workflow skill without agent should succeed");

    assert_eq!(saved.workflow_skill.as_deref(), Some("triage"));
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
        ProjectLabelRepository::new(connection),
        SavedAgentSkillRepository::new(connection),
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

fn old_codex_only_agent_profile_migrations() -> Vec<(&'static str, &'static str)> {
    vec![
        ("0001_core", include_str!("../migrations/0001_core.sql")),
        (
            "0002_projects",
            include_str!("../migrations/0002_projects.sql"),
        ),
        (
            "0003_project_integer_ids",
            include_str!("../migrations/0003_project_integer_ids.sql"),
        ),
        ("0004_issues", include_str!("../migrations/0004_issues.sql")),
        (
            "0005_issue_actions",
            include_str!("../migrations/0005_issue_actions.sql"),
        ),
        (
            "0006_agent_profiles_and_project_overrides",
            include_str!("../migrations/0006_agent_profiles_and_project_overrides.sql"),
        ),
        ("0007_restructure_agent_profiles", OLD_CODEX_ONLY_0007),
        (
            "0008_agent_sessions_and_session_events",
            include_str!("../migrations/0008_agent_sessions_and_session_events.sql"),
        ),
    ]
}

const OLD_CODEX_ONLY_0007: &str = r#"
DROP TABLE IF EXISTS project_agent_overrides;
DROP TABLE IF EXISTS agent_profiles;

CREATE TABLE agent_profiles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  agent_type TEXT NOT NULL CHECK (agent_type IN ('codex')),
  command TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('project', 'global')),
  project_id INTEGER,
  mode TEXT NOT NULL DEFAULT 'full-auto',
  dangerous INTEGER NOT NULL DEFAULT 1 CHECK (dangerous IN (0, 1)),
  default_skill TEXT NOT NULL DEFAULT '',
  prompt_template TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
"#;

fn insert_project(connection: &rusqlite::Connection, name: &str) -> i64 {
    connection
        .execute(
            "INSERT INTO projects (name, repo_path, created_at, last_opened_at)
             VALUES (?1, ?2, 1780624800000, 1780624800000)",
            rusqlite::params![name, format!("/tmp/{}", name)],
        )
        .expect("insert project");
    connection.last_insert_rowid()
}

fn foreign_key_violation_count(connection: &rusqlite::Connection) -> i64 {
    let mut statement = connection
        .prepare("PRAGMA foreign_key_check")
        .expect("foreign key check");
    let violations = statement
        .query_map([], |_| Ok(()))
        .expect("query foreign key violations")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect foreign key violations");
    violations.len() as i64
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

#[test]
fn migration_drops_label_agent_profile_id_and_nulls_workflow_skill() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());

    let columns = table_columns(&database.connection, "project_labels");
    assert!(
        !columns.iter().any(|c| c == "agent_profile_id"),
        "agent_profile_id 列应已被删除，实际列: {:?}",
        columns
    );
    assert!(columns.iter().any(|c| c == "workflow_skill"));

    // workflow_skill 列仍可写入（语义为 saved skill name）。
    database
        .connection
        .execute(
            "INSERT INTO project_labels (name, scope, project_id, color, workflow_skill, del)
             VALUES ('ops', 'global', NULL, '#112233', 'triage', 0)",
            [],
        )
        .expect("insert label");
    let skill: Option<String> = database
        .connection
        .query_row(
            "SELECT workflow_skill FROM project_labels WHERE name = 'ops'",
            [],
            |row| row.get(0),
        )
        .expect("select skill");
    assert_eq!(skill.as_deref(), Some("triage"));
}
