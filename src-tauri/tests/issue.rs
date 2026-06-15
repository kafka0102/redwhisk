use std::fs;
use std::path::Path;
use std::process::Command;

use redwhisk_lib::core::issue_service::IssueService;
use redwhisk_lib::db::agent_profile_repository::AgentProfileRepository;
use redwhisk_lib::db::agent_session_repository::AgentSessionRepository;
use redwhisk_lib::db::completion_attempt_repository::CompletionAttemptRepository;
use redwhisk_lib::db::connection::DatabaseConfig;
use redwhisk_lib::db::event_repository::EventRepository;
use redwhisk_lib::db::issue_attachment_repository::IssueAttachmentRepository;
use redwhisk_lib::db::issue_repository::IssueRepository;
use redwhisk_lib::db::migrations::MigrationRunner;
use redwhisk_lib::db::project_repository::ProjectRepository;
use redwhisk_lib::types::agent_profile::{AgentScope, AgentType};
use redwhisk_lib::types::agent_session::{AgentSessionAttention, AgentSessionStatus};
use redwhisk_lib::types::errors::CommandErrorCode;
use redwhisk_lib::types::issue::{
    AdvanceIssueStatusInput, CompleteIssueCleanInput, CompleteIssueManualInput, CreateIssueInput,
    DeleteIssueInput, DetectAgentCommitCompletionInput, ExportIssueAttachmentInput,
    GetIssueSummaryInput, IssueAttachmentInput, IssueAttachmentKind, IssueStatus,
    MarkIssueReviewInput, PrepareAgentCommitCompletionInput, PreviewIssueAttachmentInput,
    SendAgentCommitPromptInput, UpdateIssueInput,
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
            "updated_at",
            "del"
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
fn issue_and_agent_session_soft_delete_columns_exist() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");

    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");

    assert_eq!(
        table_column_type(&database.connection, "issues", "del"),
        "INTEGER"
    );
    assert_eq!(
        table_column_type(&database.connection, "agent_sessions", "del"),
        "INTEGER"
    );
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
fn issue_attachment_migration_creates_issue_attachments_schema_with_issue_index() {
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
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'issue_attachments'",
            [],
            |row| row.get(0),
        )
        .expect("issue attachments table count");
    assert_eq!(table_count, 1);

    let columns = table_columns(&database.connection, "issue_attachments");
    assert_eq!(
        columns,
        vec![
            "id",
            "issue_id",
            "display_name",
            "stored_name",
            "relative_path",
            "absolute_path",
            "mime_type",
            "file_size",
            "kind",
            "is_previewable",
            "created_at"
        ],
    );

    let index_count: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_index_list('issue_attachments') WHERE name = 'idx_issue_attachments_issue_id_created_at'",
            [],
            |row| row.get(0),
        )
        .expect("issue attachment index count");
    assert_eq!(index_count, 1);
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
            attachments: Vec::new(),
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
            attachments: Vec::new(),
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
            attachments: Vec::new(),
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
            attachments: Vec::new(),
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
            attachments: Vec::new(),
        })
        .expect("created issue");

    let error = service
        .update_issue(UpdateIssueInput {
            project_id: second_project_id,
            issue_id: issue.id,
            title: "Wrong project update".to_string(),
            description: "Should fail".to_string(),
            attachments: Vec::new(),
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
            attachments: Vec::new(),
        })
        .expect_err("missing issue should fail");

    assert_eq!(error.code, CommandErrorCode::IssueNotFound);
}

#[test]
fn create_issue_persists_attachment_metadata_and_rewrites_tokens() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("attachment-create-repo");
    fs::create_dir_all(&repo_dir).expect("create repo dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "attachment-create-repo",
        &repo_dir,
        ProjectCompletionPolicy::Manual,
    );
    let source_path = temp_dir.path().join("draft-note.md");
    fs::write(&source_path, "# Draft\n").expect("write draft attachment");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );

    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Issue with attachment".to_string(),
            description: "See {{issue-attachment-temp:draft-1}}".to_string(),
            attachments: vec![IssueAttachmentInput {
                attachment_id: None,
                temp_token: Some("draft-1".to_string()),
                source_path: Some(source_path.to_string_lossy().to_string()),
                display_name: "draft-note.md".to_string(),
                mime_type: Some("text/markdown".to_string()),
            }],
        })
        .expect("created issue");

    assert!(issue.description.contains("{{issue-attachment:"));
    assert_eq!(issue.attachments.len(), 1);
    assert_eq!(issue.attachments[0].display_name, "draft-note.md");
    assert_eq!(issue.attachments[0].kind, IssueAttachmentKind::Text);
    assert!(issue.attachments[0].is_previewable);
    assert_eq!(
        issue.attachments[0].relative_path,
        format!(
            ".redwhisk/issues/{}/attachments/{}",
            issue.id, issue.attachments[0].stored_name
        )
    );
    assert!(Path::new(&issue.attachments[0].absolute_path).exists());
    assert_eq!(
        fs::read_to_string(&issue.attachments[0].absolute_path).expect("read saved attachment"),
        "# Draft\n"
    );

    let attachments = IssueAttachmentRepository::new(&database.connection)
        .list_by_issue_id(issue.id)
        .expect("load attachments");
    assert_eq!(attachments.len(), 1);
    assert_eq!(attachments[0].display_name, "draft-note.md");
}

#[test]
fn update_issue_removes_deleted_attachments_and_keeps_referenced_ones() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("attachment-update-repo");
    fs::create_dir_all(&repo_dir).expect("create repo dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "attachment-update-repo",
        &repo_dir,
        ProjectCompletionPolicy::Manual,
    );
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let first_source = temp_dir.path().join("first.md");
    let second_source = temp_dir.path().join("second.md");
    fs::write(&first_source, "first").expect("write first attachment");
    fs::write(&second_source, "second").expect("write second attachment");

    let created = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Issue attachments".to_string(),
            description: "A {{issue-attachment-temp:first}} B {{issue-attachment-temp:second}}"
                .to_string(),
            attachments: vec![
                IssueAttachmentInput {
                    attachment_id: None,
                    temp_token: Some("first".to_string()),
                    source_path: Some(first_source.to_string_lossy().to_string()),
                    display_name: "first.md".to_string(),
                    mime_type: Some("text/markdown".to_string()),
                },
                IssueAttachmentInput {
                    attachment_id: None,
                    temp_token: Some("second".to_string()),
                    source_path: Some(second_source.to_string_lossy().to_string()),
                    display_name: "second.md".to_string(),
                    mime_type: Some("text/markdown".to_string()),
                },
            ],
        })
        .expect("create issue");
    let removed_attachment = created.attachments[0].clone();
    let kept_attachment = created.attachments[1].clone();

    let updated = service
        .update_issue(UpdateIssueInput {
            project_id,
            issue_id: created.id,
            title: "Issue attachments updated".to_string(),
            description: format!("Only keep {{{{issue-attachment:{}}}}}", kept_attachment.id),
            attachments: vec![IssueAttachmentInput {
                attachment_id: Some(kept_attachment.id),
                temp_token: None,
                source_path: None,
                display_name: kept_attachment.display_name.clone(),
                mime_type: kept_attachment.mime_type.clone(),
            }],
        })
        .expect("update issue");

    assert_eq!(updated.attachments.len(), 1);
    assert_eq!(updated.attachments[0].id, kept_attachment.id);
    assert!(!Path::new(&removed_attachment.absolute_path).exists());
    assert!(Path::new(&kept_attachment.absolute_path).exists());
}

#[test]
fn preview_issue_attachment_returns_text_for_saved_and_draft_files() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("attachment-preview-repo");
    fs::create_dir_all(&repo_dir).expect("create repo dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "attachment-preview-repo",
        &repo_dir,
        ProjectCompletionPolicy::Manual,
    );
    let source_path = temp_dir.path().join("preview.md");
    fs::write(&source_path, "preview text").expect("write attachment");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Preview attachment".to_string(),
            description: "See {{issue-attachment-temp:draft}}".to_string(),
            attachments: vec![IssueAttachmentInput {
                attachment_id: None,
                temp_token: Some("draft".to_string()),
                source_path: Some(source_path.to_string_lossy().to_string()),
                display_name: "preview.md".to_string(),
                mime_type: Some("text/markdown".to_string()),
            }],
        })
        .expect("create issue");

    let saved_preview = service
        .preview_issue_attachment(PreviewIssueAttachmentInput {
            project_id,
            attachment_id: Some(issue.attachments[0].id),
            source_path: None,
            display_name: None,
        })
        .expect("saved preview");
    assert_eq!(saved_preview.text_content.as_deref(), Some("preview text"));
    assert_eq!(saved_preview.kind, IssueAttachmentKind::Text);

    let draft_preview = service
        .preview_issue_attachment(PreviewIssueAttachmentInput {
            project_id,
            attachment_id: None,
            source_path: Some(source_path.to_string_lossy().to_string()),
            display_name: Some("preview.md".to_string()),
        })
        .expect("draft preview");
    assert_eq!(draft_preview.text_content.as_deref(), Some("preview text"));
    assert_eq!(draft_preview.attachment_id, None);
}

#[test]
fn preview_issue_attachment_rejects_non_previewable_binary_file() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("attachment-binary-repo");
    fs::create_dir_all(&repo_dir).expect("create repo dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "attachment-binary-repo",
        &repo_dir,
        ProjectCompletionPolicy::Manual,
    );
    let source_path = temp_dir.path().join("archive.bin");
    fs::write(&source_path, [0_u8, 159, 146, 150]).expect("write binary attachment");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );

    let error = service
        .preview_issue_attachment(PreviewIssueAttachmentInput {
            project_id,
            attachment_id: None,
            source_path: Some(source_path.to_string_lossy().to_string()),
            display_name: Some("archive.bin".to_string()),
        })
        .expect_err("binary preview should fail");

    assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);
}

#[test]
fn export_issue_attachment_supports_saved_and_draft_files() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("attachment-export-repo");
    fs::create_dir_all(&repo_dir).expect("create repo dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "attachment-export-repo",
        &repo_dir,
        ProjectCompletionPolicy::Manual,
    );
    let source_path = temp_dir.path().join("export.txt");
    fs::write(&source_path, "export me").expect("write source");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Export attachment".to_string(),
            description: "See {{issue-attachment-temp:draft}}".to_string(),
            attachments: vec![IssueAttachmentInput {
                attachment_id: None,
                temp_token: Some("draft".to_string()),
                source_path: Some(source_path.to_string_lossy().to_string()),
                display_name: "export.txt".to_string(),
                mime_type: Some("text/plain".to_string()),
            }],
        })
        .expect("create issue");
    let saved_target = temp_dir.path().join("saved-copy.txt");
    let draft_target = temp_dir.path().join("draft-copy.txt");

    service
        .export_issue_attachment(ExportIssueAttachmentInput {
            project_id,
            attachment_id: Some(issue.attachments[0].id),
            source_path: None,
            display_name: None,
            target_path: saved_target.to_string_lossy().to_string(),
        })
        .expect("export saved attachment");
    service
        .export_issue_attachment(ExportIssueAttachmentInput {
            project_id,
            attachment_id: None,
            source_path: Some(source_path.to_string_lossy().to_string()),
            display_name: Some("export.txt".to_string()),
            target_path: draft_target.to_string_lossy().to_string(),
        })
        .expect("export draft attachment");

    assert_eq!(
        fs::read_to_string(saved_target).expect("read saved copy"),
        "export me"
    );
    assert_eq!(
        fs::read_to_string(draft_target).expect("read draft copy"),
        "export me"
    );
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
            attachments: Vec::new(),
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
            attachments: Vec::new(),
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
            attachments: Vec::new(),
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
            attachments: Vec::new(),
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
            attachments: Vec::new(),
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
            attachments: Vec::new(),
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
fn get_issue_summary_falls_back_to_issue_completed_action_for_manual_completion() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "summary-manual-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Manual completed issue".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
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

    service
        .complete_issue_manual(CompleteIssueManualInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("complete manually");

    let summary = service
        .get_issue_summary(GetIssueSummaryInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("summary");

    assert_eq!(summary.issue.status, IssueStatus::Completed);
    assert_eq!(summary.issue.linked_session_id, Some(session_id));
    assert_eq!(
        summary.completion.as_ref().map(|info| info.option.as_str()),
        Some("complete_manual")
    );
    assert_eq!(
        summary.completion.as_ref().map(|info| info.result.as_str()),
        Some("completed")
    );
    assert_eq!(
        summary
            .completion
            .as_ref()
            .and_then(|info| info.commit_hash.as_deref()),
        None
    );
    assert!(summary
        .diagnostics
        .iter()
        .any(|item| item.contains("缺少 CompletionAttempt 记录")));
}

#[test]
fn get_issue_summary_uses_final_completed_fact_after_failed_attempt_then_manual_completion() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("summary-final-fact-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    write_file(&repo_dir, "tracked.txt", "dirty change\n");

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "summary-final-fact-repo",
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
            title: "Manual complete after failed attempt".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
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

    let pty_sessions = redwhisk_lib::agent::pty_session_manager::PtySessionManager::new();
    let pending = pty_sessions
        .spawn_pending(&redwhisk_lib::agent::pty_session_manager::PtySpawnRequest {
            command: "/bin/sh".to_string(),
            working_dir: repo_dir.to_string_lossy().into_owned(),
            log_path: temp_dir
                .path()
                .join("session.log")
                .to_string_lossy()
                .into_owned(),
            initial_prompt: None,
            rows: 24,
            cols: 80,
            startup_check_total_ms: 200,
            startup_check_interval_ms: 25,
        })
        .expect("spawn pending");
    pty_sessions.register(session_id, pending, |_| {});

    service
        .send_agent_commit_prompt(
            SendAgentCommitPromptInput {
                project_id,
                issue_id: issue.id,
            },
            temp_dir.path(),
            &pty_sessions,
        )
        .expect("send prompt");

    let failed_completion = service
        .detect_agent_commit_completion(DetectAgentCommitCompletionInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("detect no commit");
    assert_eq!(
        failed_completion.outcome,
        redwhisk_lib::types::issue::DetectAgentCommitCompletionOutcome::NoCommitDetected
    );

    service
        .complete_issue_manual(CompleteIssueManualInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("manual complete");

    let summary = service
        .get_issue_summary(GetIssueSummaryInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("summary");

    assert_eq!(summary.issue.status, IssueStatus::Completed);
    assert_eq!(
        summary.completion.as_ref().map(|info| info.option.as_str()),
        Some("complete_manual")
    );
    assert_eq!(
        summary.completion.as_ref().map(|info| info.source.as_str()),
        Some("issue_action_fallback")
    );
    assert!(summary
        .diagnostics
        .iter()
        .any(|item| item.contains("未找到可代表最终 completed")));
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
            attachments: Vec::new(),
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
            attachments: Vec::new(),
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
fn complete_issue_clean_records_blocked_attempt_when_git_operation_is_in_progress() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("blocked-clean-complete-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "conflict.txt", "base\n");
    git(&repo_dir, &["add", "conflict.txt"]);
    git(&repo_dir, &["commit", "-m", "base"]);
    git(&repo_dir, &["checkout", "-b", "feature"]);
    write_file(&repo_dir, "conflict.txt", "feature\n");
    git(&repo_dir, &["commit", "-am", "feature"]);
    git(&repo_dir, &["checkout", "main"]);
    write_file(&repo_dir, "conflict.txt", "main\n");
    git(&repo_dir, &["commit", "-am", "main"]);
    git_expect_failure(&repo_dir, &["merge", "feature"]);

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "blocked-clean-complete-repo",
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
            title: "Blocked clean complete".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
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
        .expect_err("git operation should block complete");

    assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);
    assert_eq!(error.message, "当前 Git 正在进行中的操作阻止直接完成。");

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

    let attempts = CompletionAttemptRepository::new(&database.connection)
        .list_by_issue_id(issue.id)
        .expect("attempts");
    assert_eq!(attempts.len(), 1);
    assert_eq!(attempts[0].option.as_str(), "complete_clean");
    assert_eq!(attempts[0].result.as_str(), "git_operation_blocked");
    assert_eq!(
        attempts[0].failure_reason.as_deref(),
        Some("merge_in_progress")
    );
    assert_eq!(attempts[0].commit_hash, None);
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
            attachments: Vec::new(),
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
            attachments: Vec::new(),
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
fn prepare_agent_commit_completion_records_blocked_attempt_when_git_operation_is_in_progress() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("prepare-agent-commit-blocked-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "conflict.txt", "base\n");
    git(&repo_dir, &["add", "conflict.txt"]);
    git(&repo_dir, &["commit", "-m", "base"]);
    git(&repo_dir, &["checkout", "-b", "feature"]);
    write_file(&repo_dir, "conflict.txt", "feature\n");
    git(&repo_dir, &["commit", "-am", "feature"]);
    git(&repo_dir, &["checkout", "main"]);
    write_file(&repo_dir, "conflict.txt", "main\n");
    git(&repo_dir, &["commit", "-am", "main"]);
    git_expect_failure(&repo_dir, &["merge", "feature"]);

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "prepare-agent-commit-blocked-repo",
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
            title: "Blocked agent commit".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
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
        .prepare_agent_commit_completion(PrepareAgentCommitCompletionInput {
            project_id,
            issue_id: issue.id,
        })
        .expect_err("git operation should block agent commit prepare");

    assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);
    assert_eq!(
        error.message,
        "当前 Git 正在进行中的操作阻止 Agent Commit，请先手动处理 Git 状态。"
    );

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

    let attempts = CompletionAttemptRepository::new(&database.connection)
        .list_by_issue_id(issue.id)
        .expect("attempts");
    assert_eq!(attempts.len(), 1);
    assert_eq!(attempts[0].option.as_str(), "agent_auto_commit");
    assert_eq!(attempts[0].result.as_str(), "git_operation_blocked");
    assert_eq!(
        attempts[0].failure_reason.as_deref(),
        Some("merge_in_progress")
    );
    assert_eq!(attempts[0].commit_hash, None);
}

#[test]
fn send_agent_commit_prompt_records_attempt_and_keeps_issue_in_review() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("send-agent-commit-prompt-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    write_file(&repo_dir, "tracked.txt", "dirty change\n");

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "send-agent-commit-prompt-repo",
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
            attachments: Vec::new(),
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

    let pty_sessions = redwhisk_lib::agent::pty_session_manager::PtySessionManager::new();
    let pending = pty_sessions
        .spawn_pending(&redwhisk_lib::agent::pty_session_manager::PtySpawnRequest {
            command: "/bin/sh".to_string(),
            working_dir: repo_dir.to_string_lossy().into_owned(),
            log_path: temp_dir
                .path()
                .join("session.log")
                .to_string_lossy()
                .into_owned(),
            initial_prompt: None,
            rows: 24,
            cols: 80,
            startup_check_total_ms: 200,
            startup_check_interval_ms: 25,
        })
        .expect("spawn pending");
    pty_sessions.register(session_id, pending, |_| {});

    let result = service
        .send_agent_commit_prompt(
            SendAgentCommitPromptInput {
                project_id,
                issue_id: issue.id,
            },
            temp_dir.path(),
            &pty_sessions,
        )
        .expect("send prompt");

    assert_eq!(result.issue_id, issue.id);
    assert_eq!(result.session_id, session_id);

    let persisted_issue = IssueRepository::new(&database.connection)
        .find_by_id(issue.id)
        .expect("query issue")
        .expect("issue exists");
    assert_eq!(persisted_issue.status, IssueStatus::Review);

    let session_events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    let prompt_event = session_events
        .iter()
        .find(|event| event.event_type == SessionEventType::SessionPromptInjected)
        .expect("prompt injected event");
    let prompt_payload: serde_json::Value =
        serde_json::from_str(&prompt_event.payload_json).expect("prompt payload");
    assert_eq!(prompt_payload["kind"], "completion");
    assert_eq!(prompt_payload["issueId"], issue.id);

    let attempts = CompletionAttemptRepository::new(&database.connection)
        .list_by_issue_id(issue.id)
        .expect("attempts");
    assert_eq!(attempts.len(), 1);
    assert_eq!(attempts[0].option.as_str(), "agent_auto_commit");
    assert_eq!(attempts[0].result.as_str(), "prompt_sent");
    assert!(attempts[0].changed_files_json.contains("tracked.txt"));
}

#[test]
fn detect_agent_commit_completion_records_commit_hash_and_completes_issue() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("detect-agent-commit-completion-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    write_file(&repo_dir, "tracked.txt", "dirty change\n");

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "detect-agent-commit-completion-repo",
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
            attachments: Vec::new(),
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

    let pty_sessions = redwhisk_lib::agent::pty_session_manager::PtySessionManager::new();
    let pending = pty_sessions
        .spawn_pending(&redwhisk_lib::agent::pty_session_manager::PtySpawnRequest {
            command: "/bin/sh".to_string(),
            working_dir: repo_dir.to_string_lossy().into_owned(),
            log_path: temp_dir
                .path()
                .join("session.log")
                .to_string_lossy()
                .into_owned(),
            initial_prompt: None,
            rows: 24,
            cols: 80,
            startup_check_total_ms: 200,
            startup_check_interval_ms: 25,
        })
        .expect("spawn pending");
    pty_sessions.register(session_id, pending, |_| {});

    service
        .send_agent_commit_prompt(
            SendAgentCommitPromptInput {
                project_id,
                issue_id: issue.id,
            },
            temp_dir.path(),
            &pty_sessions,
        )
        .expect("send prompt");

    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "agent completion"]);

    let completion_result = service
        .detect_agent_commit_completion(DetectAgentCommitCompletionInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("detect completion");

    assert_eq!(
        completion_result.outcome,
        redwhisk_lib::types::issue::DetectAgentCommitCompletionOutcome::Completed
    );
    assert_eq!(completion_result.issue.status, IssueStatus::Completed);
    assert_eq!(
        completion_result.message,
        "已检测到新的 commit，Issue 已完成。"
    );

    let persisted_issue = IssueRepository::new(&database.connection)
        .find_by_id(issue.id)
        .expect("query issue")
        .expect("issue exists");
    assert_eq!(persisted_issue.status, IssueStatus::Completed);

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("query session")
        .expect("session exists");
    assert_eq!(session.status, AgentSessionStatus::Closed);

    let session_events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert!(session_events
        .iter()
        .any(|event| event.event_type == SessionEventType::SessionClosed));

    let issue_actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue.id)
        .expect("issue actions");
    assert!(issue_actions
        .iter()
        .any(|action| action.action_type == IssueActionType::IssueCompleted));

    let attempts = CompletionAttemptRepository::new(&database.connection)
        .list_by_issue_id(issue.id)
        .expect("attempts");
    assert_eq!(attempts.len(), 1);
    assert_eq!(attempts[0].result.as_str(), "completed");
    assert_ne!(attempts[0].head_before, attempts[0].head_after);
    assert_eq!(
        attempts[0].commit_hash.as_deref(),
        Some(attempts[0].head_after.as_str())
    );

    let summary = service
        .get_issue_summary(GetIssueSummaryInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("summary");
    assert_eq!(summary.issue.status, IssueStatus::Completed);
    assert_eq!(
        summary.completion.as_ref().map(|info| info.option.as_str()),
        Some("agent_auto_commit")
    );
    assert_eq!(
        summary.completion.as_ref().map(|info| info.result.as_str()),
        Some("completed")
    );
    assert_eq!(
        summary
            .completion
            .as_ref()
            .and_then(|info| info.commit_hash.as_deref()),
        Some(attempts[0].head_after.as_str())
    );
    assert!(summary.diagnostics.is_empty());
}

#[test]
fn detect_agent_commit_completion_keeps_review_when_no_commit_detected() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("detect-agent-commit-no-commit-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    write_file(&repo_dir, "tracked.txt", "dirty change\n");

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "detect-agent-commit-no-commit-repo",
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
            attachments: Vec::new(),
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

    let pty_sessions = redwhisk_lib::agent::pty_session_manager::PtySessionManager::new();
    let pending = pty_sessions
        .spawn_pending(&redwhisk_lib::agent::pty_session_manager::PtySpawnRequest {
            command: "/bin/sh".to_string(),
            working_dir: repo_dir.to_string_lossy().into_owned(),
            log_path: temp_dir
                .path()
                .join("session.log")
                .to_string_lossy()
                .into_owned(),
            initial_prompt: None,
            rows: 24,
            cols: 80,
            startup_check_total_ms: 200,
            startup_check_interval_ms: 25,
        })
        .expect("spawn pending");
    pty_sessions.register(session_id, pending, |_| {});

    service
        .send_agent_commit_prompt(
            SendAgentCommitPromptInput {
                project_id,
                issue_id: issue.id,
            },
            temp_dir.path(),
            &pty_sessions,
        )
        .expect("send prompt");

    let completion_result = service
        .detect_agent_commit_completion(DetectAgentCommitCompletionInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("detect completion without commit");

    assert_eq!(
        completion_result.outcome,
        redwhisk_lib::types::issue::DetectAgentCommitCompletionOutcome::NoCommitDetected
    );
    assert_eq!(completion_result.issue.status, IssueStatus::Review);
    assert_eq!(
        completion_result.message,
        "尚未检测到新的 commit，Issue 保持待验收。"
    );

    let persisted_issue = IssueRepository::new(&database.connection)
        .find_by_id(issue.id)
        .expect("query issue")
        .expect("issue exists");
    assert_eq!(persisted_issue.status, IssueStatus::Review);

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("query session")
        .expect("session exists");
    assert_eq!(session.status, AgentSessionStatus::Running);

    let session_events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert!(!session_events
        .iter()
        .any(|event| event.event_type == SessionEventType::SessionClosed));

    let issue_actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue.id)
        .expect("issue actions");
    assert!(!issue_actions
        .iter()
        .any(|action| action.action_type == IssueActionType::IssueCompleted));

    let attempts = CompletionAttemptRepository::new(&database.connection)
        .list_by_issue_id(issue.id)
        .expect("attempts");
    assert_eq!(attempts.len(), 1);
    assert_eq!(attempts[0].result.as_str(), "no_commit_detected");
    assert_eq!(attempts[0].commit_hash, None);
    assert_eq!(attempts[0].head_before, attempts[0].head_after);
}

#[test]
fn detect_agent_commit_completion_returns_blocked_outcome_when_git_operation_starts() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("detect-agent-commit-blocked-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "conflict.txt", "base\n");
    git(&repo_dir, &["add", "conflict.txt"]);
    git(&repo_dir, &["commit", "-m", "base"]);
    git(&repo_dir, &["checkout", "-b", "feature"]);
    write_file(&repo_dir, "conflict.txt", "feature\n");
    git(&repo_dir, &["commit", "-am", "feature"]);
    git(&repo_dir, &["checkout", "main"]);
    write_file(&repo_dir, "conflict.txt", "main dirty\n");

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "detect-agent-commit-blocked-repo",
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
            title: "Blocked detect".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
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

    let pty_sessions = redwhisk_lib::agent::pty_session_manager::PtySessionManager::new();
    let pending = pty_sessions
        .spawn_pending(&redwhisk_lib::agent::pty_session_manager::PtySpawnRequest {
            command: "/bin/sh".to_string(),
            working_dir: repo_dir.to_string_lossy().into_owned(),
            log_path: temp_dir
                .path()
                .join("session.log")
                .to_string_lossy()
                .into_owned(),
            initial_prompt: None,
            rows: 24,
            cols: 80,
            startup_check_total_ms: 200,
            startup_check_interval_ms: 25,
        })
        .expect("spawn pending");
    pty_sessions.register(session_id, pending, |_| {});

    service
        .send_agent_commit_prompt(
            SendAgentCommitPromptInput {
                project_id,
                issue_id: issue.id,
            },
            temp_dir.path(),
            &pty_sessions,
        )
        .expect("send prompt");

    git(&repo_dir, &["commit", "-am", "main update"]);
    git_expect_failure(&repo_dir, &["merge", "feature"]);

    let completion_result = service
        .detect_agent_commit_completion(DetectAgentCommitCompletionInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("detect completion blocked by git operation");

    assert_eq!(
        completion_result.outcome,
        redwhisk_lib::types::issue::DetectAgentCommitCompletionOutcome::GitOperationBlocked
    );
    assert_eq!(completion_result.issue.status, IssueStatus::Review);
    assert_eq!(
        completion_result.message,
        "当前 Git 正在进行中的操作阻止 Agent Commit 完成，请先手动处理 Git 状态。"
    );

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

    let attempts = CompletionAttemptRepository::new(&database.connection)
        .list_by_issue_id(issue.id)
        .expect("attempts");
    assert_eq!(attempts.len(), 1);
    assert_eq!(attempts[0].result.as_str(), "git_operation_blocked");
    assert_eq!(
        attempts[0].failure_reason.as_deref(),
        Some("merge_in_progress")
    );
    assert_eq!(attempts[0].commit_hash, None);
}

#[test]
fn get_issue_summary_reports_completed_session_state_mismatch() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "summary-mismatch-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Completed mismatch".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
        })
        .expect("created issue");
    database
        .connection
        .execute(
            "UPDATE issues SET status = 'completed' WHERE id = ?1",
            [issue.id],
        )
        .expect("set completed");
    let profile_id = insert_agent_profile(&database.connection);
    let session_id = insert_agent_session_for_issue(
        &database.connection,
        project_id,
        issue.id,
        profile_id,
        "stopped",
    );
    database
        .connection
        .execute(
            "UPDATE agent_sessions SET closed_at = NULL WHERE id = ?1",
            [session_id],
        )
        .expect("clear closed_at");

    let summary = service
        .get_issue_summary(GetIssueSummaryInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("summary");

    assert!(summary
        .diagnostics
        .iter()
        .any(|item| item.contains("Session 状态异常：stopped")));
    assert!(summary
        .diagnostics
        .iter()
        .any(|item| item.contains("缺少 closed_at")));
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
            attachments: Vec::new(),
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
            attachments: Vec::new(),
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
            attachments: Vec::new(),
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
            attachments: Vec::new(),
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
            attachments: Vec::new(),
        })
        .expect("older issue");
    let newer_issue = service
        .create_issue(CreateIssueInput {
            project_id: first_project_id,
            title: "Newer".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
        })
        .expect("newer issue");
    service
        .create_issue(CreateIssueInput {
            project_id: second_project_id,
            title: "Other project".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
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
            attachments: Vec::new(),
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
                latest_output,
                last_active_at,
                started_at
            ) VALUES (?1, ?2, 'stopped', 'requested', '/tmp/repo', 'codex', 'prompt', '/tmp/log', 'latest chunk', 1780628400000, 1780628400000)",
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
    assert_eq!(
        response.issues[0].linked_session_latest_output.as_deref(),
        Some("latest chunk")
    );
}

#[test]
fn advance_issue_status_completes_running_issue_and_closes_linked_session() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "advance-status-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Advance to done".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
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

    let completed = service
        .advance_issue_status(AdvanceIssueStatusInput {
            project_id,
            issue_id: issue.id,
            target_status: IssueStatus::Completed,
        })
        .expect("advance running issue to completed");

    assert_eq!(completed.status, IssueStatus::Completed);
    assert_eq!(
        AgentSessionRepository::new(&database.connection)
            .find_by_id(session_id)
            .expect("query session")
            .expect("session exists")
            .status,
        AgentSessionStatus::Closed
    );
}

#[test]
fn advance_issue_status_rejects_backward_transition() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "advance-backward-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "No backward".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
        })
        .expect("created issue");
    database
        .connection
        .execute(
            "UPDATE issues SET status = 'review' WHERE id = ?1",
            [issue.id],
        )
        .expect("set review");

    let error = service
        .advance_issue_status(AdvanceIssueStatusInput {
            project_id,
            issue_id: issue.id,
            target_status: IssueStatus::Running,
        })
        .expect_err("backward transition should fail");

    assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);
}

#[test]
fn delete_issue_soft_deletes_issue_and_linked_session() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "delete-issue-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Delete me".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
        })
        .expect("created issue");
    let profile_id = insert_agent_profile(&database.connection);
    let session_id = insert_agent_session_for_issue(
        &database.connection,
        project_id,
        issue.id,
        profile_id,
        "running",
    );

    service
        .delete_issue(DeleteIssueInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("soft delete issue");

    let issue_del: i64 = database
        .connection
        .query_row("SELECT del FROM issues WHERE id = ?1", [issue.id], |row| row.get(0))
        .expect("issue del");
    assert_eq!(issue_del, 1);

    let session_del: i64 = database
        .connection
        .query_row(
            "SELECT del FROM agent_sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .expect("session del");
    assert_eq!(session_del, 1);

    assert!(service
        .list_issues(project_id)
        .expect("project issues")
        .issues
        .iter()
        .all(|item| item.id != issue.id));
    assert!(AgentSessionRepository::new(&database.connection)
        .list_by_project_id(project_id)
        .expect("project sessions")
        .iter()
        .all(|item| item.session_id != session_id));
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
            attachments: Vec::new(),
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
        .insert(name, &repo_path, ProjectCompletionPolicy::AgentAutoCommit)
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

fn git_expect_failure(repo: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .expect("run git");
    assert!(
        !output.status.success(),
        "git {:?} unexpectedly succeeded\nstdout:\n{}\nstderr:\n{}",
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
