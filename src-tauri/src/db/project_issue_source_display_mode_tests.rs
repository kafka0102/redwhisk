use super::*;
use crate::db::project_issue_source_repository::ProjectIssueSourceRepository;
use rusqlite::types::Value;

fn table_columns(connection: &Connection, table: &str) -> Vec<String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .expect("table info");
    statement
        .query_map([], |row| row.get(1))
        .expect("column rows")
        .collect::<rusqlite::Result<Vec<String>>>()
        .expect("columns")
}

fn row_snapshot(
    connection: &Connection,
    table: &str,
    id_column: &str,
    columns: &[String],
    row_id: i64,
) -> Vec<Value> {
    let selected = columns
        .iter()
        .map(|column| format!("\"{column}\""))
        .collect::<Vec<_>>()
        .join(", ");
    connection
        .query_row(
            &format!("SELECT {selected} FROM {table} WHERE {id_column} = ?1"),
            params![row_id],
            |row| {
                (0..columns.len())
                    .map(|index| row.get::<_, Value>(index))
                    .collect()
            },
        )
        .expect("row snapshot")
}

#[test]
fn display_mode_migration_adds_board_without_changing_existing_data() {
    const DISPLAY_MODE_MIGRATION: &str = "0067_project_issue_display_mode";

    let file = tempfile::NamedTempFile::new().expect("db file");
    {
        let connection = Connection::open(file.path()).expect("create old db");
        MigrationRunner::runner_skipping(&[DISPLAY_MODE_MIGRATION])
            .run(&connection)
            .expect("migrate through 0066");
        let versions: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
                params![DISPLAY_MODE_MIGRATION],
                |row| row.get(0),
            )
            .expect("display mode migration state");
        assert_eq!(versions, 0);
    }

    let (
        project_columns,
        issue_columns,
        connection_columns,
        before_project,
        before_issue,
        before_connection,
    );
    {
        let connection = Connection::open(file.path()).expect("open old db");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign keys");
        let project_id = insert_legacy_project(&connection);
        connection
            .execute(
                "UPDATE projects
                 SET issue_source_mode = 'mixed',
                     issue_sync_scope = 'label',
                     issue_sync_label = 'bug',
                     issue_sync_enabled = 0,
                     issue_sync_interval_seconds = 300,
                     issue_writeback_close_on_complete = 0,
                     issue_writeback_close_on_pr_merge = 0,
                     issue_writeback_comment = 0,
                     issue_create_source = 'remote'
                 WHERE id = ?1",
                params![project_id],
            )
            .expect("legacy project settings");
        connection
            .execute(
                "INSERT INTO project_forge_connections (
                    project_id, provider, host_url, repo_path, login, auth_kind, auth_status,
                    scopes_json, cli_installed, cli_authenticated, checked_at
                 ) VALUES (
                    ?1, 'github', 'https://github.com', 'acme/redwhisk', 'octocat', 'cli',
                    'ready', '[\"repo\"]', 1, 1, 123
                 )",
                params![project_id],
            )
            .expect("legacy forge settings");
        connection
            .execute(
                "INSERT INTO issues (
                    project_id, number, title, description, status, created_at, updated_at,
                    del, source, label_ids, status_changed_at
                 ) VALUES (
                    ?1, 7, 'keep-title', 'keep-body', 'review', 10, 20, 1, 'remote',
                    '[\"bug\"]', 20
                 )",
                params![project_id],
            )
            .expect("legacy issue");
        let issue_id = connection.last_insert_rowid();

        project_columns = table_columns(&connection, "projects");
        issue_columns = table_columns(&connection, "issues");
        connection_columns = table_columns(&connection, "project_forge_connections");
        before_project = row_snapshot(&connection, "projects", "id", &project_columns, project_id);
        before_issue = row_snapshot(&connection, "issues", "id", &issue_columns, issue_id);
        before_connection = row_snapshot(
            &connection,
            "project_forge_connections",
            "project_id",
            &connection_columns,
            project_id,
        );
    }

    let connection = Connection::open(file.path()).expect("reopen old db");
    let status = MigrationRunner::default()
        .run(&connection)
        .expect("apply display mode migration");
    assert_eq!(
        status.applied_versions,
        vec![DISPLAY_MODE_MIGRATION.to_string()]
    );

    let (project_id, issue_id, display_mode): (i64, i64, String) = connection
        .query_row(
            "SELECT projects.id, issues.id, projects.issue_display_mode
             FROM projects
             JOIN issues ON issues.project_id = projects.id
             WHERE projects.repo_path = '/tmp/legacy'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("migrated rows");
    assert_eq!(display_mode, "board");
    assert_eq!(
        row_snapshot(&connection, "projects", "id", &project_columns, project_id,),
        before_project
    );
    assert_eq!(
        row_snapshot(&connection, "issues", "id", &issue_columns, issue_id),
        before_issue
    );
    assert_eq!(
        row_snapshot(
            &connection,
            "project_forge_connections",
            "project_id",
            &connection_columns,
            project_id,
        ),
        before_connection
    );
}

#[test]
fn issue_display_mode_is_project_scoped_and_survives_reopening_the_database() {
    let file = tempfile::NamedTempFile::new().expect("db file");
    let (first_project_id, second_project_id) = {
        let connection = Connection::open(file.path()).expect("create db");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign keys");
        MigrationRunner::default()
            .run(&connection)
            .expect("migrate");
        let first_project_id = insert_legacy_project(&connection);
        connection
            .execute(
                "INSERT INTO projects (
                    name, repo_path, created_at, last_opened_at, worktree_location,
                    worktree_setup_command, completion_action, pr_target, pr_draft
                 ) VALUES (
                    'second', '/tmp/second', 2, 2, 'repo_sibling', '',
                    'open_pull_request', 'repo_default', 0
                 )",
                [],
            )
            .expect("second project");
        let second_project_id = connection.last_insert_rowid();
        let repository = ProjectIssueSourceRepository::new(&connection);
        let mut first = full_update(first_project_id);
        first.issue_display_mode = Some(IssueDisplayMode::List);
        repository.update(first).expect("save first project");
        let mut omitted = full_update(first_project_id);
        omitted.issue_display_mode = None;
        let kept = repository.update(omitted).expect("omit display mode");
        assert_eq!(kept.issue_display_mode, IssueDisplayMode::List);
        (first_project_id, second_project_id)
    };

    let connection = Connection::open(file.path()).expect("reopen db");
    let repository = ProjectIssueSourceRepository::new(&connection);
    assert_eq!(
        repository
            .get(first_project_id)
            .expect("first")
            .expect("first settings")
            .issue_display_mode,
        IssueDisplayMode::List
    );
    assert_eq!(
        repository
            .get(second_project_id)
            .expect("second")
            .expect("second settings")
            .issue_display_mode,
        IssueDisplayMode::Board
    );
}
