use redwhisk_lib::agent::pty_session_manager::PtySessionManager;
use redwhisk_lib::core::project_service::ProjectService;
use redwhisk_lib::core::project_terminal_service::{
    ProjectTerminalRegistry, ProjectTerminalService,
};
use redwhisk_lib::db::connection::DatabaseConfig;
use redwhisk_lib::db::migrations::MigrationRunner;
use redwhisk_lib::db::project_repository::ProjectRepository;
use redwhisk_lib::types::errors::CommandErrorCode;
use redwhisk_lib::types::project::{
    CreateProjectInput, OpenProjectInput, ProjectPathStatus, ProjectWorktreeLocation,
    UpdateProjectSettingsInput,
};
use redwhisk_lib::types::project_terminal::{
    CreateProjectTerminalInput, ListProjectTerminalsInput, ReadProjectTerminalInput,
};
use std::fs;
use std::sync::{Mutex, MutexGuard, OnceLock};

fn terminal_test_env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn lock_terminal_test_env() -> MutexGuard<'static, ()> {
    match terminal_test_env_lock().lock() {
        Ok(guard) => guard,
        Err(error) => error.into_inner(),
    }
}

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
            "worktree_location",
            "worktree_setup_command",
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
fn project_terminal_config_migration_creates_expected_schema() {
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
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'project_terminal_configs'",
            [],
            |row| row.get(0),
        )
        .expect("project_terminal_configs table count");
    assert_eq!(table_count, 1);

    let columns = table_columns(&database.connection, "project_terminal_configs");
    assert_eq!(
        columns,
        vec![
            "id",
            "project_id",
            "name",
            "working_dir",
            "launch_command",
            "created_at",
            "updated_at",
        ],
    );

    let project_id_index_count: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_index_list('project_terminal_configs') WHERE name = 'idx_project_terminal_configs_project_id'",
            [],
            |row| row.get(0),
        )
        .expect("project_id index count");
    assert_eq!(project_id_index_count, 1);
}

#[test]
fn repository_persists_project_terminal_config_lifecycle() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");

    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");

    let repository = ProjectRepository::new(&database.connection);
    let project = repository
        .insert("sample-repo", "/tmp/sample-repo")
        .expect("insert project");

    let inserted = repository
        .insert_project_terminal_config(project.id, "New Terminal", "/tmp/sample-repo", "")
        .expect("insert terminal config");

    assert!(inserted.id > 0);
    assert_eq!(inserted.project_id, project.id);
    assert_eq!(inserted.name, "New Terminal");
    assert_eq!(inserted.working_dir, "/tmp/sample-repo");
    assert_eq!(inserted.launch_command, "");
    assert!(inserted.created_at > 1_700_000_000_000);
    assert_eq!(inserted.created_at, inserted.updated_at);

    let listed = repository
        .list_project_terminal_configs(project.id)
        .expect("list terminal configs");
    assert_eq!(listed, vec![inserted.clone()]);

    let updated = repository
        .update_project_terminal_config(
            project.id,
            inserted.id,
            "Server",
            "/tmp/sample-repo/apps/api",
            "pnpm dev",
        )
        .expect("update terminal config");

    assert_eq!(updated.id, inserted.id);
    assert_eq!(updated.project_id, project.id);
    assert_eq!(updated.name, "Server");
    assert_eq!(updated.working_dir, "/tmp/sample-repo/apps/api");
    assert_eq!(updated.launch_command, "pnpm dev");
    assert!(updated.updated_at >= updated.created_at);

    let listed_after_update = repository
        .list_project_terminal_configs(project.id)
        .expect("list updated terminal configs");
    assert_eq!(listed_after_update, vec![updated]);

    repository
        .delete_project_terminal_config(project.id, inserted.id)
        .expect("delete terminal config");
    let listed_after_delete = repository
        .list_project_terminal_configs(project.id)
        .expect("list after delete");
    assert!(listed_after_delete.is_empty());
}

#[test]
fn repository_rejects_project_terminal_config_update_from_other_project() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");

    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");

    let repository = ProjectRepository::new(&database.connection);
    let first_project = repository
        .insert("first-repo", "/tmp/first-repo")
        .expect("insert first project");
    let second_project = repository
        .insert("second-repo", "/tmp/second-repo")
        .expect("insert second project");
    let inserted = repository
        .insert_project_terminal_config(first_project.id, "API", "/tmp/first-repo", "pnpm dev")
        .expect("insert terminal config");

    let error = repository
        .update_project_terminal_config(
            second_project.id,
            inserted.id,
            "Worker",
            "/tmp/second-repo",
            "pnpm worker",
        )
        .expect_err("cross-project update should fail");
    assert!(matches!(error, rusqlite::Error::QueryReturnedNoRows));

    let listed = repository
        .list_project_terminal_configs(first_project.id)
        .expect("list first project terminal configs");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "API");
    assert_eq!(listed[0].working_dir, "/tmp/first-repo");
    assert_eq!(listed[0].launch_command, "pnpm dev");
}

#[test]
fn repository_rejects_project_terminal_config_delete_from_other_project() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");

    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");

    let repository = ProjectRepository::new(&database.connection);
    let first_project = repository
        .insert("first-repo", "/tmp/first-repo")
        .expect("insert first project");
    let second_project = repository
        .insert("second-repo", "/tmp/second-repo")
        .expect("insert second project");
    let inserted = repository
        .insert_project_terminal_config(first_project.id, "API", "/tmp/first-repo", "pnpm dev")
        .expect("insert terminal config");

    let error = repository
        .delete_project_terminal_config(second_project.id, inserted.id)
        .expect_err("cross-project delete should fail");
    assert!(matches!(error, rusqlite::Error::QueryReturnedNoRows));

    let listed = repository
        .list_project_terminal_configs(first_project.id)
        .expect("list first project terminal configs");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, inserted.id);
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
        ("0004_issues", include_str!("../migrations/0004_issues.sql")),
        (
            "0006_agent_profiles_and_project_overrides",
            include_str!("../migrations/0006_agent_profiles_and_project_overrides.sql"),
        ),
        (
            "0007_restructure_agent_profiles",
            include_str!("../migrations/0007_restructure_agent_profiles.sql"),
        ),
        (
            "0008_agent_sessions_and_session_events",
            include_str!("../migrations/0008_agent_sessions_and_session_events.sql"),
        ),
        (
            "0010_project_completion_policy",
            include_str!("../migrations/0010_project_completion_policy.sql"),
        ),
        (
            "0022_agent_worktree_execution",
            include_str!("../migrations/0022_agent_worktree_execution.sql"),
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
        project.worktree_location,
        ProjectWorktreeLocation::RepoSibling
    );
    assert_eq!(project.worktree_setup_command, "");
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
        ("0004_issues", include_str!("../migrations/0004_issues.sql")),
        (
            "0006_agent_profiles_and_project_overrides",
            include_str!("../migrations/0006_agent_profiles_and_project_overrides.sql"),
        ),
        (
            "0007_restructure_agent_profiles",
            include_str!("../migrations/0007_restructure_agent_profiles.sql"),
        ),
        (
            "0008_agent_sessions_and_session_events",
            include_str!("../migrations/0008_agent_sessions_and_session_events.sql"),
        ),
        (
            "0010_project_completion_policy",
            include_str!("../migrations/0010_project_completion_policy.sql"),
        ),
        (
            "0022_agent_worktree_execution",
            include_str!("../migrations/0022_agent_worktree_execution.sql"),
        ),
    ]);

    runner.run(&database.connection).expect("migrations");

    let project = ProjectRepository::new(&database.connection)
        .find_by_repo_path("/tmp/integer-repo")
        .expect("query project")
        .expect("project");
    assert_eq!(project.id, 42);
    assert_eq!(
        project.worktree_location,
        ProjectWorktreeLocation::RepoSibling
    );
    assert_eq!(project.worktree_setup_command, "");
    assert_eq!(project.created_at, 1_780_624_800_000);
    assert_eq!(project.last_opened_at, 1_780_628_400_000);
}

#[test]
fn create_project_persists_git_repo_with_confirmed_name() {
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
            name: "sample-repo".to_string(),
            repo_path: repo_dir.to_string_lossy().to_string(),
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: "".to_string(),
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
fn create_project_persists_worktree_settings() {
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
            name: "sample-repo".to_string(),
            repo_path: repo_dir.to_string_lossy().to_string(),
            worktree_location: ProjectWorktreeLocation::UserHome,
            worktree_setup_command: "pnpm install\npnpm test  ".to_string(),
        })
        .expect("created project");

    assert_eq!(project.worktree_location, ProjectWorktreeLocation::UserHome);
    assert_eq!(project.worktree_setup_command, "pnpm install\npnpm test");
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
            name: "sample-repo".to_string(),
            repo_path: repo_dir.to_string_lossy().to_string(),
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: "".to_string(),
        })
        .expect("direct project");
    let equivalent_project = service
        .create_project(CreateProjectInput {
            name: "sample-repo".to_string(),
            repo_path: repo_dir.join(".").to_string_lossy().to_string(),
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: "".to_string(),
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
            name: "plain-dir".to_string(),
            repo_path: non_git_dir.to_string_lossy().to_string(),
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: "".to_string(),
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
            name: "missing-repo".to_string(),
            repo_path: missing_dir.to_string_lossy().to_string(),
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: "".to_string(),
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
        name: "sample-repo".to_string(),
        repo_path: repo_dir.to_string_lossy().to_string(),
        worktree_location: ProjectWorktreeLocation::RepoSibling,
        worktree_setup_command: "".to_string(),
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
fn open_project_restores_saved_project_terminals_without_duplicate_launches() {
    let _env_lock = lock_terminal_test_env();
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
    let stored_project = repository
        .insert("sample-repo", repo_dir.to_str().unwrap())
        .expect("insert project");
    let terminal_service =
        ProjectTerminalService::new(ProjectRepository::new(&database.connection));
    let registry = ProjectTerminalRegistry::new();
    let manager = PtySessionManager::new();

    let created = terminal_service
        .create_terminal(
            temp_dir.path(),
            CreateProjectTerminalInput {
                project_id: stored_project.id,
            },
            &registry,
            &manager,
        )
        .expect("create terminal");

    terminal_service
        .close_terminal(
            redwhisk_lib::types::project_terminal::CloseProjectTerminalInput {
                project_id: stored_project.id,
                session_id: created.session_id,
            },
            &registry,
            &manager,
        )
        .expect("close initial terminal session");

    let opened = ProjectService::open_project_in_data_dir(
        temp_dir.path(),
        OpenProjectInput {
            project_id: stored_project.id,
        },
        &registry,
        &manager,
    )
    .expect("open project with restored terminals");

    assert_eq!(opened.id, stored_project.id);

    let listed = terminal_service
        .list_project_terminals(
            ListProjectTerminalsInput {
                project_id: stored_project.id,
            },
            &registry,
            &manager,
        )
        .expect("list restored terminals");
    assert_eq!(listed.terminals.len(), 1);
    assert_eq!(listed.terminals[0].config_id, created.config_id);
    assert_ne!(listed.terminals[0].session_id, created.session_id);
    assert!(manager.contains(listed.terminals[0].session_id));

    let reopened = ProjectService::open_project_in_data_dir(
        temp_dir.path(),
        OpenProjectInput {
            project_id: stored_project.id,
        },
        &registry,
        &manager,
    )
    .expect("reopen project should not duplicate terminal");
    assert_eq!(reopened.id, stored_project.id);

    let relisted = terminal_service
        .list_project_terminals(
            ListProjectTerminalsInput {
                project_id: stored_project.id,
            },
            &registry,
            &manager,
        )
        .expect("list terminals after reopen");
    assert_eq!(relisted.terminals.len(), 1);
    assert_eq!(relisted.terminals[0].config_id, created.config_id);
    assert_eq!(
        relisted.terminals[0].session_id,
        listed.terminals[0].session_id
    );

    let snapshot = terminal_service
        .read_terminal_snapshot(
            ReadProjectTerminalInput {
                project_id: stored_project.id,
                session_id: relisted.terminals[0].session_id,
                max_bytes: Some(1024),
            },
            &registry,
            &manager,
        )
        .expect("read restored snapshot");
    assert!(snapshot.is_active);
}

#[test]
fn open_project_ignores_individual_terminal_restore_failures() {
    let _env_lock = lock_terminal_test_env();
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    let healthy_repo = temp_dir.path().join("healthy-repo");
    fs::create_dir_all(healthy_repo.join(".git")).expect("healthy git dir");
    let broken_repo = temp_dir.path().join("broken-repo");
    fs::create_dir_all(broken_repo.join(".git")).expect("broken git dir");
    let repository = ProjectRepository::new(&database.connection);
    let stored_project = repository
        .insert("healthy-repo", healthy_repo.to_str().unwrap())
        .expect("insert project");
    repository
        .insert_project_terminal_config(
            stored_project.id,
            "Healthy",
            healthy_repo.to_str().unwrap(),
            "",
        )
        .expect("insert healthy terminal config");
    repository
        .insert_project_terminal_config(
            stored_project.id,
            "Broken",
            broken_repo.to_str().unwrap(),
            "__redwhisk_missing_terminal_command__",
        )
        .expect("insert broken terminal config");

    let terminal_service =
        ProjectTerminalService::new(ProjectRepository::new(&database.connection));
    let registry = ProjectTerminalRegistry::new();
    let manager = PtySessionManager::new();

    let opened = ProjectService::open_project_in_data_dir(
        temp_dir.path(),
        OpenProjectInput {
            project_id: stored_project.id,
        },
        &registry,
        &manager,
    )
    .expect("open project should succeed");

    assert_eq!(opened.id, stored_project.id);

    let listed = terminal_service
        .list_project_terminals(
            ListProjectTerminalsInput {
                project_id: stored_project.id,
            },
            &registry,
            &manager,
        )
        .expect("list terminals after partial restore");
    assert_eq!(listed.terminals.len(), 2);
    assert!(listed
        .terminals
        .iter()
        .any(|terminal| terminal.name == "Healthy"));
    assert!(listed
        .terminals
        .iter()
        .any(|terminal| terminal.name == "Broken"));
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

#[test]
fn update_project_settings_persists_project_name_and_repo_path() {
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
    let stored_project = repository
        .insert("sample-repo", repo_dir.to_str().unwrap())
        .expect("insert project");
    let service = ProjectService::new(ProjectRepository::new(&database.connection));

    let updated = service
        .update_project_settings(UpdateProjectSettingsInput {
            project_id: stored_project.id,
            name: "RedWhisk Desktop".to_string(),
            repo_path: repo_dir.to_string_lossy().to_string(),
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: "".to_string(),
        })
        .expect("update project settings");

    assert_eq!(updated.id, stored_project.id);
    assert_eq!(updated.name, "RedWhisk Desktop");
    assert_eq!(
        updated.repo_path,
        repo_dir
            .canonicalize()
            .expect("canonical repo")
            .to_string_lossy()
    );
}

#[test]
fn update_project_settings_rejects_blank_name() {
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
    let stored_project = repository
        .insert("sample-repo", repo_dir.to_str().unwrap())
        .expect("insert project");
    let service = ProjectService::new(ProjectRepository::new(&database.connection));

    let error = service
        .update_project_settings(UpdateProjectSettingsInput {
            project_id: stored_project.id,
            name: "   ".to_string(),
            repo_path: repo_dir.to_string_lossy().to_string(),
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: "".to_string(),
        })
        .expect_err("blank name should fail");

    assert_eq!(error.code, CommandErrorCode::ProjectRepoPathInvalid);
    let persisted = ProjectRepository::new(&database.connection)
        .find_by_id(stored_project.id)
        .expect("query project")
        .expect("project");
    assert_eq!(persisted.name, "sample-repo");
}

#[test]
fn update_project_settings_updates_repo_path_when_new_path_is_git_repository() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    let initial_repo_dir = temp_dir.path().join("initial-repo");
    fs::create_dir_all(initial_repo_dir.join(".git")).expect("initial git dir");
    let moved_repo_dir = temp_dir.path().join("moved-repo");
    fs::create_dir_all(moved_repo_dir.join(".git")).expect("moved git dir");
    let service = ProjectService::new(ProjectRepository::new(&database.connection));
    let project = service
        .create_project(CreateProjectInput {
            name: "initial-repo".to_string(),
            repo_path: initial_repo_dir.to_string_lossy().to_string(),
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: "".to_string(),
        })
        .expect("created project");

    let updated_project = service
        .update_project_settings(UpdateProjectSettingsInput {
            project_id: project.id,
            name: "Moved Repo".to_string(),
            repo_path: moved_repo_dir.to_string_lossy().to_string(),
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: "pnpm install\npnpm test".to_string(),
        })
        .expect("updated project");

    assert_eq!(updated_project.name, "Moved Repo");
    assert_eq!(
        updated_project.repo_path,
        moved_repo_dir
            .canonicalize()
            .expect("canonical moved repo")
            .to_string_lossy()
    );
    assert_eq!(
        updated_project.worktree_location,
        ProjectWorktreeLocation::RepoSibling
    );
    assert_eq!(
        updated_project.worktree_setup_command,
        "pnpm install\npnpm test"
    );
}

#[test]
fn update_project_settings_rejects_repo_internal_worktrees_without_gitignore_entry() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    let repo_dir = temp_dir.path().join("repo-without-worktrees-ignore");
    fs::create_dir_all(repo_dir.join(".git")).expect("git dir");
    fs::write(repo_dir.join(".gitignore"), "target/\n").expect("gitignore");
    let service = ProjectService::new(ProjectRepository::new(&database.connection));
    let project = service
        .create_project(CreateProjectInput {
            name: "repo-without-worktrees-ignore".to_string(),
            repo_path: repo_dir.to_string_lossy().to_string(),
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: "".to_string(),
        })
        .expect("created project");

    let error = service
        .update_project_settings(UpdateProjectSettingsInput {
            project_id: project.id,
            name: "Repo".to_string(),
            repo_path: repo_dir.to_string_lossy().to_string(),
            worktree_location: ProjectWorktreeLocation::RepoInternal,
            worktree_setup_command: "".to_string(),
        })
        .expect_err("repo internal worktrees should require .gitignore entry");

    assert_eq!(error.code, CommandErrorCode::ProjectRepoPathInvalid);
}

#[test]
fn update_project_settings_rejects_non_git_repo_path() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    let initial_repo_dir = temp_dir.path().join("initial-repo");
    fs::create_dir_all(initial_repo_dir.join(".git")).expect("initial git dir");
    let invalid_repo_dir = temp_dir.path().join("plain-dir");
    fs::create_dir_all(&invalid_repo_dir).expect("plain dir");
    let service = ProjectService::new(ProjectRepository::new(&database.connection));
    let project = service
        .create_project(CreateProjectInput {
            name: "initial-repo".to_string(),
            repo_path: initial_repo_dir.to_string_lossy().to_string(),
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: "".to_string(),
        })
        .expect("created project");

    let error = service
        .update_project_settings(UpdateProjectSettingsInput {
            project_id: project.id,
            name: "Initial Repo".to_string(),
            repo_path: invalid_repo_dir.to_string_lossy().to_string(),
            worktree_location: ProjectWorktreeLocation::RepoSibling,
            worktree_setup_command: "".to_string(),
        })
        .expect_err("non git repo should be rejected");

    assert_eq!(error.code, CommandErrorCode::ProjectRepoNotGitRepository);
}

#[test]
fn validate_project_repo_path_returns_canonical_path_and_suggested_name() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("sample-repo");
    fs::create_dir_all(repo_dir.join(".git")).expect("git dir");

    let response =
        ProjectService::validate_project_repo_path(repo_dir.join(".").to_string_lossy().as_ref())
            .expect("validated repo");

    assert_eq!(
        response.repo_path,
        repo_dir
            .canonicalize()
            .expect("canonical repo")
            .to_string_lossy()
    );
    assert_eq!(response.suggested_name, "sample-repo");
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
