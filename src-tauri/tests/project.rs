use redwhisk_lib::core::project_service::ProjectService;
use redwhisk_lib::db::connection::DatabaseConfig;
use redwhisk_lib::db::migrations::MigrationRunner;
use redwhisk_lib::db::project_repository::ProjectRepository;
use redwhisk_lib::types::errors::CommandErrorCode;
use redwhisk_lib::types::project::{CreateProjectInput, OpenProjectInput, ProjectPathStatus};
use std::fs;

#[test]
fn project_migration_creates_projects_schema_with_unique_repo_path() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");

    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");

    let table_count: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'projects'",
            [],
            |row| row.get(0),
        )
        .expect("projects table count");
    assert_eq!(table_count, 1);

    let columns = table_columns(&database.connection, "projects");
    assert_eq!(
        columns,
        vec![
            "id",
            "name",
            "repo_path",
            "created_at",
            "last_opened_at",
            "completion_policy",
        ],
    );
    assert_eq!(
        table_column_type(&database.connection, "projects", "id"),
        "INTEGER"
    );
    assert_eq!(
        table_column_type(&database.connection, "projects", "created_at"),
        "INTEGER"
    );
    assert_eq!(
        table_column_type(&database.connection, "projects", "last_opened_at"),
        "INTEGER"
    );

    let repo_path_unique_index_count: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_index_list('projects') WHERE name = 'uidx_projects_repo_path' AND [unique] = 1",
            [],
            |row| row.get(0),
        )
        .expect("repo path unique index count");
    assert_eq!(repo_path_unique_index_count, 1);

    let repo_path_index_column: String = database
        .connection
        .query_row(
            "SELECT name FROM pragma_index_info('uidx_projects_repo_path')",
            [],
            |row| row.get(0),
        )
        .expect("repo path unique index column");
    assert_eq!(repo_path_index_column, "repo_path");
}

#[test]
fn project_integer_id_migration_converts_existing_text_schema() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    let runner = MigrationRunner::from_static_migrations(vec![
        ("0001_core", include_str!("../migrations/0001_core.sql")),
        (
            "0002_projects",
            r#"
            CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY NOT NULL,
              name TEXT NOT NULL,
              repo_path TEXT NOT NULL,
              created_at TEXT NOT NULL,
              last_opened_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS uidx_projects_repo_path ON projects (repo_path);
            INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
            VALUES ('project-old', 'old-repo', '/tmp/old-repo', '2026-06-05T02:00:00.000Z', '2026-06-05T03:00:00.000Z');
            "#,
        ),
        (
            "0003_project_integer_ids",
            include_str!("../migrations/0003_project_integer_ids.sql"),
        ),
        (
            "0010_project_completion_policy",
            include_str!("../migrations/0010_project_completion_policy.sql"),
        ),
    ]);

    runner.run(&database.connection).expect("migrations");

    assert_eq!(
        table_column_type(&database.connection, "projects", "id"),
        "INTEGER"
    );
    assert_eq!(
        table_column_type(&database.connection, "projects", "created_at"),
        "INTEGER"
    );
    let project = ProjectRepository::new(&database.connection)
        .find_by_repo_path("/tmp/old-repo")
        .expect("query project")
        .expect("project");

    assert!(project.id > 0);
    assert_eq!(project.name, "old-repo");
    assert_eq!(
        project.completion_policy,
        redwhisk_lib::types::project::ProjectCompletionPolicy::Manual
    );
    assert_eq!(project.created_at, 1_780_624_800_000);
    assert_eq!(project.last_opened_at, 1_780_628_400_000);
}

#[test]
fn project_integer_id_migration_keeps_existing_integer_ids() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    let runner = MigrationRunner::from_static_migrations(vec![
        ("0001_core", include_str!("../migrations/0001_core.sql")),
        (
            "0002_projects",
            r#"
            CREATE TABLE IF NOT EXISTS projects (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL,
              repo_path TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              last_opened_at INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS uidx_projects_repo_path ON projects (repo_path);
            INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
            VALUES (42, 'integer-repo', '/tmp/integer-repo', 1780624800000, 1780628400000);
            "#,
        ),
        (
            "0003_project_integer_ids",
            include_str!("../migrations/0003_project_integer_ids.sql"),
        ),
        (
            "0010_project_completion_policy",
            include_str!("../migrations/0010_project_completion_policy.sql"),
        ),
    ]);

    runner.run(&database.connection).expect("migrations");

    let project = ProjectRepository::new(&database.connection)
        .find_by_repo_path("/tmp/integer-repo")
        .expect("query project")
        .expect("project");
    assert_eq!(project.id, 42);
    assert_eq!(
        project.completion_policy,
        redwhisk_lib::types::project::ProjectCompletionPolicy::Manual
    );
    assert_eq!(project.created_at, 1_780_624_800_000);
    assert_eq!(project.last_opened_at, 1_780_628_400_000);
}

#[test]
fn create_project_persists_git_repo_and_derives_name() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    let repo_dir = temp_dir.path().join("sample-repo");
    fs::create_dir_all(repo_dir.join(".git")).expect("git dir");
    let service = ProjectService::new(ProjectRepository::new(&database.connection));

    let project = service
        .create_project(CreateProjectInput {
            repo_path: repo_dir.to_string_lossy().to_string(),
        })
        .expect("created project");

    assert!(project.id > 0);
    assert_eq!(project.name, "sample-repo");
    assert_eq!(
        project.repo_path,
        repo_dir
            .canonicalize()
            .expect("canonical repo")
            .to_string_lossy()
    );
    assert_eq!(project.created_at, project.last_opened_at);
    assert!(project.created_at > 1_700_000_000_000);

    let count: i64 = database
        .connection
        .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
        .expect("project count");
    assert_eq!(count, 1);
}

#[test]
fn create_project_canonicalizes_equivalent_repo_paths() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    let repo_dir = temp_dir.path().join("sample-repo");
    fs::create_dir_all(repo_dir.join(".git")).expect("git dir");
    let service = ProjectService::new(ProjectRepository::new(&database.connection));

    let direct_project = service
        .create_project(CreateProjectInput {
            repo_path: repo_dir.to_string_lossy().to_string(),
        })
        .expect("direct project");
    let equivalent_project = service
        .create_project(CreateProjectInput {
            repo_path: repo_dir.join(".").to_string_lossy().to_string(),
        })
        .expect("equivalent project");

    assert_eq!(direct_project.id, equivalent_project.id);
    assert_eq!(
        direct_project.repo_path,
        repo_dir
            .canonicalize()
            .expect("canonical repo")
            .to_string_lossy()
    );
    let count: i64 = database
        .connection
        .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
        .expect("project count");
    assert_eq!(count, 1);
}

#[test]
fn create_project_rejects_non_git_directory_without_insert() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    let non_git_dir = temp_dir.path().join("plain-dir");
    fs::create_dir_all(&non_git_dir).expect("plain dir");
    let service = ProjectService::new(ProjectRepository::new(&database.connection));

    let error = service
        .create_project(CreateProjectInput {
            repo_path: non_git_dir.to_string_lossy().to_string(),
        })
        .expect_err("non git repo should be rejected");

    assert_eq!(error.code, CommandErrorCode::ProjectRepoNotGitRepository);
    let count: i64 = database
        .connection
        .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
        .expect("project count");
    assert_eq!(count, 0);
}

#[test]
fn create_project_reports_missing_path_as_invalid_without_insert() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    let missing_dir = temp_dir.path().join("missing-repo");
    let service = ProjectService::new(ProjectRepository::new(&database.connection));

    let error = service
        .create_project(CreateProjectInput {
            repo_path: missing_dir.to_string_lossy().to_string(),
        })
        .expect_err("missing path should be rejected");

    assert_eq!(error.code, CommandErrorCode::ProjectRepoPathInvalid);
    let count: i64 = database
        .connection
        .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
        .expect("project count");
    assert_eq!(count, 0);
}

#[test]
fn create_project_returns_existing_project_for_duplicate_repo_path() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    let repo_dir = temp_dir.path().join("sample-repo");
    fs::create_dir_all(repo_dir.join(".git")).expect("git dir");
    let service = ProjectService::new(ProjectRepository::new(&database.connection));
    let input = CreateProjectInput {
        repo_path: repo_dir.to_string_lossy().to_string(),
    };

    let first_project = service
        .create_project(input.clone())
        .expect("first project");
    let second_project = service.create_project(input).expect("second project");

    assert_eq!(first_project.id, second_project.id);
    let count: i64 = database
        .connection
        .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
        .expect("project count");
    assert_eq!(count, 1);
}

#[test]
fn repository_insert_is_idempotent_for_existing_repo_path() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    let repository = ProjectRepository::new(&database.connection);

    let first_project = repository
        .insert_or_get_existing("sample-repo", "/tmp/sample-repo")
        .expect("first insert");
    let second_project = repository
        .insert_or_get_existing("sample-repo", "/tmp/sample-repo")
        .expect("second insert");

    assert_eq!(first_project.id, second_project.id);
    assert!(first_project.id > 0);
    let count: i64 = database
        .connection
        .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
        .expect("project count");
    assert_eq!(count, 1);
}

#[test]
fn repository_generates_unique_project_ids_for_multiple_repos() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    let repository = ProjectRepository::new(&database.connection);

    let first_project = repository
        .insert_or_get_existing("first-repo", "/tmp/first-repo")
        .expect("first insert");
    let second_project = repository
        .insert_or_get_existing("second-repo", "/tmp/second-repo")
        .expect("second insert");

    assert_ne!(first_project.id, second_project.id);
    assert!(first_project.id > 0);
    assert!(second_project.id > 0);
}

#[test]
fn list_projects_returns_all_projects_with_path_status_in_recent_order() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    let available_repo = temp_dir.path().join("available-repo");
    fs::create_dir_all(available_repo.join(".git")).expect("git dir");
    let missing_repo = temp_dir.path().join("missing-repo");
    let repository = ProjectRepository::new(&database.connection);
    repository
        .insert("available-repo", available_repo.to_str().unwrap())
        .expect("insert available project");
    let old_project = repository
        .find_by_repo_path(available_repo.to_str().unwrap())
        .expect("query available project")
        .expect("available project");
    repository
        .insert("missing-repo", missing_repo.to_str().unwrap())
        .expect("insert missing project");
    let new_project = repository
        .find_by_repo_path(missing_repo.to_str().unwrap())
        .expect("query missing project")
        .expect("missing project");
    database
        .connection
        .execute(
            "UPDATE projects SET last_opened_at = 1780624800000 WHERE id = ?1",
            [old_project.id],
        )
        .expect("older timestamp");
    database
        .connection
        .execute(
            "UPDATE projects SET last_opened_at = 1780628400000 WHERE id = ?1",
            [new_project.id],
        )
        .expect("newer timestamp");
    let service = ProjectService::new(ProjectRepository::new(&database.connection));

    let projects = service.list_projects().expect("project list");

    assert_eq!(projects.projects.len(), 2);
    assert_eq!(projects.projects[0].id, new_project.id);
    assert_eq!(projects.projects[0].path_status, ProjectPathStatus::Missing);
    assert_eq!(projects.projects[1].id, old_project.id);
    assert_eq!(
        projects.projects[1].path_status,
        ProjectPathStatus::Available
    );
}

#[test]
fn open_project_updates_last_opened_at_for_available_project() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    let repo_dir = temp_dir.path().join("sample-repo");
    fs::create_dir_all(repo_dir.join(".git")).expect("git dir");
    let repository = ProjectRepository::new(&database.connection);
    repository
        .insert("sample-repo", repo_dir.to_str().unwrap())
        .expect("insert project");
    let stored_project = repository
        .find_by_repo_path(repo_dir.to_str().unwrap())
        .expect("query project")
        .expect("project");
    database
        .connection
        .execute(
            "UPDATE projects SET last_opened_at = 1780624800000 WHERE id = ?1",
            [stored_project.id],
        )
        .expect("older timestamp");
    let service = ProjectService::new(ProjectRepository::new(&database.connection));

    let opened = service
        .open_project(OpenProjectInput {
            project_id: stored_project.id,
        })
        .expect("open project");

    assert_eq!(opened.id, stored_project.id);
    assert_ne!(opened.last_opened_at, 1_780_624_800_000);
    assert!(opened.last_opened_at > 1_700_000_000_000);
}

#[test]
fn open_project_rejects_missing_path_without_deleting_or_updating_project() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    let missing_repo = temp_dir.path().join("missing-repo");
    let repository = ProjectRepository::new(&database.connection);
    repository
        .insert("missing-repo", missing_repo.to_str().unwrap())
        .expect("insert project");
    let stored_project = repository
        .find_by_repo_path(missing_repo.to_str().unwrap())
        .expect("query project")
        .expect("project");
    database
        .connection
        .execute(
            "UPDATE projects SET last_opened_at = 1780624800000 WHERE id = ?1",
            [stored_project.id],
        )
        .expect("older timestamp");
    let service = ProjectService::new(ProjectRepository::new(&database.connection));

    let error = service
        .open_project(OpenProjectInput {
            project_id: stored_project.id,
        })
        .expect_err("missing project path should fail");

    assert_eq!(error.code, CommandErrorCode::ProjectRepoPathUnavailable);
    let stored = ProjectRepository::new(&database.connection)
        .find_by_id(stored_project.id)
        .expect("query project")
        .expect("project kept");
    assert_eq!(stored.last_opened_at, 1_780_624_800_000);
}

#[test]
fn prepare_project_window_open_validates_target_without_updating_last_opened_at() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    let repo_dir = temp_dir.path().join("target-repo");
    fs::create_dir_all(repo_dir.join(".git")).expect("git dir");
    let repository = ProjectRepository::new(&database.connection);
    repository
        .insert("target-repo", repo_dir.to_str().unwrap())
        .expect("insert project");
    let stored_project = repository
        .find_by_repo_path(repo_dir.to_str().unwrap())
        .expect("query project")
        .expect("project");
    database
        .connection
        .execute(
            "UPDATE projects SET last_opened_at = 1780624800000 WHERE id = ?1",
            [stored_project.id],
        )
        .expect("older timestamp");
    let service = ProjectService::new(ProjectRepository::new(&database.connection));

    let project = service
        .open_project_for_window(OpenProjectInput {
            project_id: stored_project.id,
        })
        .expect("prepare target project");

    assert_eq!(project.id, stored_project.id);
    assert_eq!(project.last_opened_at, 1_780_624_800_000);
}

#[test]
fn record_project_opened_updates_last_opened_at_after_window_success() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    let repo_dir = temp_dir.path().join("target-repo");
    fs::create_dir_all(repo_dir.join(".git")).expect("git dir");
    let repository = ProjectRepository::new(&database.connection);
    repository
        .insert("target-repo", repo_dir.to_str().unwrap())
        .expect("insert project");
    let stored_project = repository
        .find_by_repo_path(repo_dir.to_str().unwrap())
        .expect("query project")
        .expect("project");
    database
        .connection
        .execute(
            "UPDATE projects SET last_opened_at = 1780624800000 WHERE id = ?1",
            [stored_project.id],
        )
        .expect("older timestamp");
    let service = ProjectService::new(ProjectRepository::new(&database.connection));

    let project = service
        .record_project_opened(stored_project.id)
        .expect("record open project");

    assert_eq!(project.id, stored_project.id);
    assert_ne!(project.last_opened_at, 1_780_624_800_000);
    assert!(project.last_opened_at > 1_700_000_000_000);
}

fn table_columns(connection: &rusqlite::Connection, table_name: &str) -> Vec<String> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT name FROM pragma_table_info('{table_name}')"
        ))
        .expect("table info statement");
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("table info rows")
        .map(|row| row.expect("column name"))
        .collect()
}

fn table_column_type(
    connection: &rusqlite::Connection,
    table_name: &str,
    column_name: &str,
) -> String {
    let mut statement = connection
        .prepare(&format!(
            "SELECT type FROM pragma_table_info('{table_name}') WHERE name = ?1"
        ))
        .expect("table info statement");
    statement
        .query_row([column_name], |row| row.get::<_, String>(0))
        .expect("column type")
}
