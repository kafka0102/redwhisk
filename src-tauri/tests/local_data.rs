use std::fs;

use redwhisk_lib::db::connection::DatabaseConfig;
use redwhisk_lib::db::migrations::MigrationRunner;
use redwhisk_lib::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

#[test]
fn local_data_initialization_creates_database_and_records_migration() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    let status = MigrationRunner::default()
        .run(&database.connection)
        .expect("migration status");

    assert!(database.path.ends_with("redwhisk.sqlite3"));
    assert!(database.path.exists());
    assert_eq!(
        status.applied_versions,
        vec![
            "0001_core",
            "0002_projects",
            "0003_project_integer_ids",
            "0004_issues",
            "0005_issue_actions",
            "0006_agent_profiles_and_project_overrides",
            "0007_restructure_agent_profiles",
            "0008_agent_sessions_and_session_events",
            "0009_agent_sessions_project_id",
            "0010_project_completion_policy",
            "0011_completion_attempts",
            "0012_agent_commit_completion_attempts",
            "0013_agent_commit_completion_result",
            "0014_completion_attempt_failure_reason",
            "0015_completion_attempt_git_operation_blocked",
            "0016_agent_session_latest_output",
            "0017_allow_claude_agent_profiles",
            "0018_issue_attachments",
            "0019_agent_profiles_del",
            "0020_issues_and_agent_sessions_del",
            "0021_project_terminal_configs",
            "0022_agent_worktree_execution",
            "0023_project_labels",
            "0024_issue_labels",
            "0025_agent_session_list_order",
            "0026_agent_sessions_active_issue_unique_index",
            "0027_issue_completion_flows",
            "0028_agent_session_turn_state",
            "0029_saved_agent_skills",
            "0030_drop_label_agent_profile",
            "0031_drop_completion_policy",
        ]
    );
    assert_eq!(
        status.current_version,
        Some("0031_drop_completion_policy".to_string())
    );

    let schema_migrations_count: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = '0001_core'",
            [],
            |row| row.get(0),
        )
        .expect("schema migration count");
    assert_eq!(schema_migrations_count, 1);
}

#[test]
fn migrations_are_idempotent_after_first_run() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    let runner = MigrationRunner::default();

    let first_status = runner.run(&database.connection).expect("first run");
    let second_status = runner.run(&database.connection).expect("second run");

    assert_eq!(
        first_status.applied_versions,
        vec![
            "0001_core",
            "0002_projects",
            "0003_project_integer_ids",
            "0004_issues",
            "0005_issue_actions",
            "0006_agent_profiles_and_project_overrides",
            "0007_restructure_agent_profiles",
            "0008_agent_sessions_and_session_events",
            "0009_agent_sessions_project_id",
            "0010_project_completion_policy",
            "0011_completion_attempts",
            "0012_agent_commit_completion_attempts",
            "0013_agent_commit_completion_result",
            "0014_completion_attempt_failure_reason",
            "0015_completion_attempt_git_operation_blocked",
            "0016_agent_session_latest_output",
            "0017_allow_claude_agent_profiles",
            "0018_issue_attachments",
            "0019_agent_profiles_del",
            "0020_issues_and_agent_sessions_del",
            "0021_project_terminal_configs",
            "0022_agent_worktree_execution",
            "0023_project_labels",
            "0024_issue_labels",
            "0025_agent_session_list_order",
            "0026_agent_sessions_active_issue_unique_index",
            "0027_issue_completion_flows",
            "0028_agent_session_turn_state",
            "0029_saved_agent_skills",
            "0030_drop_label_agent_profile",
            "0031_drop_completion_policy",
        ]
    );
    assert!(second_status.applied_versions.is_empty());
    assert_eq!(
        second_status.current_version,
        Some("0031_drop_completion_policy".to_string())
    );

    let schema_migrations_count: i64 = database
        .connection
        .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .expect("schema migration count");
    assert_eq!(schema_migrations_count, 31);
}

#[test]
fn failed_migration_rolls_back_schema_and_version_record() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    let runner = MigrationRunner::from_static_migrations(vec![(
        "9999_broken",
        "CREATE TABLE transient_table (id TEXT PRIMARY KEY); SELECT * FROM missing_table;",
    )]);

    let result = runner.run(&database.connection);

    assert!(result.is_err());
    let table_count: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'transient_table'",
            [],
            |row| row.get(0),
        )
        .expect("transient table count");
    assert_eq!(table_count, 0);

    let version_count: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = '9999_broken'",
            [],
            |row| row.get(0),
        )
        .expect("broken migration version count");
    assert_eq!(version_count, 0);
}

#[test]
fn database_open_creates_parent_directory() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let data_dir = temp_dir.path().join("nested").join("redwhisk");

    let database = DatabaseConfig::new(&data_dir).open().expect("database");

    assert!(fs::metadata(data_dir).expect("metadata").is_dir());
    assert!(database.path.exists());
}

#[test]
fn command_error_serializes_with_code_message_and_typed_details() {
    let error = CommandError::new(
        CommandErrorCode::LocalDataInitializationFailed,
        "本地数据初始化失败。",
    )
    .with_detail(ErrorDetail::new("DatabasePath").with_value("path", "/tmp/redwhisk"));

    let value = serde_json::to_value(error).expect("serialized error");

    assert_eq!(value["code"], "LOCAL_DATA_INITIALIZATION_FAILED");
    assert_eq!(value["message"], "本地数据初始化失败。");
    assert_eq!(value["details"][0]["@type"], "DatabasePath");
    assert_eq!(value["details"][0]["path"], "/tmp/redwhisk");
}
