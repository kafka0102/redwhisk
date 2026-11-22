use rusqlite::{params, Connection};

use crate::db::migrations::MigrationRunner;
use crate::types::project_issue_source::{
    IssueCreateSource, IssueDisplayMode, IssueSourceMode, IssueSyncScope,
    UpdateProjectIssueSourceSettings,
};

const ISSUE_SOURCE_SETTINGS_MIGRATION: &str = "0060_project_issue_source_settings";

fn open_database() -> Connection {
    let connection = Connection::open_in_memory().expect("memory db");
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .expect("foreign keys");
    connection
}

#[cfg(test)]
#[path = "project_issue_source_display_mode_tests.rs"]
mod display_mode_tests;

fn insert_legacy_project(connection: &Connection) -> i64 {
    connection
        .execute(
            "INSERT INTO projects (
                name, repo_path, created_at, last_opened_at, worktree_location,
                worktree_setup_command, completion_action, pr_target, pr_draft
             ) VALUES (
                'legacy', '/tmp/legacy', 1, 1, 'repo_sibling', '',
                'open_pull_request', 'repo_default', 0
             )",
            [],
        )
        .expect("legacy project");
    connection
        .query_row(
            "SELECT id FROM projects WHERE repo_path = '/tmp/legacy'",
            [],
            |row| row.get(0),
        )
        .expect("legacy project id")
}

#[test]
fn migrated_project_defaults_to_local_issue_source_mode() {
    let connection = open_database();
    MigrationRunner::runner_skipping(&[ISSUE_SOURCE_SETTINGS_MIGRATION])
        .run(&connection)
        .expect("migrations before issue source settings");
    let project_id = insert_legacy_project(&connection);
    connection
        .execute(
            "INSERT INTO issues (
                project_id, number, title, description, status, created_at, updated_at, del
             ) VALUES (?1, 7, 'keep-title', 'keep-body', 'review', 10, 20, 1)",
            params![project_id],
        )
        .expect("legacy issue");

    MigrationRunner::default()
        .run(&connection)
        .expect("apply issue source settings migration");

    let settings: (
        String,
        String,
        Option<String>,
        i64,
        i64,
        i64,
        i64,
        i64,
        String,
        String,
    ) = connection
        .query_row(
            "SELECT issue_source_mode, issue_sync_scope, issue_sync_label, issue_sync_enabled,
                    issue_sync_interval_seconds, issue_writeback_close_on_complete,
                    issue_writeback_close_on_pr_merge, issue_writeback_comment, issue_create_source,
                    issue_display_mode
             FROM projects WHERE id = ?1",
            params![project_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                ))
            },
        )
        .expect("migrated project settings");
    assert_eq!(settings.0, "local");
    assert_eq!(settings.1, "assigned_to_me");
    assert_eq!(settings.2, None);
    assert_eq!(settings.3, 1);
    assert_eq!(settings.4, 90);
    assert_eq!(settings.5, 1);
    assert_eq!(settings.6, 1);
    assert_eq!(settings.7, 1);
    assert_eq!(settings.8, "local");
    assert_eq!(settings.9, "board");

    let issue: (String, String, i64, String) = connection
        .query_row(
            "SELECT title, status, del, source FROM issues WHERE project_id = ?1 AND number = 7",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .expect("migrated issue");
    assert_eq!(issue.0, "keep-title");
    assert_eq!(issue.1, "review");
    assert_eq!(issue.2, 1);
    assert_eq!(issue.3, "local");

    let connection_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM project_forge_connections WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .expect("connection rows");
    assert_eq!(connection_count, 0);

    connection
        .execute(
            "INSERT INTO projects (
                name, repo_path, created_at, last_opened_at, worktree_location,
                worktree_setup_command, completion_action, pr_target, pr_draft
             ) VALUES (
                'fresh', '/tmp/fresh', 2, 2, 'repo_sibling', '',
                'open_pull_request', 'repo_default', 0
             )",
            [],
        )
        .expect("fresh project");
    let fresh: (String, String, i64, i64, i64, i64, i64, String) = connection
        .query_row(
            "SELECT issue_source_mode, issue_sync_scope, issue_sync_enabled,
                    issue_sync_interval_seconds, issue_writeback_close_on_complete,
                    issue_writeback_close_on_pr_merge, issue_writeback_comment, issue_create_source
             FROM projects WHERE repo_path = '/tmp/fresh'",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            },
        )
        .expect("fresh project settings");
    assert_eq!(
        fresh,
        (
            "local".to_string(),
            "assigned_to_me".to_string(),
            1,
            90,
            1,
            1,
            1,
            "local".to_string()
        )
    );
}

#[test]
fn saved_issue_source_settings_survive_reopening_the_database() {
    let file = tempfile::NamedTempFile::new().expect("db file");
    let project_id = {
        let connection = Connection::open(file.path()).expect("create db");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign keys");
        MigrationRunner::default()
            .run(&connection)
            .expect("migrate");
        insert_legacy_project(&connection)
    };

    let saved = {
        let connection = Connection::open(file.path()).expect("open to save");
        super::ProjectIssueSourceRepository::new(&connection)
            .update(UpdateProjectIssueSourceSettings {
                project_id,
                issue_source_mode: Some(IssueSourceMode::Mixed),
                issue_display_mode: Some(IssueDisplayMode::List),
                issue_sync_scope: Some(IssueSyncScope::Label),
                issue_sync_label: Some("bug".to_string()),
                issue_sync_enabled: Some(false),
                issue_sync_interval_seconds: Some(300),
                issue_writeback_close_on_complete: Some(false),
                issue_writeback_close_on_pr_merge: Some(true),
                issue_writeback_comment: Some(false),
                issue_create_source: Some(IssueCreateSource::Local),
            })
            .expect("save settings")
    };

    let connection = Connection::open(file.path()).expect("reopen db");
    let loaded = super::ProjectIssueSourceRepository::new(&connection)
        .get(project_id)
        .expect("read settings")
        .expect("project settings");
    assert_eq!(loaded.issue_source_mode, IssueSourceMode::Mixed);
    assert_eq!(loaded.issue_display_mode, IssueDisplayMode::List);
    assert_eq!(loaded.issue_sync_scope, IssueSyncScope::Label);
    assert_eq!(loaded.issue_sync_label.as_deref(), Some("bug"));
    assert!(!loaded.issue_sync_enabled);
    assert_eq!(loaded.issue_sync_interval_seconds, 300);
    assert!(!loaded.issue_writeback_close_on_complete);
    assert!(loaded.issue_writeback_close_on_pr_merge);
    assert!(!loaded.issue_writeback_comment);
    assert_eq!(loaded.issue_create_source, IssueCreateSource::Local);
    assert_eq!(loaded, saved);
}

fn migrated_project() -> (tempfile::NamedTempFile, i64) {
    let file = tempfile::NamedTempFile::new().expect("db file");
    let project_id = {
        let connection = Connection::open(file.path()).expect("create db");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign keys");
        MigrationRunner::default()
            .run(&connection)
            .expect("migrate");
        insert_legacy_project(&connection)
    };
    (file, project_id)
}

fn full_update(project_id: i64) -> UpdateProjectIssueSourceSettings {
    UpdateProjectIssueSourceSettings {
        project_id,
        issue_source_mode: Some(IssueSourceMode::Local),
        issue_display_mode: Some(IssueDisplayMode::Board),
        issue_sync_scope: Some(IssueSyncScope::AssignedToMe),
        issue_sync_label: None,
        issue_sync_enabled: Some(true),
        issue_sync_interval_seconds: Some(90),
        issue_writeback_close_on_complete: Some(true),
        issue_writeback_close_on_pr_merge: Some(true),
        issue_writeback_comment: Some(true),
        issue_create_source: Some(IssueCreateSource::Local),
    }
}

#[test]
fn omitted_sync_enabled_keeps_stored_value_and_explicit_false_stores_zero() {
    let (file, project_id) = migrated_project();
    let connection = Connection::open(file.path()).expect("open");
    let repository = super::ProjectIssueSourceRepository::new(&connection);
    let mut patch = full_update(project_id);
    patch.issue_sync_enabled = None;
    let kept = repository.update(patch).expect("omit enabled");
    assert!(kept.issue_sync_enabled);

    let mut patch = full_update(project_id);
    patch.issue_sync_enabled = Some(false);
    let disabled = repository.update(patch).expect("disable sync");
    assert!(!disabled.issue_sync_enabled);
    let stored: i64 = connection
        .query_row(
            "SELECT issue_sync_enabled FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .expect("stored flag");
    assert_eq!(stored, 0);
}

#[test]
fn mode_sets_create_source_and_mixed_keeps_existing_unless_requested() {
    let (file, project_id) = migrated_project();
    let connection = Connection::open(file.path()).expect("open");
    let repository = super::ProjectIssueSourceRepository::new(&connection);

    let mut remote = full_update(project_id);
    remote.issue_source_mode = Some(IssueSourceMode::Remote);
    remote.issue_create_source = Some(IssueCreateSource::Local);
    let remote = repository.update(remote).expect("remote mode");
    assert_eq!(remote.issue_create_source, IssueCreateSource::Remote);

    let mut mixed = full_update(project_id);
    mixed.issue_source_mode = Some(IssueSourceMode::Mixed);
    mixed.issue_create_source = None;
    let mixed = repository.update(mixed).expect("mixed keeps remote create");
    assert_eq!(mixed.issue_source_mode, IssueSourceMode::Mixed);
    assert_eq!(mixed.issue_create_source, IssueCreateSource::Remote);

    let mut mixed_local = full_update(project_id);
    mixed_local.issue_source_mode = Some(IssueSourceMode::Mixed);
    mixed_local.issue_create_source = Some(IssueCreateSource::Local);
    let mixed_local = repository.update(mixed_local).expect("mixed sets create");
    assert_eq!(mixed_local.issue_create_source, IssueCreateSource::Local);

    let mut local = full_update(project_id);
    local.issue_source_mode = Some(IssueSourceMode::Local);
    local.issue_create_source = Some(IssueCreateSource::Remote);
    let local = repository.update(local).expect("local mode");
    assert_eq!(local.issue_create_source, IssueCreateSource::Local);
}

#[test]
fn invalid_interval_and_blank_label_leave_stored_settings_unchanged() {
    let (file, project_id) = migrated_project();
    let connection = Connection::open(file.path()).expect("open");
    let repository = super::ProjectIssueSourceRepository::new(&connection);
    let before = repository.get(project_id).expect("read").expect("settings");

    let mut interval = full_update(project_id);
    interval.issue_sync_interval_seconds = Some(59);
    let error = repository.update(interval).expect_err("reject 59");
    assert!(
        error.to_string().contains("issueSyncIntervalInvalid"),
        "{error:?}"
    );

    let mut blank = full_update(project_id);
    blank.issue_sync_scope = Some(IssueSyncScope::Label);
    blank.issue_sync_label = Some("   ".to_string());
    let error = repository.update(blank).expect_err("reject blank label");
    assert!(
        error.to_string().contains("issueSyncLabelRequired"),
        "{error:?}"
    );

    let after = repository.get(project_id).expect("read").expect("settings");
    assert_eq!(after, before);
}

#[test]
fn label_scope_trims_label_and_other_scopes_clear_it() {
    let (file, project_id) = migrated_project();
    let connection = Connection::open(file.path()).expect("open");
    let repository = super::ProjectIssueSourceRepository::new(&connection);
    let mut labeled = full_update(project_id);
    labeled.issue_sync_scope = Some(IssueSyncScope::Label);
    labeled.issue_sync_label = Some("  bug  ".to_string());
    let labeled = repository.update(labeled).expect("trim label");
    assert_eq!(labeled.issue_sync_label.as_deref(), Some("bug"));

    for (seconds, scope) in [
        (60, IssueSyncScope::AssignedToMe),
        (90, IssueSyncScope::AllOpen),
        (300, IssueSyncScope::All),
    ] {
        let mut patch = full_update(project_id);
        patch.issue_sync_scope = Some(scope);
        patch.issue_sync_interval_seconds = Some(seconds);
        patch.issue_sync_label = Some("bug".to_string());
        let saved = repository.update(patch).expect("save interval");
        assert_eq!(saved.issue_sync_interval_seconds, seconds);
        assert_eq!(saved.issue_sync_label, None);
    }
}

#[test]
fn switching_issue_source_mode_does_not_change_issue_history() {
    let (file, project_id) = migrated_project();
    let connection = Connection::open(file.path()).expect("open");
    connection
        .execute(
            "INSERT INTO issues (
                project_id, number, title, description, status, created_at, updated_at, del
             ) VALUES (?1, 7, 'keep-title', 'keep-body', 'review', 10, 20, 0)",
            params![project_id],
        )
        .expect("issue");
    let issue_id: i64 = connection
        .query_row("SELECT id FROM issues WHERE number = 7", [], |row| {
            row.get(0)
        })
        .expect("issue id");
    connection
        .execute(
            "INSERT INTO issue_comments (issue_id, body, created_at) VALUES (?1, 'note', 11)",
            params![issue_id],
        )
        .expect("comment");
    connection
        .execute(
            "INSERT INTO issue_attachments (
                issue_id, display_name, stored_name, relative_path, absolute_path,
                mime_type, file_size, kind, is_previewable, created_at
             ) VALUES (?1, 'a.txt', 'a.txt', 'a.txt', '/tmp/a.txt', 'text/plain', 3, 'file', 1, 12)",
            params![issue_id],
        )
        .expect("attachment");
    connection
        .execute(
            "INSERT INTO agent_profiles (
                id, name, agent_type, command, scope, project_id, mode, dangerous,
                default_skill, prompt_template, del
             ) VALUES (100, 'Codex', 'codex', 'codex', 'project', ?1, 'full-auto', 1, '', '', 0)",
            params![project_id],
        )
        .expect("profile");
    connection
        .execute(
            "INSERT INTO agent_sessions (
                id, project_id, issue_id, agent_profile_id, status, attention,
                working_dir, command_snapshot, prompt_snapshot, log_path,
                last_active_at, started_at, del
             ) VALUES (
                50, ?1, ?2, 100, 'closed', 'none',
                '/tmp/repo', 'codex', '', '/tmp/s.log',
                13, 13, 0
             )",
            params![project_id, issue_id],
        )
        .expect("session");
    connection
        .execute(
            "INSERT INTO issue_completion_flows (
                issue_id, session_id, phase, updated_at
             ) VALUES (?1, 50, 'completed', 14)",
            params![issue_id],
        )
        .expect("completion flow");
    connection
        .execute(
            "INSERT INTO completion_attempts (
                issue_id, session_id, option, head_before, head_after, result, created_at
             ) VALUES (?1, 50, 'complete_manual', 'aaa', 'bbb', 'completed', 15)",
            params![issue_id],
        )
        .expect("completion attempt");

    let before = history_snapshot(&connection);
    let repository = super::ProjectIssueSourceRepository::new(&connection);
    for mode in [
        IssueSourceMode::Remote,
        IssueSourceMode::Mixed,
        IssueSourceMode::Local,
    ] {
        let mut patch = full_update(project_id);
        patch.issue_source_mode = Some(mode);
        repository.update(patch).expect("switch mode");
    }
    assert_eq!(history_snapshot(&connection), before);
}

fn history_snapshot(connection: &Connection) -> Vec<(String, String)> {
    let tables = [
        "issues",
        "issue_comments",
        "issue_attachments",
        "agent_sessions",
        "issue_completion_flows",
        "completion_attempts",
    ];
    tables
        .into_iter()
        .map(|table| {
            let sql = format!("SELECT * FROM {table} ORDER BY id");
            let mut statement = connection.prepare(&sql).expect("prepare snapshot");
            let rows = statement
                .query_map([], |row| {
                    let mut values = Vec::new();
                    for index in 0..row.as_ref().column_count() {
                        values.push(format!("{:?}", row.get_ref(index).expect("cell")));
                    }
                    Ok(values.join("|"))
                })
                .expect("query snapshot")
                .collect::<Result<Vec<_>, _>>()
                .expect("snapshot rows");
            (table.to_string(), rows.join("\n"))
        })
        .collect()
}
