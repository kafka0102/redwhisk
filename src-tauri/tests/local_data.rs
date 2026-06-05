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
    assert_eq!(status.applied_versions, vec!["0001_core", "0002_projects"]);
    assert_eq!(status.current_version, Some("0002_projects".to_string()));

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
        vec!["0001_core", "0002_projects"]
    );
    assert!(second_status.applied_versions.is_empty());
    assert_eq!(
        second_status.current_version,
        Some("0002_projects".to_string())
    );

    let schema_migrations_count: i64 = database
        .connection
        .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .expect("schema migration count");
    assert_eq!(schema_migrations_count, 2);
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
