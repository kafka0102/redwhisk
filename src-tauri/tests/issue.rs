use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};

use redwhisk_lib::agent::session_registry::AgentSessionRegistry;
use redwhisk_lib::core::issue_service::IssueService;
use redwhisk_lib::db::agent_profile_repository::AgentProfileRepository;
use redwhisk_lib::db::agent_session_repository::AgentSessionRepository;
use redwhisk_lib::db::completion_attempt_repository::CompletionAttemptRepository;
use redwhisk_lib::db::connection::DatabaseConfig;
use redwhisk_lib::db::event_repository::EventRepository;
use redwhisk_lib::db::issue_attachment_repository::IssueAttachmentRepository;
use redwhisk_lib::db::issue_completion_flow_repository::IssueCompletionFlowRepository;
use redwhisk_lib::db::issue_repository::IssueRepository;
use redwhisk_lib::db::migrations::MigrationRunner;
use redwhisk_lib::db::project_repository::ProjectRepository;
use redwhisk_lib::types::agent_profile::{AgentScope, AgentType};
use redwhisk_lib::types::agent_session::{
    AgentSessionAttention, AgentSessionStatus, WorktreeOwner,
};
use redwhisk_lib::types::errors::CommandErrorCode;
use redwhisk_lib::types::issue::{
    AdvanceIssueStatusInput, CompleteIssueCleanInput, CompleteIssueManualInput, CreateIssueInput,
    DeleteIssueInput, DetectAgentCommitCompletionInput, ExportIssueAttachmentInput,
    GetIssueSummaryInput, IssueAttachmentInput, IssueAttachmentKind, IssueRecord, IssueStatus,
    IssueStatusTotals, MarkIssueReviewInput, PrepareAgentCommitCompletionInput,
    PreviewIssueAttachmentInput, SaveIssueAttachmentDraftInput, UpdateIssueInput,
};
use redwhisk_lib::types::issue_action::IssueActionType;
use redwhisk_lib::types::issue_completion::{
    CompleteIssueFlowAction, CompleteIssueFlowInput, DirtyWorkspaceOption, IssueCompletionPhase,
};
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
            "del",
            "label_ids",
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
    assert_eq!(
        table_column_type(&database.connection, "issues", "label_ids"),
        "TEXT"
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
            label_ids: Vec::new(),
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
            label_ids: Vec::new(),
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
            label_ids: Vec::new(),
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
            label_ids: Vec::new(),
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
            label_ids: Vec::new(),
        })
        .expect("created issue");

    let error = service
        .update_issue(UpdateIssueInput {
            project_id: second_project_id,
            issue_id: issue.id,
            title: "Wrong project update".to_string(),
            description: "Should fail".to_string(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
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
            label_ids: Vec::new(),
        })
        .expect_err("missing issue should fail");

    assert_eq!(error.code, CommandErrorCode::IssueNotFound);
}

#[test]
fn saves_issue_attachment_draft_under_redwhisk_data_dir() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let data_dir = temp_dir.path().join(".redwhisk");
    let source_path = temp_dir.path().join("screen shot.png");
    fs::write(&source_path, "image-bytes").expect("write draft image");

    let draft = IssueService::save_issue_attachment_draft_in_data_dir(
        &data_dir,
        SaveIssueAttachmentDraftInput {
            source_path: source_path.to_string_lossy().to_string(),
            display_name: "screen shot.png".to_string(),
        },
    )
    .expect("saved draft attachment");

    assert_eq!(draft.display_name, "screen shot.png");
    assert_eq!(draft.kind, IssueAttachmentKind::Image);
    assert!(draft.is_previewable);
    let draft_path = Path::new(&draft.path);
    assert!(draft_path.starts_with(data_dir.join("issue-attachment-drafts")));
    assert!(draft_path.exists());
    assert_eq!(fs::read(draft_path).expect("read draft"), b"image-bytes");
}

#[test]
fn create_issue_persists_attachment_metadata_and_rewrites_tokens() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let data_dir = temp_dir.path().join(".redwhisk");
    let repo_dir = temp_dir.path().join("attachment-create-repo");
    fs::create_dir_all(&repo_dir).expect("create repo dir");
    let database = migrated_database(&data_dir);
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "attachment-create-repo",
        &repo_dir,
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
            label_ids: Vec::new(),
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
    let expected_absolute_path = data_dir
        .join("issues")
        .join(issue.id.to_string())
        .join("attachments")
        .join(&issue.attachments[0].stored_name);
    assert_eq!(
        fs::canonicalize(&issue.attachments[0].absolute_path).expect("canonical saved attachment"),
        fs::canonicalize(&expected_absolute_path).expect("canonical expected attachment")
    );
    assert!(!repo_dir.join(".redwhisk").exists());
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
            label_ids: Vec::new(),
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
            label_ids: Vec::new(),
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
            label_ids: Vec::new(),
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
            label_ids: Vec::new(),
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
            label_ids: Vec::new(),
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
fn mark_issue_review_allows_closed_linked_session() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "review-closed-session-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Ready after restart".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
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
        "closed",
    );
    database
        .connection
        .execute(
            "UPDATE agent_sessions SET closed_at = 1780628600000 WHERE id = ?1",
            [session_id],
        )
        .expect("set closed_at");

    let reviewed = service
        .mark_issue_review(MarkIssueReviewInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("mark review");

    assert_eq!(reviewed.status, IssueStatus::Review);
    let session_status: String = database
        .connection
        .query_row(
            "SELECT status FROM agent_sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .expect("session status");
    assert_eq!(session_status, "closed");
    let actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue.id)
        .expect("issue actions");
    assert_eq!(actions[0].action_type, IssueActionType::IssueReviewMarked);
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
            label_ids: Vec::new(),
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
fn mark_issue_review_rejects_issue_without_linked_session() {
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
            label_ids: Vec::new(),
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
            label_ids: Vec::new(),
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
    let repo_dir = temp_dir.path().join("complete-review-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "complete-review-repo",
        &repo_dir,
    );
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
            label_ids: Vec::new(),
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
fn complete_issue_manual_allows_running_issue_without_review_gate() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("complete-running-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "complete-running-repo",
        &repo_dir,
    );
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Running to complete".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
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
        .complete_issue_manual(CompleteIssueManualInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("complete running issue manually");

    assert_eq!(completed.id, issue.id);
    assert_eq!(completed.status, IssueStatus::Completed);
    let stored_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("query session")
        .expect("session exists");
    assert_eq!(stored_session.status, AgentSessionStatus::Closed);

    let actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue.id)
        .expect("issue actions");
    let completed_action = actions
        .iter()
        .find(|action| action.action_type == IssueActionType::IssueCompleted)
        .expect("completed action");
    let action_payload: serde_json::Value =
        serde_json::from_str(&completed_action.payload_json).expect("payload json");
    assert_eq!(action_payload["fromStatus"], "running");
    assert_eq!(action_payload["toStatus"], "completed");
}

#[test]
fn complete_issue_manual_finishes_when_project_git_status_is_unavailable() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("deleted-project-worktree-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "deleted-project-worktree-repo",
        &repo_dir,
    );
    let service = issue_service(&database.connection);
    let (issue, session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "deleted project worktree issue",
        "running",
    );
    fs::remove_dir_all(&repo_dir).expect("delete project worktree");

    let completed = service
        .complete_issue_manual(CompleteIssueManualInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("complete when git status is unavailable");

    assert_eq!(completed.id, issue.id);
    assert_eq!(completed.status, IssueStatus::Completed);
    let stored_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("query session")
        .expect("session exists");
    assert_eq!(stored_session.status, AgentSessionStatus::Closed);
}

#[test]
fn complete_issue_manual_merges_and_cleans_up_worktree_session() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("manual-complete-worktree-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "manual-complete-worktree-repo",
        &repo_dir,
    );
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Manual worktree review issue".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
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
    let worktree_root = temp_dir.path().join("manual-worktrees");
    let workspace_path = worktree_root.join("issue-manual-worktree");
    git(
        &repo_dir,
        &[
            "worktree",
            "add",
            "-B",
            "issue-manual-branch",
            workspace_path.to_string_lossy().as_ref(),
            "main",
        ],
    );
    database
        .connection
        .execute(
            "UPDATE agent_sessions
             SET working_dir = ?1,
                 workspace_mode = 'worktree',
                 target_branch = 'main',
                 workspace_branch = 'issue-manual-branch',
                 workspace_path = ?1,
                 worktree_root_path = ?2,
                 worktree_owner = 'redwhisk'
             WHERE id = ?3",
            rusqlite::params![
                workspace_path.to_string_lossy().to_string(),
                worktree_root.to_string_lossy().to_string(),
                session_id,
            ],
        )
        .expect("update worktree session");

    write_file(&workspace_path, "tracked.txt", "manual worktree change\n");
    git(&workspace_path, &["add", "tracked.txt"]);
    git(
        &workspace_path,
        &["commit", "-m", "manual worktree completion"],
    );

    let completed = service
        .complete_issue_manual(CompleteIssueManualInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("complete manually");

    assert_eq!(completed.status, IssueStatus::Completed);
    assert!(!workspace_path.exists());
    let main_content = fs::read_to_string(repo_dir.join("tracked.txt")).expect("read main file");
    assert_eq!(main_content, "manual worktree change\n");
    assert_eq!(
        git_output(&repo_dir, &["branch", "--list", "issue-manual-branch"]),
        ""
    );
}

#[test]
fn complete_issue_manual_rejects_issue_without_session_without_partial_write() {
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
            title: "No linked session".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
        })
        .expect("created issue");

    let error = service
        .complete_issue_manual(CompleteIssueManualInput {
            project_id,
            issue_id: issue.id,
        })
        .expect_err("issue without session should be rejected");

    assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);
    let stored_issue = IssueRepository::new(&database.connection)
        .find_by_id(issue.id)
        .expect("query issue")
        .expect("issue exists");
    assert_eq!(stored_issue.status, IssueStatus::Backlog);
    let actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue.id)
        .expect("issue actions");
    assert_eq!(actions.len(), 1);
}

#[test]
fn get_issue_summary_falls_back_to_issue_completed_action_for_manual_completion() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("summary-manual-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "summary-manual-repo",
        &repo_dir,
    );
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
            label_ids: Vec::new(),
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
    assert!(!summary
        .diagnostics
        .iter()
        .any(|item| item.contains("缺少 CompletionAttempt 记录")));
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
            label_ids: Vec::new(),
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
fn complete_issue_clean_allows_closed_linked_session() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("clean-closed-session-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "clean-closed-session-repo",
        &repo_dir,
    );
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let (issue, session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "Complete after restart",
        "closed",
    );

    let completed = service
        .complete_issue_clean(CompleteIssueCleanInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("complete clean");

    assert_eq!(completed.status, IssueStatus::Completed);
    assert_eq!(completed.linked_session_id, Some(session_id));
    let stored_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("query session")
        .expect("session exists");
    assert_eq!(stored_session.status, AgentSessionStatus::Closed);
    let actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue.id)
        .expect("issue actions");
    assert_eq!(actions[0].action_type, IssueActionType::IssueCompleted);
    let action_payload: serde_json::Value =
        serde_json::from_str(&actions[0].payload_json).expect("payload json");
    assert_eq!(action_payload["linkedSessionId"], session_id);
    assert_eq!(action_payload["option"], "complete_clean");
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
            label_ids: Vec::new(),
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

    let flow = IssueCompletionFlowRepository::new(&database.connection)
        .find_by_issue_id(issue.id)
        .expect("flow")
        .expect("flow exists");
    assert_eq!(flow.phase, IssueCompletionPhase::PromptingDirtyDecision);
    assert_eq!(flow.session_id, Some(session_id));
    assert!(!flow.ignore_dirty);
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
            label_ids: Vec::new(),
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
            label_ids: Vec::new(),
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
    assert!(preview
        .completion_prompt
        .contains("请获取本次修改相关的代码"));
    assert!(preview.completion_prompt.contains("不要提交无关改动"));
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
            label_ids: Vec::new(),
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
fn detect_agent_commit_completion_keeps_review_when_no_commit_detected() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("detect-no-commit-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    write_file(&repo_dir, "tracked.txt", "dirty change\n");

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "detect-no-commit-repo",
        &repo_dir,
    );
    let service = issue_service(&database.connection);
    let (issue, session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "detect no commit",
        "running",
    );
    let registry = AgentSessionRegistry::new();
    let (handle, _sent) = RecordingHandle::new();
    registry.register(session_id, Arc::new(handle));

    // 推进到 AutoCommitting（注入 commit 指令，但 agent 尚未提交）。
    service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: None,
                dirty_decision: Some(DirtyWorkspaceOption::AutoCommit),
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &registry,
        )
        .expect("auto commit waits");

    // 未提交新 commit → NoCommitDetected，phase 仍 AutoCommitting，attempt 仍 PromptSent。
    let result = service
        .detect_agent_commit_completion(DetectAgentCommitCompletionInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("detect");
    assert_eq!(
        result.outcome,
        redwhisk_lib::types::issue::DetectAgentCommitCompletionOutcome::NoCommitDetected
    );
    assert_eq!(result.issue.status, IssueStatus::Review);
    let flow = IssueCompletionFlowRepository::new(&database.connection)
        .find_by_issue_id(issue.id)
        .expect("flow")
        .expect("flow exists");
    assert_eq!(flow.phase, IssueCompletionPhase::AutoCommitting);
    let attempts = CompletionAttemptRepository::new(&database.connection)
        .list_by_issue_id(issue.id)
        .expect("attempts");
    assert_eq!(attempts.len(), 1);
    assert_eq!(attempts[0].result.as_str(), "prompt_sent");
    assert_eq!(attempts[0].commit_hash, None);
}

#[test]
fn detect_agent_commit_completion_returns_blocked_outcome_when_git_operation_starts() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("detect-blocked-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "conflict.txt", "base\n");
    git(&repo_dir, &["add", "conflict.txt"]);
    git(&repo_dir, &["commit", "-m", "base"]);
    git(&repo_dir, &["checkout", "-b", "feature"]);
    write_file(&repo_dir, "conflict.txt", "feature\n");
    git(&repo_dir, &["commit", "-am", "feature"]);
    git(&repo_dir, &["checkout", "main"]);
    // 主分支制造未提交改动，使完成入口进入 dirty → AutoCommit。
    write_file(&repo_dir, "conflict.txt", "main dirty\n");

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "detect-blocked-repo",
        &repo_dir,
    );
    let service = issue_service(&database.connection);
    let (issue, session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "blocked detect",
        "running",
    );
    let registry = AgentSessionRegistry::new();
    let (handle, _sent) = RecordingHandle::new();
    registry.register(session_id, Arc::new(handle));

    // 推进到 AutoCommitting。
    service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: None,
                dirty_decision: Some(DirtyWorkspaceOption::AutoCommit),
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &registry,
        )
        .expect("auto commit waits");

    // 制造进行中的 merge 冲突 → detect 应返回 GitOperationBlocked，Issue 保持 review。
    git(&repo_dir, &["commit", "-am", "main update"]);
    git_expect_failure(&repo_dir, &["merge", "feature"]);

    let result = service
        .detect_agent_commit_completion(DetectAgentCommitCompletionInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("detect");
    assert_eq!(
        result.outcome,
        redwhisk_lib::types::issue::DetectAgentCommitCompletionOutcome::GitOperationBlocked
    );
    assert_eq!(result.issue.status, IssueStatus::Review);
}

#[test]
fn complete_issue_flow_allows_running_issue_before_review() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("flow-running-before-review-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "flow-running-before-review-repo",
        &repo_dir,
    );
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Running before review".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
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
    database
        .connection
        .execute(
            "UPDATE agent_sessions
             SET working_dir = ?1,
                 workspace_mode = 'current_branch',
                 target_branch = 'main',
                 workspace_branch = 'main',
                 workspace_path = ?1,
                 origin_branch = 'main'
             WHERE id = ?2",
            rusqlite::params![repo_dir.to_string_lossy().to_string(), session_id],
        )
        .expect("update session workspace");

    let result = service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: None,
                dirty_decision: None,
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &AgentSessionRegistry::new(),
        )
        .expect("running issue should complete");

    assert_eq!(result.action, CompleteIssueFlowAction::Completed);
    assert_eq!(result.issue.status, IssueStatus::Completed);
    let stored_issue = IssueRepository::new(&database.connection)
        .find_by_id(issue.id)
        .expect("query issue")
        .expect("issue exists");
    assert_eq!(stored_issue.status, IssueStatus::Completed);
    let stored_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("query session")
        .expect("session exists");
    assert_eq!(stored_session.status, AgentSessionStatus::Closed);
    assert_eq!(stored_session.closed_at, Some(result.issue.updated_at));
}

#[test]
fn complete_issue_flow_allows_running_issue_even_when_session_is_inactive() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("flow-running-inactive-session-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "flow-running-inactive-session-repo",
        &repo_dir,
    );
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Running with inactive session".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
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
        "closed",
    );
    database
        .connection
        .execute(
            "UPDATE agent_sessions
             SET working_dir = ?1,
                 workspace_mode = 'current_branch',
                 target_branch = 'main',
                 workspace_branch = 'main',
                 workspace_path = ?1,
                 origin_branch = 'main'
             WHERE id = ?2",
            rusqlite::params![repo_dir.to_string_lossy().to_string(), session_id],
        )
        .expect("update session workspace");

    let result = service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: None,
                dirty_decision: None,
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &AgentSessionRegistry::new(),
        )
        .expect("running issue should complete with inactive session");

    assert_eq!(result.action, CompleteIssueFlowAction::Completed);
    assert_eq!(result.issue.status, IssueStatus::Completed);
    let stored_issue = IssueRepository::new(&database.connection)
        .find_by_id(issue.id)
        .expect("query issue")
        .expect("issue exists");
    assert_eq!(stored_issue.status, IssueStatus::Completed);
    let stored_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("query session")
        .expect("session exists");
    assert_eq!(stored_session.status, AgentSessionStatus::Closed);
}

#[test]
fn complete_issue_flow_completes_review_issue_with_closed_linked_session() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("flow-closed-session-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "flow-closed-session-repo",
        &repo_dir,
    );
    let service = issue_service(&database.connection);
    let (issue, session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "closed flow",
        "closed",
    );

    let result = service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: None,
                dirty_decision: None,
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &AgentSessionRegistry::new(),
        )
        .expect("complete issue flow");

    assert_eq!(result.action, CompleteIssueFlowAction::Completed);
    assert_eq!(result.issue.status, IssueStatus::Completed);
    assert_eq!(result.session_id, Some(session_id));
    assert!(result.flow.is_none());
    assert!(IssueCompletionFlowRepository::new(&database.connection)
        .find_by_issue_id(issue.id)
        .expect("flow")
        .is_none());
}

#[test]
fn complete_issue_flow_manual_dirty_blocks_and_persists_flow() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("flow-manual-dirty-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    write_file(&repo_dir, "tracked.txt", "dirty manual\n");

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "flow-manual-dirty-repo",
        &repo_dir,
    );
    let service = issue_service(&database.connection);
    let (issue, session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "manual dirty flow",
        "running",
    );

    let result = service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: None,
                dirty_decision: None,
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &AgentSessionRegistry::new(),
        )
        .expect("manual dirty blocks");

    assert_eq!(result.action, CompleteIssueFlowAction::PromptDirtyDecision);
    assert_eq!(result.issue.status, IssueStatus::Review);
    let flow = result.flow.expect("flow");
    assert_eq!(flow.phase, IssueCompletionPhase::PromptingDirtyDecision);
    assert_eq!(flow.session_id, Some(session_id));
    assert!(!flow.ignore_dirty);
}

#[test]
fn complete_issue_flow_manual_dirty_ignore_continues_to_current_branch_completion() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("flow-manual-ignore-dirty-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    write_file(&repo_dir, "tracked.txt", "dirty accepted\n");

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "flow-manual-ignore-dirty-repo",
        &repo_dir,
    );
    let service = issue_service(&database.connection);
    let (issue, session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "manual ignore dirty flow",
        "running",
    );

    let result = service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: Some(true),
                dirty_decision: None,
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &AgentSessionRegistry::new(),
        )
        .expect("manual ignore dirty completes");

    assert_eq!(result.action, CompleteIssueFlowAction::Completed);
    assert_eq!(result.issue.status, IssueStatus::Completed);
    let stored_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("session")
        .expect("session exists");
    assert_eq!(stored_session.status, AgentSessionStatus::Closed);
}

#[test]
fn complete_issue_flow_redwhisk_worktree_rebases_fast_forwards_and_cleans_up() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("flow-redwhisk-worktree-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "flow-redwhisk-worktree-repo",
        &repo_dir,
    );
    let service = issue_service(&database.connection);
    let (issue, session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "redwhisk worktree flow",
        "running",
    );
    let worktree_root = temp_dir.path().join("worktrees");
    let workspace_path = worktree_root.join("issue-flow-redwhisk");
    git(
        &repo_dir,
        &[
            "worktree",
            "add",
            "-B",
            "issue-flow-redwhisk",
            workspace_path.to_string_lossy().as_ref(),
            "main",
        ],
    );
    update_session_worktree(
        &database.connection,
        session_id,
        &workspace_path,
        &worktree_root,
        "issue-flow-redwhisk",
        WorktreeOwner::Redwhisk,
    );
    write_file(&workspace_path, "tracked.txt", "worktree completed\n");
    git(&workspace_path, &["commit", "-am", "worktree completion"]);

    let result = service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: None,
                dirty_decision: None,
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &AgentSessionRegistry::new(),
        )
        .expect("complete worktree");

    assert_eq!(result.action, CompleteIssueFlowAction::Completed);
    assert_eq!(result.issue.status, IssueStatus::Completed);
    assert!(!workspace_path.exists());
    assert_eq!(
        fs::read_to_string(repo_dir.join("tracked.txt")).expect("main content"),
        "worktree completed\n"
    );
    assert_eq!(
        git_output(&repo_dir, &["branch", "--list", "issue-flow-redwhisk"]),
        ""
    );
}

#[test]
fn complete_issue_flow_blocks_missing_redwhisk_worktree_with_unmerged_branch() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("flow-missing-redwhisk-worktree-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "flow-missing-redwhisk-worktree-repo",
        &repo_dir,
    );
    let service = issue_service(&database.connection);
    let (issue, session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "missing redwhisk worktree flow",
        "running",
    );
    let worktree_root = temp_dir.path().join("worktrees");
    let workspace_path = worktree_root.join("issue-flow-missing-redwhisk");
    git(
        &repo_dir,
        &[
            "worktree",
            "add",
            "-B",
            "issue-flow-missing-redwhisk",
            workspace_path.to_string_lossy().as_ref(),
            "main",
        ],
    );
    update_session_worktree(
        &database.connection,
        session_id,
        &workspace_path,
        &worktree_root,
        "issue-flow-missing-redwhisk",
        WorktreeOwner::Redwhisk,
    );
    write_file(
        &workspace_path,
        "tracked.txt",
        "missing worktree completed\n",
    );
    git(&workspace_path, &["commit", "-am", "missing worktree side"]);
    fs::remove_dir_all(&workspace_path).expect("delete worktree path");

    let result = service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: None,
                dirty_decision: None,
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &AgentSessionRegistry::new(),
        )
        .expect("missing worktree should return blocked flow");

    assert_eq!(result.action, CompleteIssueFlowAction::Blocked);
    assert_eq!(result.issue.status, IssueStatus::Review);
    assert_eq!(
        fs::read_to_string(repo_dir.join("tracked.txt")).expect("main content"),
        "initial\n"
    );
    assert_ne!(
        git_output(
            &repo_dir,
            &["branch", "--list", "issue-flow-missing-redwhisk"],
        ),
        ""
    );
    let flow = IssueCompletionFlowRepository::new(&database.connection)
        .find_by_issue_id(issue.id)
        .expect("flow")
        .expect("flow exists");
    assert_eq!(flow.phase, IssueCompletionPhase::Blocked);
    assert!(flow
        .failure_reason
        .as_deref()
        .is_some_and(|reason| reason.contains("尚未合入")));
}

#[test]
fn complete_issue_flow_rebase_conflict_persists_merge_block_and_keeps_worktree() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("flow-rebase-conflict-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "flow-rebase-conflict-repo",
        &repo_dir,
    );
    let service = issue_service(&database.connection);
    let (issue, session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "conflict worktree flow",
        "running",
    );
    let worktree_root = temp_dir.path().join("worktrees");
    let workspace_path = worktree_root.join("issue-flow-conflict");
    git(
        &repo_dir,
        &[
            "worktree",
            "add",
            "-B",
            "issue-flow-conflict",
            workspace_path.to_string_lossy().as_ref(),
            "main",
        ],
    );
    update_session_worktree(
        &database.connection,
        session_id,
        &workspace_path,
        &worktree_root,
        "issue-flow-conflict",
        WorktreeOwner::Redwhisk,
    );
    write_file(&workspace_path, "tracked.txt", "worktree side\n");
    git(&workspace_path, &["commit", "-am", "worktree side"]);
    write_file(&repo_dir, "tracked.txt", "main side\n");
    git(&repo_dir, &["commit", "-am", "main side"]);

    let result = service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: None,
                dirty_decision: None,
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &AgentSessionRegistry::new(),
        )
        .expect("merge blocked");

    assert_eq!(result.action, CompleteIssueFlowAction::Blocked);
    assert_eq!(result.issue.status, IssueStatus::Review);
    assert!(workspace_path.exists());
    let flow = IssueCompletionFlowRepository::new(&database.connection)
        .find_by_issue_id(issue.id)
        .expect("flow")
        .expect("flow exists");
    assert_eq!(flow.phase, IssueCompletionPhase::Blocked);
    assert_eq!(
        flow.workspace_path.as_deref(),
        Some(workspace_path.to_string_lossy().as_ref())
    );
}

#[test]
fn complete_issue_flow_rebase_conflict_does_not_inject_prompt_before_user_confirmation() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("flow-rebase-notify-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "flow-rebase-notify-repo",
        &repo_dir,
    );
    let service = issue_service(&database.connection);
    let (issue, session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "conflict notify flow",
        "running",
    );
    let worktree_root = temp_dir.path().join("worktrees");
    let workspace_path = worktree_root.join("issue-flow-notify");
    git(
        &repo_dir,
        &[
            "worktree",
            "add",
            "-B",
            "issue-flow-notify",
            workspace_path.to_string_lossy().as_ref(),
            "main",
        ],
    );
    update_session_worktree(
        &database.connection,
        session_id,
        &workspace_path,
        &worktree_root,
        "issue-flow-notify",
        WorktreeOwner::Redwhisk,
    );
    write_file(&workspace_path, "tracked.txt", "worktree side\n");
    git(&workspace_path, &["commit", "-am", "worktree side"]);
    write_file(&repo_dir, "tracked.txt", "main side\n");
    git(&repo_dir, &["commit", "-am", "main side"]);

    // 注册活跃 session 句柄，用于断言 rebase 冲突时后端不会自动注入合并 prompt。
    let registry = AgentSessionRegistry::new();
    let (handle, sent) = RecordingHandle::new();
    registry.register(session_id, Arc::new(handle));

    let result = service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: None,
                dirty_decision: None,
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &registry,
        )
        .expect("merge blocked");

    assert_eq!(result.action, CompleteIssueFlowAction::Blocked);
    let sent = sent.lock().expect("recorder lock");
    assert!(
        sent.is_empty(),
        "rebase 冲突时后端不应自动注入 prompt；合并提示应交给前端用户在「自动合并」弹窗确认后再注入。实际注入：{:?}",
        *sent
    );
}

#[test]
fn complete_issue_flow_auto_commit_injects_detects_and_confirms_completion() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("flow-auto-full-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    write_file(&repo_dir, "tracked.txt", "dirty agent\n");

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "flow-auto-full-repo",
        &repo_dir,
    );
    let service = issue_service(&database.connection);
    let (issue, session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "auto full flow",
        "running",
    );

    let registry = AgentSessionRegistry::new();
    let (handle, sent) = RecordingHandle::new();
    registry.register(session_id, Arc::new(handle));

    // 1) dirty + AutoCommit → 注入 commit 指令，phase AutoCommitting。
    let wait = service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: None,
                dirty_decision: Some(DirtyWorkspaceOption::AutoCommit),
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &registry,
        )
        .expect("auto dirty waits");
    assert_eq!(wait.action, CompleteIssueFlowAction::WaitingAutoCommit);
    let wait_flow = wait.flow.expect("flow");
    assert_eq!(wait_flow.phase, IssueCompletionPhase::AutoCommitting);
    let attempts = CompletionAttemptRepository::new(&database.connection)
        .list_by_issue_id(issue.id)
        .expect("attempts");
    assert_eq!(attempts.len(), 1);
    assert_eq!(attempts[0].option.as_str(), "complete_manual");
    assert_eq!(attempts[0].result.as_str(), "prompt_sent");
    let head_before = attempts[0].head_before.clone();
    let sent = sent.lock().expect("recorder lock");
    assert_eq!(sent.len(), 1, "应向 session 注入 commit 指令");
    assert!(
        sent[0].contains("commit"),
        "注入文本应为 commit 指令，实际：{}",
        sent[0]
    );
    drop(sent);

    // 2) 模拟 agent 提交 → detect 检测到新 commit，phase ConfirmingContinueAfterCommit。
    git(&repo_dir, &["commit", "-am", "agent completion"]);
    let detected = service
        .detect_agent_commit_completion(DetectAgentCommitCompletionInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("detect");
    assert_eq!(
        detected.outcome,
        redwhisk_lib::types::issue::DetectAgentCommitCompletionOutcome::CommitDetected
    );
    let detect_flow = IssueCompletionFlowRepository::new(&database.connection)
        .find_by_issue_id(issue.id)
        .expect("flow")
        .expect("flow exists");
    assert_eq!(
        detect_flow.phase,
        IssueCompletionPhase::ConfirmingContinueAfterCommit
    );
    let completed_attempt = CompletionAttemptRepository::new(&database.connection)
        .list_by_issue_id(issue.id)
        .expect("attempts")[0]
        .clone();
    assert_eq!(completed_attempt.result.as_str(), "completed");
    assert_ne!(completed_attempt.head_after, head_before);

    // 3) 用户确认继续 → Completed。
    let confirmed = service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: None,
                dirty_decision: None,
                branch_name: None,
                actual_path: None,
                continue_after_commit: Some(true),
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &registry,
        )
        .expect("confirm completes");
    assert_eq!(confirmed.action, CompleteIssueFlowAction::Completed);
    assert_eq!(confirmed.issue.status, IssueStatus::Completed);
}

#[test]
fn complete_issue_flow_auto_commit_confirm_false_cancels() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("flow-auto-cancel-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    write_file(&repo_dir, "tracked.txt", "dirty agent\n");

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "flow-auto-cancel-repo",
        &repo_dir,
    );
    let service = issue_service(&database.connection);
    let (issue, session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "auto cancel flow",
        "running",
    );
    let registry = AgentSessionRegistry::new();
    let (handle, _sent) = RecordingHandle::new();
    registry.register(session_id, Arc::new(handle));

    // 推进到 ConfirmingContinueAfterCommit。
    service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                dirty_decision: Some(DirtyWorkspaceOption::AutoCommit),
                ignore_dirty: None,
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &registry,
        )
        .expect("wait");
    git(&repo_dir, &["commit", "-am", "agent completion"]);
    service
        .detect_agent_commit_completion(DetectAgentCommitCompletionInput {
            project_id,
            issue_id: issue.id,
        })
        .expect("detect");

    // 用户拒绝继续 → Cancelled，Issue 保持待验收。
    let cancelled = service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: None,
                dirty_decision: None,
                branch_name: None,
                actual_path: None,
                continue_after_commit: Some(false),
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &registry,
        )
        .expect("cancel");
    assert_eq!(cancelled.action, CompleteIssueFlowAction::Cancelled);
    assert_eq!(cancelled.issue.status, IssueStatus::Review);
}

#[test]
fn complete_issue_flow_external_worktree_confirms_skip_and_cancel_decisions() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("flow-external-worktree-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "flow-external-worktree-repo",
        &repo_dir,
    );
    let service = issue_service(&database.connection);
    let (issue, session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "external worktree flow",
        "running",
    );
    let worktree_root = temp_dir.path().join("worktrees");
    let workspace_path = worktree_root.join("issue-flow-external");
    git(
        &repo_dir,
        &[
            "worktree",
            "add",
            "-B",
            "issue-flow-external",
            workspace_path.to_string_lossy().as_ref(),
            "main",
        ],
    );
    update_session_worktree(
        &database.connection,
        session_id,
        &workspace_path,
        &worktree_root,
        "issue-flow-external",
        WorktreeOwner::External,
    );
    write_file(&workspace_path, "tracked.txt", "external completed\n");
    git(&workspace_path, &["commit", "-am", "external completion"]);

    let confirm = service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: None,
                dirty_decision: None,
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &AgentSessionRegistry::new(),
        )
        .expect("confirm external");
    assert_eq!(
        confirm.action,
        CompleteIssueFlowAction::ConfirmWorktreeCleanup
    );
    assert_eq!(confirm.issue.status, IssueStatus::Review);

    let cancel = service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: None,
                dirty_decision: Some(DirtyWorkspaceOption::Cancel),
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: None,
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &AgentSessionRegistry::new(),
        )
        .expect("cancel pauses external");
    assert_eq!(cancel.action, CompleteIssueFlowAction::Cancelled);
    assert_eq!(cancel.issue.status, IssueStatus::Review);

    let skip = service
        .complete_issue_flow(
            CompleteIssueFlowInput {
                project_id,
                issue_id: issue.id,
                ignore_dirty: None,
                dirty_decision: None,
                branch_name: None,
                actual_path: None,
                continue_after_commit: None,
                worktree_cleanup_decision: Some(false),
            },
            temp_dir.path(),
            &redwhisk_lib::agent::pty_session_manager::PtySessionManager::new(),
            &AgentSessionRegistry::new(),
        )
        .expect("skip completes external");
    assert_eq!(skip.action, CompleteIssueFlowAction::Completed);
    assert_eq!(skip.issue.status, IssueStatus::Completed);
    assert!(workspace_path.exists());
}

#[test]
fn legacy_completion_entries_delegate_without_bypassing_flow_audit() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo_dir = temp_dir.path().join("flow-legacy-bypass-repo");
    init_repo(&repo_dir);
    write_file(&repo_dir, "tracked.txt", "initial\n");
    git(&repo_dir, &["add", "tracked.txt"]);
    git(&repo_dir, &["commit", "-m", "initial"]);

    let database = migrated_database(temp_dir.path());
    let project_id = insert_project_with_repo_path_and_policy(
        &database.connection,
        "flow-legacy-bypass-repo",
        &repo_dir,
    );
    let service = issue_service(&database.connection);
    let (manual_issue, _manual_session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "legacy manual flow",
        "running",
    );

    let manual = service
        .complete_issue_manual(CompleteIssueManualInput {
            project_id,
            issue_id: manual_issue.id,
        })
        .expect("manual legacy entry delegates");
    assert_eq!(manual.status, IssueStatus::Completed);
    assert_eq!(
        CompletionAttemptRepository::new(&database.connection)
            .list_by_issue_id(manual_issue.id)
            .expect("manual attempts")[0]
            .option
            .as_str(),
        "complete_manual"
    );
    assert!(IssueCompletionFlowRepository::new(&database.connection)
        .find_by_issue_id(manual_issue.id)
        .expect("manual flow")
        .is_none());

    let (clean_issue, _clean_session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "legacy clean flow",
        "running",
    );

    let clean = service
        .complete_issue_clean(CompleteIssueCleanInput {
            project_id,
            issue_id: clean_issue.id,
        })
        .expect("clean legacy entry delegates");
    assert_eq!(clean.status, IssueStatus::Completed);
    assert_eq!(
        CompletionAttemptRepository::new(&database.connection)
            .list_by_issue_id(clean_issue.id)
            .expect("clean attempts")[0]
            .option
            .as_str(),
        "complete_clean"
    );

    let (external_issue, external_session_id) = create_review_issue_with_session(
        &database.connection,
        project_id,
        &service,
        "legacy external worktree flow",
        "running",
    );
    let worktree_root = temp_dir.path().join("legacy-worktrees");
    let workspace_path = worktree_root.join("legacy-external");
    git(
        &repo_dir,
        &[
            "worktree",
            "add",
            "-B",
            "legacy-external",
            workspace_path.to_string_lossy().as_ref(),
            "main",
        ],
    );
    update_session_worktree(
        &database.connection,
        external_session_id,
        &workspace_path,
        &worktree_root,
        "legacy-external",
        WorktreeOwner::External,
    );
    write_file(&workspace_path, "tracked.txt", "legacy external\n");
    git(&workspace_path, &["commit", "-am", "legacy external"]);

    let external_error = service
        .complete_issue_manual(CompleteIssueManualInput {
            project_id,
            issue_id: external_issue.id,
        })
        .expect_err("legacy entry should not auto-confirm external worktree");
    assert_eq!(external_error.code, CommandErrorCode::IssueValidationFailed);
    let external_flow = IssueCompletionFlowRepository::new(&database.connection)
        .find_by_issue_id(external_issue.id)
        .expect("external flow")
        .expect("external flow exists");
    assert_eq!(
        external_flow.phase,
        IssueCompletionPhase::ConfirmingWorktreeCleanup
    );
    assert!(workspace_path.exists());
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
            label_ids: Vec::new(),
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
            label_ids: Vec::new(),
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
            label_ids: Vec::new(),
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
            label_ids: Vec::new(),
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
            label_ids: Vec::new(),
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
fn create_issue_persists_label_ids_and_hydrates_labels() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "label-repo");
    let project_label_id = insert_project_label_with_workflow_skill(
        &database.connection,
        "ops",
        "project",
        Some(project_id),
        "#112233",
        Some("hotfix-skill"),
    );
    let global_label_id =
        insert_project_label(&database.connection, "release", "global", None, "#445566");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );

    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Issue with labels".to_string(),
            description: "Label me".to_string(),
            attachments: Vec::new(),
            label_ids: vec![project_label_id, global_label_id],
        })
        .expect("create issue");

    let stored_label_ids: String = database
        .connection
        .query_row(
            "SELECT label_ids FROM issues WHERE id = ?1",
            [issue.id],
            |row| row.get(0),
        )
        .expect("stored label ids");

    assert_eq!(
        stored_label_ids,
        format!("[{project_label_id},{global_label_id}]")
    );
    assert_eq!(issue.labels.len(), 2);
    assert_eq!(issue.labels[0].id, project_label_id);
    assert_eq!(issue.labels[0].name, "ops");
    assert_eq!(issue.labels[0].color, "#112233");
    assert_eq!(
        issue.labels[0].workflow_skill.as_deref(),
        Some("hotfix-skill")
    );
    assert_eq!(issue.labels[1].id, global_label_id);
    assert_eq!(issue.labels[1].name, "release");
    assert_eq!(issue.labels[1].color, "#445566");
    assert_eq!(issue.labels[1].workflow_skill, None);
}

#[test]
fn update_issue_rejects_label_from_another_project() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "label-owner");
    let other_project_id = insert_project(&database.connection, "other-owner");
    let foreign_label_id = insert_project_label(
        &database.connection,
        "foreign",
        "project",
        Some(other_project_id),
        "#991B1B",
    );
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Issue".to_string(),
            description: "Description".to_string(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
        })
        .expect("create issue");

    let error = service
        .update_issue(UpdateIssueInput {
            project_id,
            issue_id: issue.id,
            title: "Issue".to_string(),
            description: "Description".to_string(),
            attachments: Vec::new(),
            label_ids: vec![foreign_label_id],
        })
        .expect_err("foreign label should fail");

    assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);
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
            label_ids: Vec::new(),
        })
        .expect("older issue");
    let newer_issue = service
        .create_issue(CreateIssueInput {
            project_id: first_project_id,
            title: "Newer".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
        })
        .expect("newer issue");
    service
        .create_issue(CreateIssueInput {
            project_id: second_project_id,
            title: "Other project".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
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
fn list_issues_per_status_caps_each_status_at_limit() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "per-status-cap-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );

    let mut created = Vec::new();
    for index in 0..25 {
        let issue = service
            .create_issue(CreateIssueInput {
                project_id,
                title: format!("Backlog {index}"),
                description: String::new(),
                attachments: Vec::new(),
                label_ids: Vec::new(),
            })
            .expect("create backlog issue");
        created.push(issue);
    }
    // 赋予递增的 updated_at，使排序确定：index 越大越新。
    for (index, issue) in created.iter().enumerate() {
        database
            .connection
            .execute(
                "UPDATE issues SET updated_at = ?1 WHERE id = ?2",
                rusqlite::params![1_780_630_000_000 + index as i64, issue.id],
            )
            .expect("set updated_at");
    }

    let response = service
        .list_issues_per_status(project_id, 20)
        .expect("per-status first page");

    // 25 个 backlog 被截断为 20；其余状态无 issue。
    assert_eq!(response.issues.len(), 20);
    assert!(response
        .issues
        .iter()
        .all(|issue| issue.status == IssueStatus::Backlog));
    // 甬道总数反映各状态的真实总量，不受每页上限影响。
    assert_eq!(
        response.status_totals,
        Some(IssueStatusTotals {
            backlog: 25,
            running: 0,
            review: 0,
            completed: 0,
        }),
    );
    // 返回的是最新的 20 条（index 5..24），最旧的 5 条被截断。
    let returned_ids: Vec<i64> = response.issues.iter().map(|issue| issue.id).collect();
    for issue in &created[5..25] {
        assert!(
            returned_ids.contains(&issue.id),
            "missing newest issue {}",
            issue.id
        );
    }
    for issue in &created[0..5] {
        assert!(
            !returned_ids.contains(&issue.id),
            "oldest issue {} should be paged out",
            issue.id
        );
    }

    // 调小上限：只返回 5 条；总数仍为 25，不随每页上限变化。
    let small = service
        .list_issues_per_status(project_id, 5)
        .expect("per-status small limit");
    assert_eq!(small.issues.len(), 5);
    assert_eq!(
        small.status_totals,
        Some(IssueStatusTotals {
            backlog: 25,
            running: 0,
            review: 0,
            completed: 0,
        }),
    );
}

#[test]
fn list_issues_page_paginates_by_status_with_offset() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "paged-load-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );

    let mut created = Vec::new();
    for index in 0..25 {
        let issue = service
            .create_issue(CreateIssueInput {
                project_id,
                title: format!("Backlog {index}"),
                description: String::new(),
                attachments: Vec::new(),
                label_ids: Vec::new(),
            })
            .expect("create backlog issue");
        created.push(issue);
    }
    for (index, issue) in created.iter().enumerate() {
        database
            .connection
            .execute(
                "UPDATE issues SET updated_at = ?1 WHERE id = ?2",
                rusqlite::params![1_780_630_000_000 + index as i64, issue.id],
            )
            .expect("set updated_at");
    }

    let first = service
        .list_issues_page(project_id, Some(IssueStatus::Backlog), Some(20), Some(0))
        .expect("first page");
    assert_eq!(first.issues.len(), 20);
    // 排序：最新在前（index 24 在首位，index 5 在末位）。
    assert_eq!(first.issues[0].id, created[24].id);
    assert_eq!(first.issues[19].id, created[5].id);

    let second = service
        .list_issues_page(project_id, Some(IssueStatus::Backlog), Some(20), Some(20))
        .expect("second page");
    assert_eq!(second.issues.len(), 5);
    assert_eq!(second.issues[0].id, created[4].id);
    assert_eq!(second.issues[4].id, created[0].id);

    // 第二页与第一页不应重复。
    let first_ids: std::collections::HashSet<i64> =
        first.issues.iter().map(|issue| issue.id).collect();
    for issue in &second.issues {
        assert!(
            !first_ids.contains(&issue.id),
            "duplicate issue across pages"
        );
    }
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
            label_ids: Vec::new(),
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
            label_ids: Vec::new(),
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
        .advance_issue_status(AdvanceIssueStatusInput {
            project_id,
            issue_id: issue.id,
            target_status: IssueStatus::Completed,
        })
        .expect_err("linked issue must use completion flow");

    assert_eq!(error.code, CommandErrorCode::IssueValidationFailed);
    assert!(error.message.contains("complete_issue_flow"));
    assert_eq!(
        IssueRepository::new(&database.connection)
            .find_by_id(issue.id)
            .expect("query issue")
            .expect("issue exists")
            .status,
        IssueStatus::Running
    );
    assert_eq!(
        AgentSessionRepository::new(&database.connection)
            .find_by_id(session_id)
            .expect("query session")
            .expect("session exists")
            .status,
        AgentSessionStatus::Running
    );
}

#[test]
fn advance_issue_status_allows_backward_transition_to_running() {
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
            label_ids: Vec::new(),
        })
        .expect("created issue");
    database
        .connection
        .execute(
            "UPDATE issues SET status = 'review' WHERE id = ?1",
            [issue.id],
        )
        .expect("set review");

    let updated = service
        .advance_issue_status(AdvanceIssueStatusInput {
            project_id,
            issue_id: issue.id,
            target_status: IssueStatus::Running,
        })
        .expect("backward transition should succeed");

    assert_eq!(updated.status, IssueStatus::Running);
}

#[test]
fn advance_issue_status_returns_running_issue_to_backlog_and_soft_deletes_session() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "return-to-backlog-repo");
    let service = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Return me".to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
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

    let updated = service
        .advance_issue_status(AdvanceIssueStatusInput {
            project_id,
            issue_id: issue.id,
            target_status: IssueStatus::Backlog,
        })
        .expect("return to backlog");

    assert_eq!(updated.status, IssueStatus::Backlog);
    assert_eq!(updated.linked_session_id, None);
    assert_eq!(updated.linked_session_status, None);

    let stored_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("query session");
    assert!(stored_session.is_none());

    let session_row: (String, i64) = database
        .connection
        .query_row(
            "SELECT status, del FROM agent_sessions WHERE id = ?1",
            [session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("session row");
    assert_eq!(session_row.0, "closed");
    assert_eq!(session_row.1, 1);

    let issue_actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue.id)
        .expect("issue actions");
    assert!(issue_actions
        .iter()
        .any(|action| action.action_type == IssueActionType::IssueStatusChanged));

    let session_events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    let latest_session_event = session_events.last().expect("latest session event");
    assert_eq!(
        latest_session_event.event_type,
        SessionEventType::SessionClosed
    );
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
            label_ids: Vec::new(),
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
        .query_row("SELECT del FROM issues WHERE id = ?1", [issue.id], |row| {
            row.get(0)
        })
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
            label_ids: Vec::new(),
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

fn insert_project_label(
    connection: &rusqlite::Connection,
    name: &str,
    scope: &str,
    project_id: Option<i64>,
    color: &str,
) -> i64 {
    insert_project_label_with_workflow_skill(connection, name, scope, project_id, color, None)
}

fn insert_project_label_with_workflow_skill(
    connection: &rusqlite::Connection,
    name: &str,
    scope: &str,
    project_id: Option<i64>,
    color: &str,
    workflow_skill: Option<&str>,
) -> i64 {
    connection
        .execute(
            "INSERT INTO project_labels (name, scope, project_id, color, workflow_skill, del)
             VALUES (?1, ?2, ?3, ?4, ?5, 0)",
            rusqlite::params![name, scope, project_id, color, workflow_skill],
        )
        .expect("insert project label");
    connection.last_insert_rowid()
}

fn insert_project_with_repo_path_and_policy(
    connection: &rusqlite::Connection,
    name: &str,
    repo_path: &Path,
) -> i64 {
    connection
        .execute(
            "INSERT INTO projects (name, repo_path, created_at, last_opened_at)
             VALUES (?1, ?2, 1780624800000, 1780624800000)",
            rusqlite::params![name, repo_path.to_string_lossy().to_string()],
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
    let repo_path: String = connection
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            [project_id],
            |row| row.get(0),
        )
        .expect("project repo path");
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
            ) VALUES (?1, ?2, ?3, ?4, 'none', ?5, 'codex', 'prompt', '/tmp/log', 1780628400000, 1780628400000)",
            rusqlite::params![project_id, issue_id, agent_profile_id, status, repo_path],
        )
        .expect("insert agent session");
    connection.last_insert_rowid()
}

fn issue_service(connection: &rusqlite::Connection) -> IssueService<'_> {
    IssueService::new(
        IssueRepository::new(connection),
        ProjectRepository::new(connection),
    )
}

fn create_review_issue_with_session(
    connection: &rusqlite::Connection,
    project_id: i64,
    service: &IssueService<'_>,
    title: &str,
    session_status: &str,
) -> (IssueRecord, i64) {
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: title.to_string(),
            description: "".to_string(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
        })
        .expect("created issue");
    connection
        .execute(
            "UPDATE issues SET status = 'review' WHERE id = ?1",
            [issue.id],
        )
        .expect("set review");
    let profile_id = insert_agent_profile(connection);
    let session_id = insert_agent_session_for_issue(
        connection,
        project_id,
        issue.id,
        profile_id,
        session_status,
    );
    if matches!(session_status, "closed" | "crashed" | "stopped") {
        connection
            .execute(
                "UPDATE agent_sessions SET closed_at = 1780628600000 WHERE id = ?1",
                [session_id],
            )
            .expect("set closed_at");
    }
    let issue = IssueRepository::new(connection)
        .find_by_id(issue.id)
        .expect("issue")
        .expect("issue exists");
    (issue, session_id)
}

fn update_session_worktree(
    connection: &rusqlite::Connection,
    session_id: i64,
    workspace_path: &Path,
    worktree_root: &Path,
    workspace_branch: &str,
    owner: WorktreeOwner,
) {
    connection
        .execute(
            "UPDATE agent_sessions
             SET working_dir = ?1,
                 workspace_mode = 'worktree',
                 target_branch = 'main',
                 workspace_branch = ?2,
                 workspace_path = ?1,
                 origin_branch = 'main',
                 worktree_owner = ?3,
                 worktree_root_path = ?4
             WHERE id = ?5",
            rusqlite::params![
                workspace_path.to_string_lossy().to_string(),
                workspace_branch,
                owner.as_str(),
                worktree_root.to_string_lossy().to_string(),
                session_id,
            ],
        )
        .expect("update worktree session");
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

/// 测试用结构化 session 句柄：记录所有 `send_message` 注入的文本，供断言完成流程
/// 向 session 发送了预期提示（如 rebase 冲突提示）。其余方法空实现。
struct RecordingHandle {
    sent: Arc<Mutex<Vec<String>>>,
}

impl RecordingHandle {
    fn new() -> (Self, Arc<Mutex<Vec<String>>>) {
        let sent = Arc::new(Mutex::new(Vec::new()));
        let handle = RecordingHandle {
            sent: Arc::clone(&sent),
        };
        (handle, sent)
    }
}

impl redwhisk_lib::agent::session_handle::AgentSessionHandle for RecordingHandle {
    fn send_message(
        &self,
        text: String,
        _attachments: Vec<redwhisk_lib::types::agent_session::AgentMessageAttachment>,
    ) -> Result<(), redwhisk_lib::agent::session_handle::AgentSessionError> {
        self.sent.lock().expect("recorder lock").push(text);
        Ok(())
    }
    fn cancel_turn(&self) -> Result<(), redwhisk_lib::agent::session_handle::AgentSessionError> {
        Ok(())
    }
    fn respond_permission(
        &self,
        _: &str,
        _: redwhisk_lib::types::agent_session::AgentPermissionDecision,
    ) -> Result<(), redwhisk_lib::agent::session_handle::AgentSessionError> {
        Ok(())
    }
    fn set_model(
        &self,
        _: String,
    ) -> Result<(), redwhisk_lib::agent::session_handle::AgentSessionError> {
        Ok(())
    }
    fn set_effort(
        &self,
        _: Option<String>,
    ) -> Result<(), redwhisk_lib::agent::session_handle::AgentSessionError> {
        Ok(())
    }
    fn set_mode(
        &self,
        _: &str,
    ) -> Result<(), redwhisk_lib::agent::session_handle::AgentSessionError> {
        Ok(())
    }
    fn list_models(
        &self,
    ) -> Result<
        Vec<redwhisk_lib::types::agent_session_stream::AgentModel>,
        redwhisk_lib::agent::session_handle::AgentSessionError,
    > {
        Ok(Vec::new())
    }
    fn list_modes(&self) -> Vec<redwhisk_lib::types::agent_session_stream::AgentMode> {
        Vec::new()
    }
    fn read_timeline(
        &self,
    ) -> Result<
        Vec<redwhisk_lib::types::agent_session_stream::AgentTimelineItem>,
        redwhisk_lib::agent::session_handle::AgentSessionError,
    > {
        Ok(Vec::new())
    }
    fn shutdown(&self) {}
    fn thread_id(&self) -> Option<String> {
        None
    }
}
