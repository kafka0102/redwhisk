use std::fs;
use std::path::Path;
use std::process::Command;

use redwhisk_lib::core::issue_service::IssueService;
use redwhisk_lib::db::agent_profile_repository::AgentProfileRepository;
use redwhisk_lib::db::agent_session_repository::AgentSessionRepository;
use redwhisk_lib::db::connection::DatabaseConfig;
use redwhisk_lib::db::event_repository::EventRepository;
use redwhisk_lib::db::issue_repository::IssueRepository;
use redwhisk_lib::db::migrations::MigrationRunner;
use redwhisk_lib::db::project_repository::ProjectRepository;
use redwhisk_lib::types::agent_profile::{AgentScope, AgentType};
use redwhisk_lib::types::agent_session::{AgentSessionAttention, AgentSessionStatus};
use redwhisk_lib::types::errors::CommandErrorCode;
use redwhisk_lib::types::issue::{
    CompleteIssueCleanInput, CompleteIssueManualInput, CreateIssueInput, IssueStatus,
    MarkIssueReviewInput, PrepareAgentCommitCompletionInput, UpdateIssueInput,
};
use redwhisk_lib::types::issue_action::IssueActionType;
use redwhisk_lib::types::project::ProjectCompletionPolicy;
use redwhisk_lib::types::session_event::SessionEventType;

#[test]
fn issue_migration_creates_issues_schema_with_project_index() {
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
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'issues'",
            [],
            |row| row.get(0),
        )
        .expect("issues table count");
    assert_eq!(table_count, 1);

    let columns = table_columns(&database.connection, "issues");
    assert_eq!(
        columns,
        vec![
            "id",
            "project_id",
            "title",
            "description",
            "status",
            "created_at",
            "updated_at"
        ],
    );
    assert_eq!(
        table_column_type(&database.connection, "issues", "id"),
        "INTEGER"
    );
    assert_eq!(
        table_column_type(&database.connection, "issues", "project_id"),
        "INTEGER"
    );
    assert_eq!(
        table_column_type(&database.connection, "issues", "created_at"),
        "INTEGER"
    );
    assert_eq!(
        table_column_type(&database.connection, "issues", "updated_at"),
        "INTEGER"
    );

    let index_count: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_index_list('issues') WHERE name = 'idx_issues_project_id_updated_at'",
            [],
            |row| row.get(0),
        )
        .expect("project issue index count");
    assert_eq!(index_count, 1);

    let project_foreign_key_count: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_foreign_key_list('issues') WHERE [table] = 'projects' AND [from] = 'project_id' AND [to] = 'id'",
            [],
            |row| row.get(0),
        )
        .expect("project foreign key count");
    assert_eq!(project_foreign_key_count, 1);
}

#[test]
fn issue_action_migration_creates_issue_actions_schema_with_issue_index() {
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
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'issue_actions'",
            [],
            |row| row.get(0),
        )
        .expect("issue actions table count");
    assert_eq!(table_count, 1);

    let columns = table_columns(&database.connection, "issue_actions");
    assert_eq!(
        columns,
        vec![
            "id",
            "issue_id",
            "action_type",
            "payload_json",
            "created_at"
        ],
    );
    assert_eq!(
        table_column_type(&database.connection, "issue_actions", "id"),
        "INTEGER"
    );
    assert_eq!(
        table_column_type(&database.connection, "issue_actions", "issue_id"),
        "INTEGER"
    );
    assert_eq!(
        table_column_type(&database.connection, "issue_actions", "payload_json"),
        "TEXT"
    );
    assert_eq!(
        table_column_type(&database.connection, "issue_actions", "created_at"),
        "INTEGER"
    );

    let index_count: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_index_list('issue_actions') WHERE name = 'idx_issue_actions_issue_id_created_at'",
            [],
            |row| row.get(0),
        )
        .expect("issue action index count");
    assert_eq!(index_count, 1);

    let issue_foreign_key_count: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_foreign_key_list('issue_actions') WHERE [table] = 'issues' AND [from] = 'issue_id' AND [to] = 'id'",
            [],
            |row| row.get(0),
        )
        .expect("issue foreign key count");
    assert_eq!(issue_foreign_key_count, 1);
}

#[test]
fn create_issue_defaults_to_backlog_and_saves_timestamps() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );

    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "  Write local issue  ".to_string(),
            description: "  Keep the shape small.  ".to_string(),
        })
        .expect("created issue");

    assert!(issue.id > 0);
    assert_eq!(issue.project_id, project_id);
    assert_eq!(issue.title, "Write local issue");
    assert_eq!(issue.description, "Keep the shape small.");
    assert_eq!(issue.status, IssueStatus::Backlog);
    assert_eq!(issue.created_at, issue.updated_at);
    assert!(issue.created_at > 1_700_000_000_000);

    let actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue.id)
        .expect("issue actions");
    assert_eq!(actions.len(), 1);
    assert_eq!(actions[0].issue_id, issue.id);
    assert_eq!(actions[0].action_type, IssueActionType::IssueCreated);
    assert_eq!(actions[0].created_at, issue.created_at);

    let payload: serde_json::Value =
        serde_json::from_str(&actions[0].payload_json).expect("payload json");
    assert_eq!(payload["title"], "Write local issue");
    assert_eq!(payload["description"], "Keep the shape small.");
    assert_eq!(payload["status"], "backlog");
}

#[test]
fn create_issue_rolls_back_issue_when_issue_action_insert_fails() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo");
    database
        .connection
        .execute_batch(
            "CREATE TRIGGER reject_issue_action_insert
             BEFORE INSERT ON issue_actions
             BEGIN
               SELECT RAISE(FAIL, 'reject issue action insert');
             END;",
        )
        .expect("create trigger");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );

    let error = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Rollback me".to_string(),
            description: "Do not persist".to_string(),
        })
        .expect_err("issue action insert should fail");

    assert_eq!(error.code, CommandErrorCode::IssuePersistenceFailed);

    let issue_count: i64 = database
        .connection
        .query_row("SELECT COUNT(*) FROM issues", [], |row| row.get(0))
        .expect("issue count");
    assert_eq!(issue_count, 0);

    let action_count: i64 = database
        .connection
        .query_row("SELECT COUNT(*) FROM issue_actions", [], |row| row.get(0))
        .expect("issue action count");
    assert_eq!(action_count, 0);
}

#[test]
fn update_issue_trims_fields_and_advances_updated_at() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "First title".to_string(),
            description: "First description".to_string(),
        })
        .expect("created issue");
    database
        .connection
        .execute(
            "UPDATE issues SET updated_at = 1780624800000 WHERE id = ?1",
            [issue.id],
        )
        .expect("older timestamp");

    let updated = service
        .update_issue(UpdateIssueInput {
            project_id,
            issue_id: issue.id,
            title: "  Next title  ".to_string(),
            description: "  Next description  ".to_string(),
        })
        .expect("updated issue");

    assert_eq!(updated.id, issue.id);
    assert_eq!(updated.title, "Next title");
    assert_eq!(updated.description, "Next description");
    assert!(updated.updated_at > 1_780_624_800_000);
    assert_eq!(updated.created_at, issue.created_at);
}

#[test]
fn update_issue_is_scoped_to_project() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let first_project_id = insert_project(&database.connection, "first-repo");
    let second_project_id = insert_project(&database.connection, "second-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id: first_project_id,
            title: "First project issue".to_string(),
            description: "Do not leak".to_string(),
        })
        .expect("created issue");

    let error = service
        .update_issue(UpdateIssueInput {
            project_id: second_project_id,
            issue_id: issue.id,
            title: "Wrong project update".to_string(),
            description: "Should fail".to_string(),
        })
        .expect_err("cross-project update should fail");

    assert_eq!(error.code, CommandErrorCode::IssueNotFound);
    let stored_issue = IssueRepository::new(&database.connection)
        .find_by_id(issue.id)
        .expect("query issue")
        .expect("issue still exists");
    assert_eq!(stored_issue.title, "First project issue");
    assert_eq!(stored_issue.description, "Do not leak");
}

#[test]
fn update_issue_rejects_missing_issue() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );

    let error = service
        .update_issue(UpdateIssueInput {
            project_id,
            issue_id: 404,
            title: "Missing".to_string(),
            description: "Missing".to_string(),
        })
        .expect_err("missing issue should fail");

    assert_eq!(error.code, CommandErrorCode::IssueNotFound);
}

#[test]
fn mark_issue_review_updates_running_issue_and_records_action_without_closing_session() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "review-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Ready for review".to_string(),
            description: "".to_string(),
        })
        .expect("created issue");
    database
        .connection
        .execute(
            "UPDATE issues SET status = 'running' WHERE id = ?1",
            [issue.id],
        )
        .expect("set running");
    let profile_id = insert_agent_profile(&database.connection);
    let session_id = insert_agent_session_for_issue(
        &database.connection,
        project_id,
        issue.id,
        profile_id,
        "running",
    );

    let reviewed = service
        .mark_issue_review(MarkIssueReviewInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("mark review");

    assert_eq!(reviewed.id, issue.id);
    assert_eq!(reviewed.status, IssueStatus::Review);
    assert!(reviewed.updated_at > issue.updated_at);

    let session_status: String = database
        .connection
        .query_row(
            "SELECT status FROM agent_sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .expect("session status");
    assert_eq!(session_status, "running");

    let actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue.id)
        .expect("issue actions");
    assert_eq!(actions.len(), 2);
    assert_eq!(actions[0].action_type, IssueActionType::IssueReviewMarked);
    assert_eq!(actions[1].action_type, IssueActionType::IssueCreated);

    let payload: serde_json::Value =
        serde_json::from_str(&actions[0].payload_json).expect("payload json");
    assert_eq!(payload["fromStatus"], "running");
    assert_eq!(payload["toStatus"], "review");
    assert_eq!(payload["linkedSessionId"], session_id);
}

#[test]
fn mark_issue_review_rejects_non_running_issue_without_action() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "review-state-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Already review".to_string(),
            description: "".to_string(),
        })
        .expect("created issue");
    database
        .connection
        .execute(
            "UPDATE issues SET status = 'review' WHERE id = ?1",
            [issue.id],
        )
        .expect("set review");
    let profile_id = insert_agent_profile(&database.connection);
    insert_agent_session_for_issue(
        &database.connection,
        project_id,
        issue.id,
        profile_id,
        "running",
    );

    let error = service
        .mark_issue_review(MarkIssueReviewInput {
            project_id,
            issue_id: issue.id,
        })
        .expect_err("review issue should be rejected");

    assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);
    let stored_issue = IssueRepository::new(&database.connection)
        .find_by_id(issue.id)
        .expect("query issue")
        .expect("issue still exists");
    assert_eq!(stored_issue.status, IssueStatus::Review);
    let actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue.id)
        .expect("issue actions");
    assert_eq!(actions.len(), 1);
    assert_eq!(actions[0].action_type, IssueActionType::IssueCreated);
}

#[test]
fn mark_issue_review_rejects_issue_without_running_linked_session() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "review-session-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "No session".to_string(),
            description: "".to_string(),
        })
        .expect("created issue");
    database
        .connection
        .execute(
            "UPDATE issues SET status = 'running' WHERE id = ?1",
            [issue.id],
        )
        .expect("set running");

    let error = service
        .mark_issue_review(MarkIssueReviewInput {
            project_id,
            issue_id: issue.id,
        })
        .expect_err("missing linked session should be rejected");

    assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);
    let stored_issue = IssueRepository::new(&database.connection)
        .find_by_id(issue.id)
        .expect("query issue")
        .expect("issue still exists");
    assert_eq!(stored_issue.status, IssueStatus::Running);
    let actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue.id)
        .expect("issue actions");
    assert_eq!(actions.len(), 1);
}

#[test]
fn mark_issue_review_rejects_cross_project_issue_without_action() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let first_project_id = insert_project(&database.connection, "first-review-repo");
    let second_project_id = insert_project(&database.connection, "second-review-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id: first_project_id,
            title: "Wrong project".to_string(),
            description: "".to_string(),
        })
        .expect("created issue");
    database
        .connection
        .execute(
            "UPDATE issues SET status = 'running' WHERE id = ?1",
            [issue.id],
        )
        .expect("set running");
    let profile_id = insert_agent_profile(&database.connection);
    insert_agent_session_for_issue(
        &database.connection,
        first_project_id,
        issue.id,
        profile_id,
        "running",
    );

    let error = service
        .mark_issue_review(MarkIssueReviewInput {
            project_id: second_project_id,
            issue_id: issue.id,
        })
        .expect_err("cross-project mark review should fail");

    assert_eq!(error.code, CommandErrorCode::IssueNotFound);
    let stored_issue = IssueRepository::new(&database.connection)
        .find_by_id(issue.id)
        .expect("query issue")
        .expect("issue still exists");
    assert_eq!(stored_issue.status, IssueStatus::Running);
    let actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue.id)
        .expect("issue actions");
    assert_eq!(actions.len(), 1);
}

#[test]
fn complete_issue_manual_closes_running_session_and_records_audit() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "complete-review-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Ready to complete".to_string(),
            description: "".to_string(),
        })
        .expect("created issue");
    database
        .connection
        .execute(
            "UPDATE issues SET status = 'review' WHERE id = ?1",
            [issue.id],
        )
        .expect("set review");
    let profile_id = insert_agent_profile(&database.connection);
    let session_id = insert_agent_session_for_issue(
        &database.connection,
        project_id,
        issue.id,
        profile_id,
        "running",
    );

    let completed = service
        .complete_issue_manual(CompleteIssueManualInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("complete manually");

    assert_eq!(completed.id, issue.id);
    assert_eq!(completed.status, IssueStatus::Completed);
    assert!(completed.updated_at > issue.updated_at);

    let stored_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("query session")
        .expect("session exists");
    assert_eq!(stored_session.status, AgentSessionStatus::Closed);
    assert_eq!(stored_session.closed_at, Some(completed.updated_at));

    let actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue.id)
        .expect("issue actions");
    assert_eq!(actions.len(), 2);
    assert_eq!(actions[0].action_type, IssueActionType::IssueCompleted);
    assert_eq!(actions[1].action_type, IssueActionType::IssueCreated);
    let action_payload: serde_json::Value =
        serde_json::from_str(&actions[0].payload_json).expect("payload json");
    assert_eq!(action_payload["fromStatus"], "review");
    assert_eq!(action_payload["toStatus"], "completed");
    assert_eq!(action_payload["linkedSessionId"], session_id);
    assert_eq!(action_payload["option"], "complete_manual");

    let events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, SessionEventType::SessionClosed);
    let event_payload: serde_json::Value =
        serde_json::from_str(&events[0].payload_json).expect("payload json");
    assert_eq!(event_payload["sessionId"], session_id);
    assert_eq!(event_payload["issueId"], issue.id);
    assert_eq!(event_payload["status"], "closed");
    assert_eq!(event_payload["reason"], "manual_completion");
}

#[test]
fn complete_issue_manual_rejects_non_review_issue_without_partial_write() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "complete-invalid-state-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Still running".to_string(),
            description: "".to_string(),
        })
        .expect("created issue");
    database
        .connection
        .execute(
            "UPDATE issues SET status = 'running' WHERE id = ?1",
            [issue.id],
        )
        .expect("set running");
    let profile_id = insert_agent_profile(&database.connection);
    let session_id = insert_agent_session_for_issue(
        &database.connection,
        project_id,
        issue.id,
        profile_id,
        "running",
    );

    let error = service
        .complete_issue_manual(CompleteIssueManualInput {
            project_id,
            issue_id: issue.id,
        })
        .expect_err("non-review issue should be rejected");

    assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);
    let stored_issue = IssueRepository::new(&database.connection)
        .find_by_id(issue.id)
        .expect("query issue")
        .expect("issue exists");
    assert_eq!(stored_issue.status, IssueStatus::Running);
    let stored_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("query session")
        .expect("session exists");
    assert_eq!(stored_session.status, AgentSessionStatus::Running);
    assert_eq!(stored_session.closed_at, None);
    let actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue.id)
        .expect("issue actions");
    assert_eq!(actions.len(), 1);
    let events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert!(events.is_empty());
}

#[test]
fn complete_issue_clean_closes_running_session_and_records_audit() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("clean-complete-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    let head = git_output(&repo_dir, &["rev-parse", "HEAD"]);

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "clean-complete-repo",
        &repo_dir,
        ProjectCompletionPolicy::AgentAutoCommit,
    );
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Ready to complete cleanly".to_string(),
            description: "".to_string(),
        })
        .expect("created issue");
    database
        .connection
        .execute(
            "UPDATE issues SET status = 'review' WHERE id = ?1",
            [issue.id],
        )
        .expect("set review");
    let profile_id = insert_agent_profile(&database.connection);
    let session_id = insert_agent_session_for_issue(
        &database.connection,
        project_id,
        issue.id,
        profile_id,
        "running",
    );

    let completed = service
        .complete_issue_clean(CompleteIssueCleanInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("complete clean");

    assert_eq!(completed.id, issue.id);
    assert_eq!(completed.status, IssueStatus::Completed);

    let stored_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("query session")
        .expect("session exists");
    assert_eq!(stored_session.status, AgentSessionStatus::Closed);
    assert_eq!(stored_session.closed_at, Some(completed.updated_at));

    let actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue.id)
        .expect("issue actions");
    assert_eq!(actions.len(), 2);
    assert_eq!(actions[0].action_type, IssueActionType::IssueCompleted);
    let action_payload: serde_json::Value =
        serde_json::from_str(&actions[0].payload_json).expect("payload json");
    assert_eq!(action_payload["fromStatus"], "review");
    assert_eq!(action_payload["toStatus"], "completed");
    assert_eq!(action_payload["linkedSessionId"], session_id);
    assert_eq!(action_payload["option"], "complete_clean");

    let events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, SessionEventType::SessionClosed);
    let event_payload: serde_json::Value =
        serde_json::from_str(&events[0].payload_json).expect("payload json");
    assert_eq!(event_payload["reason"], "clean_completion");

    let attempt_count: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM completion_attempts WHERE issue_id = ?1",
            [issue.id],
            |row| row.get(0),
        )
        .expect("completion attempt count");
    assert_eq!(attempt_count, 1);

    let attempt = database
        .connection
        .query_row(
            "SELECT session_id, option, head_before, head_after, result
             FROM completion_attempts
             WHERE issue_id = ?1",
            [issue.id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .expect("completion attempt");
    assert_eq!(attempt.0, session_id);
    assert_eq!(attempt.1, "complete_clean");
    assert_eq!(attempt.2, head);
    assert_eq!(attempt.3, head);
    assert_eq!(attempt.4, "completed");
}

#[test]
fn complete_issue_clean_rejects_dirty_worktree_without_partial_write() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("dirty-complete-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    write_file(&repo_dir, "tracked.txt", "dirty change\n");

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "dirty-complete-repo",
        &repo_dir,
        ProjectCompletionPolicy::AgentAutoCommit,
    );
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Dirty worktree should block".to_string(),
            description: "".to_string(),
        })
        .expect("created issue");
    database
        .connection
        .execute(
            "UPDATE issues SET status = 'review' WHERE id = ?1",
            [issue.id],
        )
        .expect("set review");
    let profile_id = insert_agent_profile(&database.connection);
    let session_id = insert_agent_session_for_issue(
        &database.connection,
        project_id,
        issue.id,
        profile_id,
        "running",
    );

    let error = service
        .complete_issue_clean(CompleteIssueCleanInput {
            project_id,
            issue_id: issue.id,
        })
        .expect_err("dirty worktree should be rejected");

    assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);

    let stored_issue = IssueRepository::new(&database.connection)
        .find_by_id(issue.id)
        .expect("query issue")
        .expect("issue exists");
    assert_eq!(stored_issue.status, IssueStatus::Review);

    let stored_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("query session")
        .expect("session exists");
    assert_eq!(stored_session.status, AgentSessionStatus::Running);
    assert_eq!(stored_session.closed_at, None);

    let actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue.id)
        .expect("issue actions");
    assert_eq!(actions.len(), 1);

    let events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert!(events.is_empty());

    let attempt_count: i64 = database
        .connection
        .query_row("SELECT COUNT(*) FROM completion_attempts", [], |row| {
            row.get(0)
        })
        .expect("completion attempt count");
    assert_eq!(attempt_count, 0);
}

#[test]
fn prepare_agent_commit_completion_returns_preview_for_dirty_review_issue() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("prepare-agent-commit-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    write_file(&repo_dir, "tracked.txt", "dirty change\n");

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "prepare-agent-commit-repo",
        &repo_dir,
        ProjectCompletionPolicy::AgentAutoCommit,
    );
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Review issue".to_string(),
            description: "".to_string(),
        })
        .expect("created issue");
    database
        .connection
        .execute(
            "UPDATE issues SET status = 'review' WHERE id = ?1",
            [issue.id],
        )
        .expect("set review");
    let profile_id = insert_agent_profile(&database.connection);
    let session_id = insert_agent_session_for_issue(
        &database.connection,
        project_id,
        issue.id,
        profile_id,
        "running",
    );

    let preview = service
        .prepare_agent_commit_completion(PrepareAgentCommitCompletionInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("prepare completion preview");

    assert_eq!(preview.issue_id, issue.id);
    assert_eq!(preview.session_id, session_id);
    assert_eq!(preview.option, "complete_agent_commit");
    assert_eq!(preview.changed_files_count, 1);
    assert_eq!(preview.changed_files.len(), 1);
    assert_eq!(preview.changed_files[0].path, "tracked.txt");
    assert!(preview.completion_prompt.contains("Review issue"));
}

#[test]
fn prepare_agent_commit_completion_rejects_clean_repo() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("prepare-agent-commit-clean-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "prepare-agent-commit-clean-repo",
        &repo_dir,
        ProjectCompletionPolicy::AgentAutoCommit,
    );
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Review issue".to_string(),
            description: "".to_string(),
        })
        .expect("created issue");
    database
        .connection
        .execute(
            "UPDATE issues SET status = 'review' WHERE id = ?1",
            [issue.id],
        )
        .expect("set review");
    let profile_id = insert_agent_profile(&database.connection);
    insert_agent_session_for_issue(
        &database.connection,
        project_id,
        issue.id,
        profile_id,
        "running",
    );

    let error = service
        .prepare_agent_commit_completion(PrepareAgentCommitCompletionInput {
            project_id,
            issue_id: issue.id,
        })
        .expect_err("clean repo should be rejected");

    assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);
}

#[test]
fn update_issue_advances_timestamp_monotonically_from_future_timestamp() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Future timestamp".to_string(),
            description: "".to_string(),
        })
        .expect("created issue");
    database
        .connection
        .execute(
            "UPDATE issues SET updated_at = 4102444800000 WHERE id = ?1",
            [issue.id],
        )
        .expect("future timestamp");

    let updated = service
        .update_issue(UpdateIssueInput {
            project_id,
            issue_id: issue.id,
            title: "Future timestamp updated".to_string(),
            description: "".to_string(),
        })
        .expect("updated issue");

    assert_eq!(updated.updated_at, 4_102_444_800_001);
}

#[test]
fn deleting_project_cascades_to_issues() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Cascade issue".to_string(),
            description: "".to_string(),
        })
        .expect("created issue");

    database
        .connection
        .execute("DELETE FROM projects WHERE id = ?1", [project_id])
        .expect("delete project");

    let issue_count: i64 = database
        .connection
        .query_row("SELECT COUNT(*) FROM issues", [], |row| row.get(0))
        .expect("issue count");
    assert_eq!(issue_count, 0);

    let issue_action_count: i64 = database
        .connection
        .query_row("SELECT COUNT(*) FROM issue_actions", [], |row| row.get(0))
        .expect("issue action count");
    assert_eq!(issue_action_count, 0);
}

#[test]
fn create_issue_rejects_empty_title_without_insert() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );

    let error = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "   ".to_string(),
            description: "Description may exist".to_string(),
        })
        .expect_err("empty title should fail");

    assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);
    let count: i64 = database
        .connection
        .query_row("SELECT COUNT(*) FROM issues", [], |row| row.get(0))
        .expect("issue count");
    assert_eq!(count, 0);
}

#[test]
fn list_issues_is_scoped_to_project_and_sorted_by_updated_at() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let first_project_id = insert_project(&database.connection, "first-repo");
    let second_project_id = insert_project(&database.connection, "second-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let older_issue = service
        .create_issue(CreateIssueInput {
            project_id: first_project_id,
            title: "Older".to_string(),
            description: "".to_string(),
        })
        .expect("older issue");
    let newer_issue = service
        .create_issue(CreateIssueInput {
            project_id: first_project_id,
            title: "Newer".to_string(),
            description: "".to_string(),
        })
        .expect("newer issue");
    service
        .create_issue(CreateIssueInput {
            project_id: second_project_id,
            title: "Other project".to_string(),
            description: "".to_string(),
        })
        .expect("other project issue");
    database
        .connection
        .execute(
            "UPDATE issues SET updated_at = 1780624800000 WHERE id = ?1",
            [older_issue.id],
        )
        .expect("older timestamp");
    database
        .connection
        .execute(
            "UPDATE issues SET updated_at = 1780628400000 WHERE id = ?1",
            [newer_issue.id],
        )
        .expect("newer timestamp");

    let response = service
        .list_issues(first_project_id)
        .expect("project issues");

    assert_eq!(response.issues.len(), 2);
    assert_eq!(response.issues[0].id, newer_issue.id);
    assert_eq!(response.issues[1].id, older_issue.id);
    assert!(response
        .issues
        .iter()
        .all(|issue| issue.project_id == first_project_id));
    assert!(response
        .issues
        .iter()
        .all(|issue| issue.linked_session_id.is_none()));
    assert!(response
        .issues
        .iter()
        .all(|issue| issue.linked_session_status.is_none()));
    assert!(response
        .issues
        .iter()
        .all(|issue| issue.linked_session_attention.is_none()));
}

#[test]
fn list_issues_includes_linked_session_facts() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "linked-session-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Linked session issue".to_string(),
            description: "".to_string(),
        })
        .expect("created issue");
    let profile_id = insert_agent_profile(&database.connection);

    database
        .connection
        .execute(
            "INSERT INTO agent_sessions (
                issue_id,
                agent_profile_id,
                status,
                attention,
                working_dir,
                command_snapshot,
                prompt_snapshot,
                log_path,
                last_active_at,
                started_at
            ) VALUES (?1, ?2, 'stopped', 'requested', '/tmp/repo', 'codex', 'prompt', '/tmp/log', 1780628400000, 1780628400000)",
            rusqlite::params![issue.id, profile_id],
        )
        .expect("insert linked session");
    let linked_session_id = database.connection.last_insert_rowid();

    let response = service.list_issues(project_id).expect("project issues");

    assert_eq!(response.issues.len(), 1);
    assert_eq!(response.issues[0].id, issue.id);
    assert_eq!(
        response.issues[0].linked_session_id,
        Some(linked_session_id)
    );
    assert_eq!(
        response.issues[0].linked_session_status,
        Some(AgentSessionStatus::Stopped)
    );
    assert_eq!(
        response.issues[0].linked_session_attention,
        Some(AgentSessionAttention::Requested)
    );
    assert_eq!(
        response.issues[0].linked_session_log_path.as_deref(),
        Some("/tmp/log")
    );
}

#[test]
fn list_issues_ignores_standalone_sessions_in_same_project() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "standalone-isolation-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Issue without linked session".to_string(),
            description: "".to_string(),
        })
        .expect("created issue");
    let profile_id = insert_agent_profile(&database.connection);

    database
        .connection
        .execute(
            "INSERT INTO agent_sessions (
                project_id,
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
            ) VALUES (?1, NULL, 'Scratch Session', ?2, 'closed', 'requested', '/tmp/repo', 'codex', 'prompt', '/tmp/log', 1780628500000, 1780628400000, 1780628600000)",
            rusqlite::params![project_id, profile_id],
        )
        .expect("insert standalone session");

    let response = service.list_issues(project_id).expect("project issues");

    assert_eq!(response.issues.len(), 1);
    assert_eq!(response.issues[0].id, issue.id);
    assert_eq!(response.issues[0].linked_session_id, None);
    assert_eq!(response.issues[0].linked_session_status, None);
    assert_eq!(response.issues[0].linked_session_attention, None);
}

#[test]
fn list_issues_rejects_missing_project() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );

    let error = service
        .list_issues(404)
        .expect_err("missing project should fail");

    assert_eq!(error.code, CommandErrorCode::ProjectNotFound);
}

fn migrated_database(data_dir: &std::path::Path) -> redwhisk_lib::db::connection::Database {
    let database = DatabaseConfig::new(data_dir).open().expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    database
}

fn insert_project(connection: &rusqlite::Connection, name: &str) -> i64 {
    let repo_path = format!("/tmp/{name}");
    ProjectRepository::new(connection)
        .insert(name, &repo_path)
        .expect("insert project")
        .id
}

fn insert_project_with_repo_path_and_policy(
    connection: &rusqlite::Connection,
    name: &str,
    repo_path: &Path,
    completion_policy: ProjectCompletionPolicy,
) -> i64 {
    let completion_policy = match completion_policy {
        ProjectCompletionPolicy::Manual => "manual",
        ProjectCompletionPolicy::AgentAutoCommit => "agent_auto_commit",
    };
    connection
        .execute(
            "INSERT INTO projects (name, repo_path, created_at, last_opened_at, completion_policy)
             VALUES (?1, ?2, 1780624800000, 1780624800000, ?3)",
            rusqlite::params![
                name,
                repo_path.to_string_lossy().to_string(),
                completion_policy
            ],
        )
        .expect("insert project");
    connection.last_insert_rowid()
}

fn insert_agent_profile(connection: &rusqlite::Connection) -> i64 {
    AgentProfileRepository::new(connection)
        .save_profile(
            None,
            "Codex",
            AgentType::Codex,
            "/usr/local/bin/codex",
            &AgentScope::Global,
            None,
            "full-auto",
            true,
            "bmad-dev-story",
            "",
        )
        .expect("insert agent profile")
        .id
}

fn insert_agent_session_for_issue(
    connection: &rusqlite::Connection,
    project_id: i64,
    issue_id: i64,
    agent_profile_id: i64,
    status: &str,
) -> i64 {
    connection
        .execute(
            "INSERT INTO agent_sessions (
                project_id,
                issue_id,
                agent_profile_id,
                status,
                attention,
                working_dir,
                command_snapshot,
                prompt_snapshot,
                log_path,
                last_active_at,
                started_at
            ) VALUES (?1, ?2, ?3, ?4, 'none', '/tmp/repo', 'codex', 'prompt', '/tmp/log', 1780628400000, 1780628400000)",
            rusqlite::params![project_id, issue_id, agent_profile_id, status],
        )
        .expect("insert agent session");
    connection.last_insert_rowid()
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

fn init_repo(path: &Path) {
    fs::create_dir_all(path).expect("create repo dir");
    git(path, &["init", "-b", "main"]);
    git(path, &["config", "user.name", "RedWhisk Test"]);
    git(path, &["config", "user.email", "redwhisk@example.test"]);
}

fn write_file(repo: &Path, relative_path: &str, content: &str) {
    fs::write(repo.join(relative_path), content).expect("write file");
}

fn git(repo: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_output(repo: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("utf8 output")
        .trim()
        .to_string()
}
