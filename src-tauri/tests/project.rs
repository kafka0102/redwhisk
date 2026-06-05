use std::fs;
use std::path::Path;

use redwhisk_lib::core::project_service::ProjectService;
use redwhisk_lib::db::connection::DatabaseConfig;
use redwhisk_lib::db::migrations::MigrationRunner;
use redwhisk_lib::db::project_repository::ProjectRepository;
use redwhisk_lib::types::errors::CommandErrorCode;
use redwhisk_lib::types::project::CreateProjectInput;

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
        vec!["id", "name", "repo_path", "created_at", "last_opened_at"],
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

    assert!(!project.id.is_empty());
    assert_eq!(project.name, "sample-repo");
    assert_eq!(
        project.repo_path,
        repo_dir
            .canonicalize()
            .expect("canonical repo")
            .to_string_lossy()
    );
    assert_eq!(project.created_at, project.last_opened_at);

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
        .insert_or_get_existing("project-1", "sample-repo", "/tmp/sample-repo")
        .expect("first insert");
    let second_project = repository
        .insert_or_get_existing("project-2", "sample-repo", "/tmp/sample-repo")
        .expect("second insert");

    assert_eq!(first_project.id, second_project.id);
    assert_eq!(first_project.id, "project-1");
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
        .insert_or_get_existing_generated_id("first-repo", Path::new("/tmp/first-repo"))
        .expect("first insert");
    let second_project = repository
        .insert_or_get_existing_generated_id("second-repo", Path::new("/tmp/second-repo"))
        .expect("second insert");

    assert_ne!(first_project.id, second_project.id);
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
