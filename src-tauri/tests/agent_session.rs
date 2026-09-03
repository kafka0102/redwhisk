use std::sync::Arc;

use redwhisk_lib::agent::agent_event_broadcaster::AgentEventBroadcaster;
use redwhisk_lib::agent::pty_session_manager::{
    read_terminal_snapshot, PtyCommandMode, PtyExitStatus, PtySessionManager, PtySpawnRequest,
};
use redwhisk_lib::agent::session_handle::{AgentSessionError, AgentSessionHandle};
use redwhisk_lib::agent::session_registry::AgentSessionRegistry;
use redwhisk_lib::db::agent_profile_repository::AgentProfileRepository;
use redwhisk_lib::db::agent_session_repository::AgentSessionRepository;
use redwhisk_lib::db::connection::DatabaseConfig;
use redwhisk_lib::db::event_repository::EventRepository;
use redwhisk_lib::db::issue_completion_flow_repository::{
    IssueCompletionFlowRecordInput, IssueCompletionFlowRepository,
};
use redwhisk_lib::db::issue_repository::IssueRepository;
use redwhisk_lib::db::migrations::MigrationRunner;
use redwhisk_lib::db::project_repository::ProjectRepository;
use redwhisk_lib::features::agent_session::AgentSessionService;
use redwhisk_lib::features::issue::IssueService;
use redwhisk_lib::git::worktree_name::issue_worktree_base_name;
use redwhisk_lib::types::agent_profile::{AgentScope, AgentType};
use redwhisk_lib::types::agent_session::{
    AgentMessageAttachment, AgentPermissionDecision, AgentSessionAttention, AgentSessionPromptKind,
    AgentSessionStatus, InjectAgentSessionPromptInput, ProjectGitBranchListInput,
    ResumeAgentSessionInput, SetAgentSessionAttentionInput, StartAgentSessionInput, WorkspaceMode,
    WorktreeOwner,
};
use redwhisk_lib::types::agent_session_stream::{AgentMode, AgentModel, AgentTimelineItem};
use redwhisk_lib::types::errors::CommandErrorCode;
use redwhisk_lib::types::issue::IssueStatus;
use redwhisk_lib::types::issue::{CompleteIssueManualInput, CreateIssueInput};
use redwhisk_lib::types::issue_action::IssueActionType;
use redwhisk_lib::types::issue_completion::IssueCompletionPhase;
use redwhisk_lib::types::session_event::SessionEventType;
use serde_json::Value;

struct NoopStructuredHandle;

impl AgentSessionHandle for NoopStructuredHandle {
    fn send_message(
        &self,
        _text: String,
        _attachments: Vec<AgentMessageAttachment>,
    ) -> Result<(), AgentSessionError> {
        Ok(())
    }

    fn cancel_turn(&self) -> Result<(), AgentSessionError> {
        Ok(())
    }

    fn respond_permission(
        &self,
        _request_id: &str,
        _decision: AgentPermissionDecision,
    ) -> Result<(), AgentSessionError> {
        Ok(())
    }

    fn set_model(&self, _model_id: String) -> Result<(), AgentSessionError> {
        Ok(())
    }

    fn set_effort(&self, _effort: Option<String>) -> Result<(), AgentSessionError> {
        Ok(())
    }

    fn set_mode(&self, _mode_id: &str) -> Result<(), AgentSessionError> {
        Ok(())
    }

    fn list_models(&self) -> Result<Vec<AgentModel>, AgentSessionError> {
        Ok(Vec::new())
    }

    fn list_modes(&self) -> Vec<AgentMode> {
        Vec::new()
    }

    fn read_timeline(&self) -> Result<Vec<AgentTimelineItem>, AgentSessionError> {
        Ok(Vec::new())
    }

    fn shutdown(&self) {}

    fn thread_id(&self) -> Option<String> {
        Some("thread-test".to_string())
    }
}

#[test]
fn agent_session_migration_creates_agent_sessions_and_session_events_schema() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = DatabaseConfig::new(temp_dir.path())
        .open()
        .expect("database");

    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");

    let session_columns = table_columns(&database.connection, "agent_sessions");
    assert_eq!(
        session_columns,
        vec![
            "id",
            "issue_id",
            "title",
            "agent_profile_id",
            "provider_session_id",
            "status",
            "attention",
            "working_dir",
            "command_snapshot",
            "prompt_snapshot",
            "log_path",
            "last_active_at",
            "started_at",
            "closed_at",
            "project_id",
            "latest_output",
            "del",
            "workspace_mode",
            "target_branch",
            "workspace_branch",
            "workspace_path",
            "worktree_root_path",
            "worktree_setup_command",
            "list_inserted_at",
            "origin_branch",
            "worktree_owner",
            "is_turn_running",
            "turn_ended_at",
            "workflow_skill_name",
            "number",
            "turn_started_at",
            "processing_ms",
            "last_output_at",
            "current_turn_source",
            "current_turn_id",
            "display_mode",
        ]
    );

    let session_event_columns = table_columns(&database.connection, "session_events");
    assert_eq!(
        session_event_columns,
        vec![
            "id",
            "session_id",
            "event_type",
            "payload_json",
            "created_at"
        ]
    );

    let completion_flow_columns = table_columns(&database.connection, "issue_completion_flows");
    assert_eq!(
        completion_flow_columns,
        vec![
            "id",
            "issue_id",
            "session_id",
            "phase",
            "ignore_dirty",
            "dirty_decision",
            "continue_after_commit",
            "worktree_cleanup_decision",
            "base_branch",
            "workspace_branch",
            "workspace_path",
            "actual_path",
            "failure_reason",
            "updated_at",
        ]
    );
}

#[test]
fn issue_completion_flow_repository_upserts_finds_and_clears_by_issue_id() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "completion-flow-project");
    let issue_id = insert_issue(&database.connection, project_id, "review");
    let profile_id =
        insert_agent_profile(&database.connection, AgentScope::Project, Some(project_id));
    let session_id = insert_agent_session_row(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Running,
        1_780_628_600_000,
        None,
    );

    let transaction = database
        .connection
        .unchecked_transaction()
        .expect("transaction");
    let created = IssueCompletionFlowRepository::upsert_in_transaction(
        &transaction,
        IssueCompletionFlowRecordInput {
            issue_id,
            session_id: None,
            phase: IssueCompletionPhase::DetectingWorkspace,
            ignore_dirty: false,
            dirty_decision: None,
            continue_after_commit: None,
            worktree_cleanup_decision: None,
            base_branch: Some("main"),
            workspace_branch: Some("feature/task"),
            workspace_path: Some("/tmp/worktree"),
            actual_path: None,
            failure_reason: None,
            updated_at: 1_780_628_600_000,
        },
    )
    .expect("create flow");

    assert_eq!(created.issue_id, issue_id);
    assert_eq!(created.phase, IssueCompletionPhase::DetectingWorkspace);
    assert!(!created.ignore_dirty);
    assert_eq!(created.base_branch.as_deref(), Some("main"));

    let updated = IssueCompletionFlowRepository::upsert_in_transaction(
        &transaction,
        IssueCompletionFlowRecordInput {
            issue_id,
            session_id: Some(session_id),
            phase: IssueCompletionPhase::ConfirmingWorktreeCleanup,
            ignore_dirty: true,
            dirty_decision: None,
            continue_after_commit: None,
            worktree_cleanup_decision: Some(true),
            base_branch: Some("main"),
            workspace_branch: Some("feature/task"),
            workspace_path: Some("/tmp/worktree"),
            actual_path: None,
            failure_reason: Some("needs confirmation"),
            updated_at: 1_780_628_700_000,
        },
    )
    .expect("update flow");

    assert_eq!(updated.id, created.id);
    assert_eq!(updated.session_id, Some(session_id));
    assert_eq!(
        updated.phase,
        IssueCompletionPhase::ConfirmingWorktreeCleanup
    );
    assert!(updated.ignore_dirty);
    assert_eq!(updated.worktree_cleanup_decision, Some(true));
    assert_eq!(
        updated.failure_reason.as_deref(),
        Some("needs confirmation")
    );

    let found =
        IssueCompletionFlowRepository::find_by_issue_id_in_transaction(&transaction, issue_id)
            .expect("find flow")
            .expect("flow exists");
    assert_eq!(found, updated);

    IssueCompletionFlowRepository::clear_in_transaction(&transaction, issue_id)
        .expect("clear flow");
    assert!(
        IssueCompletionFlowRepository::find_by_issue_id_in_transaction(&transaction, issue_id)
            .expect("find after clear")
            .is_none()
    );

    transaction.commit().expect("commit");
}

#[test]
fn start_agent_session_rejects_blank_prompt_snapshot() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo");
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    let profile_id =
        insert_agent_profile(&database.connection, AgentScope::Project, Some(project_id));
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let error = service
        .start_agent_session(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile_id,
                prompt_snapshot: "   ".to_string(),
                workflow_skill_name: None,
                workspace_mode: None,
                target_branch: None,
                worktree_setup_command: None,
            },
        )
        .expect_err("blank prompt should be rejected");

    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(error.message, "最终 prompt 不能为空。");
}

#[test]
fn start_agent_session_rejects_non_backlog_issue() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo");
    let issue_id = insert_issue(&database.connection, project_id, "review");
    let profile_id =
        insert_agent_profile(&database.connection, AgentScope::Project, Some(project_id));
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let error = service
        .start_agent_session(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile_id,
                prompt_snapshot: "Use this snapshot".to_string(),
                workflow_skill_name: None,
                workspace_mode: None,
                target_branch: None,
                worktree_setup_command: None,
            },
        )
        .expect_err("review issue should be rejected");

    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(error.message, "只有 backlog Issue 可以启动 Agent Session。");
}

#[test]
fn start_agent_session_rejects_project_profile_from_another_project() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo");
    let other_project_id = insert_project(&database.connection, "other-repo");
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    let profile_id = insert_agent_profile(
        &database.connection,
        AgentScope::Project,
        Some(other_project_id),
    );
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let error = service
        .start_agent_session(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile_id,
                prompt_snapshot: "Use this snapshot".to_string(),
                workflow_skill_name: None,
                workspace_mode: None,
                target_branch: None,
                worktree_setup_command: None,
            },
        )
        .expect_err("project profile should be bound to the same project");

    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(error.message, "项目级 Agent Profile 不属于当前 Project。");
}

#[test]
fn start_agent_session_rejects_deleted_agent_profile() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo");
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    let profile_id =
        insert_agent_profile(&database.connection, AgentScope::Project, Some(project_id));
    AgentProfileRepository::new(&database.connection)
        .soft_delete_profile(profile_id)
        .expect("soft delete profile");
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let error = service
        .start_agent_session(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile_id,
                prompt_snapshot: "Use this snapshot".to_string(),
                workflow_skill_name: None,
                workspace_mode: None,
                target_branch: None,
                worktree_setup_command: None,
            },
        )
        .expect_err("deleted profile should be rejected");

    assert_eq!(error.code, CommandErrorCode::AgentProfileValidationFailed);
    assert_eq!(error.message, "Agent Profile 已删除。");
}

#[test]
fn start_agent_session_creates_session_updates_issue_and_records_events() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo-success");
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    let profile_id = insert_agent_profile_with_command(
        &database.connection,
        AgentScope::Global,
        None,
        success_command(temp_dir.path()).to_string_lossy().as_ref(),
    );
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let result = service
        .start_agent_session(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile_id,
                prompt_snapshot: "Use this snapshot".to_string(),
                workflow_skill_name: Some("bmad-dev-story".to_string()),
                workspace_mode: None,
                target_branch: None,
                worktree_setup_command: None,
            },
        )
        .expect("start should succeed");

    assert!(result.session_id > 0);
    assert_eq!(result.issue_id, issue_id);

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_id(result.session_id)
        .expect("find session")
        .expect("session should exist");
    assert_eq!(session.issue_id, Some(issue_id));
    assert_eq!(session.project_id, project_id);
    assert_eq!(session.agent_profile_id, profile_id);
    assert_eq!(
        session.status,
        redwhisk_lib::types::agent_session::AgentSessionStatus::Running
    );
    assert_eq!(
        session.attention,
        redwhisk_lib::types::agent_session::AgentSessionAttention::None
    );
    assert_eq!(session.prompt_snapshot, "Use this snapshot");
    assert_eq!(
        session.workflow_skill_name.as_deref(),
        Some("bmad-dev-story")
    );
    assert_eq!(session.origin_branch.as_deref(), Some("main"));
    assert_eq!(session.worktree_owner, WorktreeOwner::External);
    assert!(session.log_path.contains("session-logs"));

    let issue = IssueRepository::new(&database.connection)
        .find_by_id(issue_id)
        .expect("find issue")
        .expect("issue should exist");
    assert_eq!(issue.status, IssueStatus::Running);

    let issue_actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue_id)
        .expect("issue actions");
    assert_eq!(issue_actions.len(), 2);
    assert_eq!(
        issue_actions[0].action_type,
        IssueActionType::AgentSessionStarted
    );

    let session_events = EventRepository::new(&database.connection)
        .list_session_events(result.session_id)
        .expect("session events");
    assert_eq!(session_events.len(), 1);
    assert_eq!(
        session_events[0].event_type,
        SessionEventType::SessionStarted
    );
}

#[test]
fn set_session_attention_on_standalone_session_records_session_event_without_issue_side_effects() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "standalone-attention-project");
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let session_id = insert_standalone_agent_session_row(
        &database.connection,
        project_id,
        profile_id,
        AgentSessionStatus::Running,
        AgentSessionAttention::None,
        1_780_628_366_000,
        None,
        "/tmp/standalone-attention.log",
    );

    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let result = service
        .set_session_attention(SetAgentSessionAttentionInput {
            project_id,
            session_id,
            attention: AgentSessionAttention::Requested,
        })
        .expect("set standalone attention");

    assert_eq!(result.session_id, session_id);
    assert_eq!(result.attention, AgentSessionAttention::Requested);

    let refreshed_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find session")
        .expect("session should exist");
    assert_eq!(
        refreshed_session.attention,
        AgentSessionAttention::Requested
    );
    assert_eq!(refreshed_session.issue_id, None);

    let issue_response = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    )
    .list_issues(project_id)
    .expect("list issues");
    assert_eq!(issue_response.issues.len(), 1);
    assert_eq!(issue_response.issues[0].id, issue_id);
    assert_eq!(issue_response.issues[0].status, IssueStatus::Backlog);
    assert_eq!(issue_response.issues[0].linked_session_id, None);
    assert_eq!(issue_response.issues[0].linked_session_status, None);
    assert_eq!(issue_response.issues[0].linked_session_attention, None);

    let issue_actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue_id)
        .expect("issue actions");
    assert_eq!(issue_actions.len(), 1);
    assert_eq!(issue_actions[0].action_type, IssueActionType::IssueCreated);

    let session_events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert_eq!(session_events.len(), 1);
    assert_eq!(
        session_events[0].event_type,
        SessionEventType::SessionAttentionRequested
    );

    let payload: Value =
        serde_json::from_str(&session_events[0].payload_json).expect("parse payload");
    assert_eq!(payload["sessionId"].as_i64(), Some(session_id));
    assert!(payload["issueId"].is_null());
    assert_eq!(payload["attention"].as_str(), Some("requested"));
    assert_eq!(payload["trigger"].as_str(), Some("manual"));
}

#[test]
fn start_agent_session_rejects_second_session_for_same_issue() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo-duplicate");
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    let profile_id = insert_agent_profile_with_command(
        &database.connection,
        AgentScope::Global,
        None,
        success_command(temp_dir.path()).to_string_lossy().as_ref(),
    );
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let first_result = service
        .start_agent_session(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile_id,
                prompt_snapshot: "Use this snapshot".to_string(),
                workflow_skill_name: None,
                workspace_mode: None,
                target_branch: None,
                worktree_setup_command: None,
            },
        )
        .expect("first start should succeed");

    let error = service
        .start_agent_session(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile_id,
                prompt_snapshot: "Retry snapshot".to_string(),
                workflow_skill_name: None,
                workspace_mode: None,
                target_branch: None,
                worktree_setup_command: None,
            },
        )
        .expect_err("second start should be rejected");

    assert_eq!(error.code, CommandErrorCode::AgentSessionAlreadyExists);
    assert_eq!(error.message, "当前 Issue 已存在关联 Agent Session。");

    let details = error.details.expect("details should exist");
    assert!(details.iter().any(|detail| {
        detail
            == &redwhisk_lib::types::errors::ErrorDetail::new("Issue")
                .with_value("issueId", issue_id)
    }));
    assert!(details.iter().any(|detail| {
        detail
            == &redwhisk_lib::types::errors::ErrorDetail::new("AgentSession")
                .with_value("sessionId", first_result.session_id)
                .with_value("status", "running")
    }));

    let issue_actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue_id)
        .expect("issue actions");
    assert_eq!(issue_actions.len(), 2);

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_issue_id(issue_id)
        .expect("find session by issue")
        .expect("session should still exist");
    assert_eq!(session.id, first_result.session_id);
}

#[test]
fn start_agent_session_returns_start_failed_and_rolls_back_when_command_cannot_start() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo-fail");
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    let profile_id = insert_agent_profile_with_command(
        &database.connection,
        AgentScope::Global,
        None,
        temp_dir
            .path()
            .join("missing-agent-command")
            .to_string_lossy()
            .as_ref(),
    );
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let error = service
        .start_agent_session(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile_id,
                prompt_snapshot: "Use this snapshot".to_string(),
                workflow_skill_name: None,
                workspace_mode: None,
                target_branch: None,
                worktree_setup_command: None,
            },
        )
        .expect_err("start should fail when command cannot start");

    assert_eq!(error.code, CommandErrorCode::AgentSessionStartFailed);

    let issue = IssueRepository::new(&database.connection)
        .find_by_id(issue_id)
        .expect("find issue")
        .expect("issue should exist");
    assert_eq!(issue.status, IssueStatus::Backlog);

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_issue_id(issue_id)
        .expect("find session by issue");
    assert!(session.is_none());

    let session_event_count = EventRepository::new(&database.connection)
        .list_session_events(1)
        .expect("list session events");
    assert!(session_event_count.is_empty());
}

#[test]
fn start_structured_claude_issue_session_log_path_uses_number_segments() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    // 预占其它 project 的 issue/session 把全局自增 id 顶高，使目标 project 内首个
    // issue/session 的 id 与项目内 number 拉开差距；这样若创建侧误传 .id 而非 .number，
    // log_path 文件名段会偏离 number 形式，下方断言可捕获回退。
    let seed_project_id = insert_project(&database.connection, "number-seed-project");
    let project_id = insert_project(&database.connection, "log-path-number-project");
    let seed_issue_id = insert_issue(&database.connection, seed_project_id, "backlog");
    let issue_id = insert_issue(&database.connection, project_id, "backlog");

    let profile_id = {
        let repository = AgentProfileRepository::new(&database.connection);
        let profile = repository
            .save_profile(
                None,
                "Claude",
                AgentType::Claude,
                success_command(temp_dir.path()).to_string_lossy().as_ref(),
                &AgentScope::Global,
                None,
                "full-auto",
                true,
                "",
                "",
                "json",
                true,
            )
            .expect("save claude profile");
        profile.id
    };

    // 预占一条 session（其它 project），把全局 session id 顶高。
    {
        let transaction = database
            .connection
            .unchecked_transaction()
            .expect("seed session transaction");
        AgentSessionRepository::insert_in_transaction(
            &transaction,
            seed_project_id,
            seed_issue_id,
            profile_id,
            None,
            temp_dir.path().to_string_lossy().as_ref(),
            "claude",
            "",
            &WorkspaceMode::CurrentBranch,
            None,
            None,
            None,
            Some("main"),
            WorktreeOwner::External,
            None,
            None,
            "/tmp/redwhisk-log-path-number-seed.log",
            "json",
            1_780_000_000_000,
        )
        .expect("seed session");
        transaction.commit().expect("commit seed session");
    }

    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();
    let manager = PtySessionManager::new();
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let result = service
        .start_agent_session_with_runtime(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile_id,
                prompt_snapshot: "请开始".to_string(),
                workflow_skill_name: None,
                workspace_mode: None,
                target_branch: None,
                worktree_setup_command: None,
            },
            &manager,
            &registry,
            &broadcaster,
        )
        .expect("structured claude issue session should start");

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_id(result.session_id)
        .expect("find session")
        .expect("session should exist");
    let issue = IssueRepository::new(&database.connection)
        .find_by_id(issue_id)
        .expect("find issue")
        .expect("issue should exist");

    // 前置校验：number 与 id 必须不同，否则本用例无法识别 .number→.id 回退。
    assert_ne!(issue.number, issue.id, "issue number should differ from id");
    assert_ne!(
        session.number, session.id,
        "session number should differ from id"
    );

    let expected_file = format!(
        "project-{}-issue-{}-session-{}.jsonl",
        project_id, issue.number, session.number
    );
    assert!(
        session.log_path.ends_with(&expected_file),
        "log_path should end with number-based filename; got {}",
        session.log_path
    );
    let id_form = format!("issue-{}-session-{}", issue.id, session.id);
    assert!(
        !session.log_path.contains(&id_form),
        "log_path should not contain id-based segments; got {}",
        session.log_path
    );

    // 清理后台 claude 子进程。
    if let Some(handle) = registry.unregister(result.session_id) {
        handle.shutdown();
    }
}

#[test]
fn start_agent_session_maps_insert_time_unique_violation_to_existing_session_error() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo-race");
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    let profile_id = insert_agent_profile_with_command(
        &database.connection,
        AgentScope::Global,
        None,
        success_command(temp_dir.path()).to_string_lossy().as_ref(),
    );
    let created_session = {
        let transaction = database
            .connection
            .unchecked_transaction()
            .expect("transaction");
        let session = AgentSessionRepository::insert_in_transaction(
            &transaction,
            project_id,
            issue_id,
            profile_id,
            None,
            temp_dir.path().to_string_lossy().as_ref(),
            "codex",
            "Use this snapshot",
            &WorkspaceMode::CurrentBranch,
            None,
            None,
            None,
            Some("main"),
            WorktreeOwner::External,
            None,
            None,
            "/tmp/redwhisk-session-race.log",
            "json",
            1_780_000_000_000,
        )
        .expect("insert existing session");
        transaction.commit().expect("commit existing session");
        session
    };
    database
        .connection
        .execute_batch(
            "CREATE TRIGGER force_agent_session_unique_violation
             BEFORE INSERT ON agent_sessions
             BEGIN
               SELECT RAISE(FAIL, 'UNIQUE constraint failed: agent_sessions.issue_id');
             END;",
        )
        .expect("create trigger");
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let error = service
        .start_agent_session(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile_id,
                prompt_snapshot: "Use this snapshot".to_string(),
                workflow_skill_name: None,
                workspace_mode: None,
                target_branch: None,
                worktree_setup_command: None,
            },
        )
        .expect_err("insert-time unique violation should map to existing-session error");

    assert_eq!(error.code, CommandErrorCode::AgentSessionAlreadyExists);
    assert_eq!(error.message, "当前 Issue 已存在关联 Agent Session。");
    let details = error.details.expect("details should exist");
    assert!(details.iter().any(|detail| {
        detail
            == &redwhisk_lib::types::errors::ErrorDetail::new("AgentSession")
                .with_value("sessionId", created_session.id)
                .with_value("status", "running")
    }));
    let issue = IssueRepository::new(&database.connection)
        .find_by_id(issue_id)
        .expect("find issue")
        .expect("issue should exist");
    assert_eq!(issue.status, IssueStatus::Backlog);
}

#[test]
fn start_agent_session_ignores_soft_deleted_session_for_same_issue() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo-soft-deleted-session");
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    let profile_id = insert_agent_profile_with_command(
        &database.connection,
        AgentScope::Global,
        None,
        success_command(temp_dir.path()).to_string_lossy().as_ref(),
    );
    let deleted_session = {
        let transaction = database
            .connection
            .unchecked_transaction()
            .expect("transaction");
        let session = AgentSessionRepository::insert_in_transaction(
            &transaction,
            project_id,
            issue_id,
            profile_id,
            None,
            temp_dir.path().to_string_lossy().as_ref(),
            "codex",
            "Old prompt",
            &WorkspaceMode::CurrentBranch,
            None,
            None,
            None,
            Some("main"),
            WorktreeOwner::External,
            None,
            None,
            "/tmp/redwhisk-soft-deleted-session.log",
            "json",
            1_780_000_000_000,
        )
        .expect("insert deleted session");
        AgentSessionRepository::soft_delete_in_transaction(
            &transaction,
            session.id,
            1_780_000_000_001,
        )
        .expect("soft delete session");
        transaction.commit().expect("commit deleted session");
        session
    };
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let result = service
        .start_agent_session(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile_id,
                prompt_snapshot: "Use this snapshot".to_string(),
                workflow_skill_name: None,
                workspace_mode: None,
                target_branch: None,
                worktree_setup_command: None,
            },
        )
        .expect("soft-deleted session should not block a new run");

    assert_ne!(result.session_id, deleted_session.id);
    let active_session = AgentSessionRepository::new(&database.connection)
        .find_by_issue_id(issue_id)
        .expect("find active session")
        .expect("active session");
    assert_eq!(active_session.id, result.session_id);
    assert_eq!(active_session.issue_id, Some(issue_id));

    let issue = IssueRepository::new(&database.connection)
        .find_by_id(issue_id)
        .expect("find issue")
        .expect("issue should exist");
    assert_eq!(issue.status, IssueStatus::Running);

    let total_sessions_for_issue = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM agent_sessions WHERE issue_id = ?1",
            [issue_id],
            |row| row.get::<_, i64>(0),
        )
        .expect("session count");
    assert_eq!(total_sessions_for_issue, 2);
}

#[test]
fn start_agent_session_with_pty_submits_initial_prompt_to_terminal() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo-pty-prompt");
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    let profile_id = insert_agent_profile_with_command(
        &database.connection,
        AgentScope::Global,
        None,
        echo_stdin_command(temp_dir.path())
            .to_string_lossy()
            .as_ref(),
    );
    let manager = PtySessionManager::new();
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let result = service
        .start_agent_session_with_pty(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile_id,
                prompt_snapshot: "please start working".to_string(),
                workflow_skill_name: None,
                workspace_mode: None,
                target_branch: None,
                worktree_setup_command: None,
            },
            &manager,
        )
        .expect("start should succeed");

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_id(result.session_id)
        .expect("find session")
        .expect("session should exist");

    let mut snapshot = String::new();
    for _ in 0..20 {
        std::thread::sleep(std::time::Duration::from_millis(50));
        let _ = manager.flush_log(result.session_id);
        snapshot = read_terminal_snapshot(std::path::Path::new(&session.log_path), 8_192)
            .expect("read snapshot");
        if snapshot.contains("please start working") {
            break;
        }
    }

    assert!(snapshot.contains("please start working"));
    manager.kill(result.session_id).expect("kill session");
}

#[test]
fn get_project_git_branches_returns_current_and_local_branches() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "branch-list-project");
    let repo_path: String = database
        .connection
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            [project_id],
            |row| row.get(0),
        )
        .expect("repo path");
    let repo_path = std::path::PathBuf::from(repo_path);
    git(&repo_path, &["checkout", "-b", "develop"]);
    git(&repo_path, &["checkout", "main"]);
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let result = service
        .get_project_git_branches(ProjectGitBranchListInput { project_id })
        .expect("git branches");

    assert_eq!(result.current_branch, "main");
    assert!(result.local_branches.contains(&"main".to_string()));
    assert!(result.local_branches.contains(&"develop".to_string()));
}

#[test]
fn get_project_git_branches_excludes_branches_checked_out_by_other_worktrees() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "branch-filter-worktree-project");
    let repo_path: String = database
        .connection
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            [project_id],
            |row| row.get(0),
        )
        .expect("repo path");
    let repo_path = std::path::PathBuf::from(repo_path);
    git(&repo_path, &["checkout", "-b", "develop"]);
    git(&repo_path, &["checkout", "main"]);
    let worktree_path = temp_dir.path().join("parallel-worktree");
    git(
        &repo_path,
        &[
            "worktree",
            "add",
            worktree_path.to_string_lossy().as_ref(),
            "develop",
        ],
    );
    git(&repo_path, &["branch", "issue-42-review"]);
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let result = service
        .get_project_git_branches(ProjectGitBranchListInput { project_id })
        .expect("git branches");

    assert_eq!(result.current_branch, "main");
    assert!(result.local_branches.contains(&"main".to_string()));
    assert!(!result.local_branches.contains(&"develop".to_string()));
    assert!(!result
        .local_branches
        .contains(&"issue-42-review".to_string()));
}

#[test]
fn start_agent_session_in_worktree_mode_creates_worktree_and_persists_context() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "worktree-session-project");
    let repo_path: String = database
        .connection
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            [project_id],
            |row| row.get(0),
        )
        .expect("repo path");
    let repo_path = std::path::PathBuf::from(repo_path);
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    database
        .connection
        .execute(
            "UPDATE projects
             SET worktree_location = 'repo_internal',
                 worktree_setup_command = 'printf project-setup > project-setup.txt'
             WHERE id = ?1",
            [project_id],
        )
        .expect("update project worktree settings");
    let profile = AgentProfileRepository::new(&database.connection)
        .save_profile(
            None,
            "Codex",
            AgentType::Codex,
            success_command(temp_dir.path()).to_string_lossy().as_ref(),
            &AgentScope::Project,
            Some(project_id),
            "full-auto",
            true,
            "bmad-dev-story",
            "",
            "json",
            true,
        )
        .expect("save profile");
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let result = service
        .start_agent_session(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile.id,
                prompt_snapshot: "Use this snapshot".to_string(),
                workflow_skill_name: None,
                workspace_mode: Some(WorkspaceMode::Worktree),
                target_branch: Some("main".to_string()),
                worktree_setup_command: Some("printf run-setup > run-setup.txt".to_string()),
            },
        )
        .expect("start worktree session");

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_id(result.session_id)
        .expect("find session")
        .expect("session exists");

    assert_eq!(session.workspace_mode, WorkspaceMode::Worktree);
    assert_eq!(session.target_branch.as_deref(), Some("main"));
    assert_eq!(session.origin_branch.as_deref(), Some("main"));
    assert_eq!(session.worktree_owner, WorktreeOwner::Redwhisk);
    assert_eq!(
        session.worktree_root_path.as_deref(),
        Some(repo_path.join(".worktrees").to_string_lossy().as_ref())
    );
    assert_eq!(
        session.worktree_setup_command.as_deref(),
        Some("printf run-setup > run-setup.txt")
    );
    let workspace_path = session.workspace_path.expect("workspace path");
    assert!(std::path::Path::new(&workspace_path).is_dir());
    assert_ne!(workspace_path, repo_path.to_string_lossy());
    let issue_number: i64 = database
        .connection
        .query_row(
            "SELECT number FROM issues WHERE id = ?1",
            rusqlite::params![issue_id],
            |row| row.get(0),
        )
        .expect("read issue number");
    // workspace_branch 使用项目内编号 + 仓库 basename slug，而不是全局 id。
    let expected_base = issue_worktree_base_name(issue_number, &repo_path);
    assert_eq!(
        session.workspace_branch.as_deref(),
        Some(expected_base.as_str())
    );
    assert!(
        workspace_path.replace('\\', "/").ends_with(&expected_base),
        "workspace path should end with {expected_base}, got: {workspace_path}"
    );
    assert_eq!(session.working_dir, workspace_path);
}

#[test]
fn start_agent_session_in_worktree_mode_rejects_leftover_worktree_on_disk() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "worktree-leftover-project");
    let repo_path: String = database
        .connection
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            [project_id],
            |row| row.get(0),
        )
        .expect("repo path");
    let repo_path = std::path::PathBuf::from(repo_path);
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    let issue_number: i64 = database
        .connection
        .query_row(
            "SELECT number FROM issues WHERE id = ?1",
            rusqlite::params![issue_id],
            |row| row.get(0),
        )
        .expect("read issue number");
    database
        .connection
        .execute(
            "UPDATE projects
             SET worktree_location = 'repo_internal',
                 worktree_setup_command = 'printf project-setup > project-setup.txt'
             WHERE id = ?1",
            [project_id],
        )
        .expect("update project worktree settings");
    let profile = AgentProfileRepository::new(&database.connection)
        .save_profile(
            None,
            "Codex",
            AgentType::Codex,
            success_command(temp_dir.path()).to_string_lossy().as_ref(),
            &AgentScope::Project,
            Some(project_id),
            "full-auto",
            true,
            "bmad-dev-story",
            "",
            "json",
            true,
        )
        .expect("save profile");
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    // 模拟上次启动失败遗留的新主路径 worktree（无 session 行，纯磁盘残留）。
    let expected_base = issue_worktree_base_name(issue_number, &repo_path);
    let leftover_path = repo_path.join(".worktrees").join(&expected_base);
    std::fs::create_dir_all(&leftover_path).expect("create leftover worktree dir");

    let error = service
        .start_agent_session(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile.id,
                prompt_snapshot: "Use this snapshot".to_string(),
                workflow_skill_name: None,
                workspace_mode: Some(WorkspaceMode::Worktree),
                target_branch: Some("main".to_string()),
                worktree_setup_command: Some("printf run-setup > run-setup.txt".to_string()),
            },
        )
        .expect_err("start should reject leftover worktree");

    assert_eq!(error.code, CommandErrorCode::IssueWorktreeOccupied);
    // 占用检测发生在创建 session 之前：issue 应回到 backlog，无 session 残留。
    let issue = IssueRepository::new(&database.connection)
        .find_by_id(issue_id)
        .expect("find issue")
        .expect("issue exists");
    assert_eq!(issue.status, IssueStatus::Backlog);
    assert!(
        AgentSessionRepository::new(&database.connection)
            .find_by_issue_id(issue_id)
            .expect("find session")
            .is_none(),
        "no session should be created"
    );
}

#[test]
fn start_agent_session_in_worktree_mode_allows_orphan_legacy_issue_dir() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "worktree-legacy-orphan-project");
    let repo_path: String = database
        .connection
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            [project_id],
            |row| row.get(0),
        )
        .expect("repo path");
    let repo_path = std::path::PathBuf::from(repo_path);
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    let issue_number: i64 = database
        .connection
        .query_row(
            "SELECT number FROM issues WHERE id = ?1",
            rusqlite::params![issue_id],
            |row| row.get(0),
        )
        .expect("read issue number");
    database
        .connection
        .execute(
            "UPDATE projects
             SET worktree_location = 'repo_internal',
                 worktree_setup_command = 'printf project-setup > project-setup.txt'
             WHERE id = ?1",
            [project_id],
        )
        .expect("update project worktree settings");
    let profile = AgentProfileRepository::new(&database.connection)
        .save_profile(
            None,
            "Codex",
            AgentType::Codex,
            success_command(temp_dir.path()).to_string_lossy().as_ref(),
            &AgentScope::Project,
            Some(project_id),
            "full-auto",
            true,
            "bmad-dev-story",
            "",
            "json",
            true,
        )
        .expect("save profile");
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    // 无 session 的旧式 issue-N 目录不应阻止创建 issue-N-reponame。
    let legacy_path = repo_path
        .join(".worktrees")
        .join(format!("issue-{issue_number}"));
    std::fs::create_dir_all(&legacy_path).expect("create legacy worktree dir");

    let result = service
        .start_agent_session(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile.id,
                prompt_snapshot: "Use this snapshot".to_string(),
                workflow_skill_name: None,
                workspace_mode: Some(WorkspaceMode::Worktree),
                target_branch: Some("main".to_string()),
                worktree_setup_command: Some("printf run-setup > run-setup.txt".to_string()),
            },
        )
        .expect("start should allow orphan legacy dir");

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_id(result.session_id)
        .expect("find session")
        .expect("session exists");
    let expected_base = issue_worktree_base_name(issue_number, &repo_path);
    assert_eq!(
        session.workspace_branch.as_deref(),
        Some(expected_base.as_str())
    );
    let workspace_path = session.workspace_path.expect("workspace path");
    assert!(
        workspace_path.replace('\\', "/").ends_with(&expected_base),
        "workspace path should end with {expected_base}, got: {workspace_path}"
    );
    assert!(legacy_path.exists(), "legacy orphan dir remains untouched");
}

#[test]
fn start_agent_session_in_worktree_mode_runs_setup_command_before_agent_start() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "worktree-setup-project");
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    database
        .connection
        .execute(
            "UPDATE projects
             SET worktree_location = 'repo_internal',
                 worktree_setup_command = 'printf setup > setup-marker.txt'
             WHERE id = ?1",
            [project_id],
        )
        .expect("update project worktree settings");
    let profile = AgentProfileRepository::new(&database.connection)
        .save_profile(
            None,
            "Codex",
            AgentType::Codex,
            success_command(temp_dir.path()).to_string_lossy().as_ref(),
            &AgentScope::Project,
            Some(project_id),
            "full-auto",
            true,
            "bmad-dev-story",
            "",
            "json",
            true,
        )
        .expect("save profile");
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let result = service
        .start_agent_session(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile.id,
                prompt_snapshot: "Use this snapshot".to_string(),
                workflow_skill_name: None,
                workspace_mode: Some(WorkspaceMode::Worktree),
                target_branch: Some("main".to_string()),
                worktree_setup_command: None,
            },
        )
        .expect("start worktree session");

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_id(result.session_id)
        .expect("find session")
        .expect("session exists");
    let marker_path = std::path::Path::new(&session.working_dir).join("setup-marker.txt");
    assert_eq!(
        std::fs::read_to_string(marker_path).expect("setup marker"),
        "setup"
    );
}

#[test]
fn start_agent_session_in_worktree_mode_rejects_failed_setup_command_without_session() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "worktree-setup-failure-project");
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    database
        .connection
        .execute(
            "UPDATE projects
             SET worktree_location = 'repo_internal',
                 worktree_setup_command = 'exit 17'
             WHERE id = ?1",
            [project_id],
        )
        .expect("update project worktree settings");
    let profile = AgentProfileRepository::new(&database.connection)
        .save_profile(
            None,
            "Codex",
            AgentType::Codex,
            success_command(temp_dir.path()).to_string_lossy().as_ref(),
            &AgentScope::Project,
            Some(project_id),
            "full-auto",
            true,
            "bmad-dev-story",
            "",
            "json",
            true,
        )
        .expect("save profile");
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let error = service
        .start_agent_session(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile.id,
                prompt_snapshot: "Use this snapshot".to_string(),
                workflow_skill_name: None,
                workspace_mode: Some(WorkspaceMode::Worktree),
                target_branch: Some("main".to_string()),
                worktree_setup_command: None,
            },
        )
        .expect_err("setup failure should block launch");

    assert_eq!(error.code, CommandErrorCode::AgentSessionStartFailed);
    assert!(AgentSessionRepository::new(&database.connection)
        .find_by_issue_id(issue_id)
        .expect("find issue session")
        .is_none());
    let issue_status: String = database
        .connection
        .query_row(
            "SELECT status FROM issues WHERE id = ?1",
            [issue_id],
            |row| row.get(0),
        )
        .expect("issue status");
    assert_eq!(issue_status, "backlog");
}

#[test]
fn start_agent_session_uses_project_worktree_location_when_input_omits_setup_override() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sibling-worktree-session-project");
    let repo_path: String = database
        .connection
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            [project_id],
            |row| row.get(0),
        )
        .expect("repo path");
    let repo_path = std::path::PathBuf::from(repo_path);
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    database
        .connection
        .execute(
            "UPDATE projects
             SET worktree_location = ?1,
                 worktree_setup_command = 'printf project-setup > project-setup.txt'
             WHERE id = ?2",
            rusqlite::params!["repo_sibling", project_id],
        )
        .expect("update project worktree settings");
    let profile = AgentProfileRepository::new(&database.connection)
        .save_profile(
            None,
            "Codex",
            AgentType::Codex,
            success_command(temp_dir.path()).to_string_lossy().as_ref(),
            &AgentScope::Project,
            Some(project_id),
            "full-auto",
            true,
            "bmad-dev-story",
            "",
            "json",
            true,
        )
        .expect("save profile");
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let result = service
        .start_agent_session(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile.id,
                prompt_snapshot: "Use this snapshot".to_string(),
                workflow_skill_name: None,
                workspace_mode: Some(WorkspaceMode::Worktree),
                target_branch: Some("main".to_string()),
                worktree_setup_command: None,
            },
        )
        .expect("start worktree session");

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_id(result.session_id)
        .expect("find session")
        .expect("session exists");
    assert_eq!(
        session.worktree_root_path.as_deref(),
        Some(
            repo_path
                .parent()
                .expect("repo parent")
                .join(format!(
                    "{}.worktrees",
                    repo_path
                        .file_name()
                        .expect("repo directory name")
                        .to_string_lossy()
                ))
                .to_string_lossy()
                .as_ref()
        )
    );
    assert_eq!(
        session.worktree_setup_command.as_deref(),
        Some("printf project-setup > project-setup.txt")
    );
}

#[test]
fn complete_issue_manual_with_pty_terminates_tracked_session() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "manual-complete-pty-project");
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    let profile_id = insert_agent_profile_with_command(
        &database.connection,
        AgentScope::Global,
        None,
        success_command(temp_dir.path()).to_string_lossy().as_ref(),
    );
    let manager = PtySessionManager::new();
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let result = service
        .start_agent_session_with_pty(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id,
                issue_id,
                agent_profile_id: profile_id,
                prompt_snapshot: "ready to complete".to_string(),
                workflow_skill_name: None,
                workspace_mode: None,
                target_branch: None,
                worktree_setup_command: None,
            },
            &manager,
        )
        .expect("start should succeed");

    database
        .connection
        .execute(
            "UPDATE issues SET status = 'review' WHERE id = ?1",
            [issue_id],
        )
        .expect("set review");

    let completed = AgentSessionService::complete_issue_manual_in_data_dir(
        temp_dir.path(),
        CompleteIssueManualInput {
            project_id,
            issue_id,
        },
        &manager,
        &AgentSessionRegistry::new(),
    )
    .expect("complete issue manually");

    assert_eq!(completed.status, IssueStatus::Completed);
    for _ in 0..20 {
        if !manager.contains(result.session_id) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    assert!(!manager.contains(result.session_id));
}

#[test]
fn list_agent_sessions_groups_and_sorts_sessions_for_the_current_project() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "agents-list-project");
    let other_project_id = insert_project(&database.connection, "agents-other-project");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);

    let newer_running_issue = insert_issue_with_title(
        &database.connection,
        project_id,
        "running",
        "Newest running issue",
    );
    let older_running_issue = insert_issue_with_title(
        &database.connection,
        project_id,
        "running",
        "Older running issue",
    );
    let newer_session_id = insert_agent_session_row(
        &database.connection,
        newer_running_issue,
        profile_id,
        AgentSessionStatus::Running,
        1_780_628_000_000,
        None,
    );
    AgentSessionRepository::new(&database.connection)
        .update_latest_output(
            newer_session_id,
            "Running pnpm test -- --run agents-activity.test.tsx",
            1_780_628_000_500,
        )
        .expect("update latest output");
    insert_agent_session_row(
        &database.connection,
        older_running_issue,
        profile_id,
        AgentSessionStatus::Running,
        1_780_627_000_000,
        None,
    );

    for index in 0..21 {
        let issue_id = insert_issue_with_title(
            &database.connection,
            project_id,
            "running",
            &format!("Completed issue {index:02}"),
        );
        let closed_at = 1_780_620_000_000 + i64::from(index);
        let last_active_at = if index == 20 { 1 } else { closed_at - 10 };
        let status = if index % 3 == 0 {
            AgentSessionStatus::Closed
        } else if index % 3 == 1 {
            AgentSessionStatus::Crashed
        } else {
            AgentSessionStatus::Stopped
        };
        insert_agent_session_row(
            &database.connection,
            issue_id,
            profile_id,
            status,
            last_active_at,
            Some(closed_at),
        );
    }

    let other_issue = insert_issue_with_title(
        &database.connection,
        other_project_id,
        "running",
        "Other project issue",
    );
    insert_agent_session_row(
        &database.connection,
        other_issue,
        profile_id,
        AgentSessionStatus::Running,
        1_780_629_000_000,
        None,
    );

    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let response = service
        .list_agent_sessions(project_id)
        .expect("list agent sessions");

    assert_eq!(response.sessions.len(), 23);
    assert_eq!(
        response.sessions[0].issue_title.as_deref(),
        Some("Newest running issue")
    );
    assert_eq!(
        response.sessions[0].latest_output.as_deref(),
        Some("Running pnpm test -- --run agents-activity.test.tsx")
    );
    assert_eq!(response.sessions[0].agent_profile_id, profile_id);
    assert_eq!(response.sessions[0].agent_profile_name, "Codex");
    assert_eq!(response.sessions[0].workflow_skill_name, None);
    assert_eq!(
        response.sessions[0].workspace_mode,
        WorkspaceMode::CurrentBranch
    );
    assert_eq!(
        response.sessions[1].issue_title.as_deref(),
        Some("Older running issue")
    );
    assert!(response.sessions[..2]
        .iter()
        .all(|session| session.status == AgentSessionStatus::Running));
    assert!(response.sessions[2..].iter().all(|session| matches!(
        session.status,
        AgentSessionStatus::Closed | AgentSessionStatus::Crashed | AgentSessionStatus::Stopped
    )));
    assert!(response.sessions[2..]
        .iter()
        .any(|session| session.status == AgentSessionStatus::Closed));
    assert!(response.sessions[2..]
        .iter()
        .any(|session| session.status == AgentSessionStatus::Crashed));
    assert!(response.sessions[2..]
        .iter()
        .any(|session| session.status == AgentSessionStatus::Stopped));
    assert_eq!(
        response.sessions[2..]
            .iter()
            .map(|session| session.issue_title.clone())
            .collect::<Vec<_>>(),
        (0..=19)
            .rev()
            .chain(std::iter::once(20))
            .map(|index| Some(format!("Completed issue {index:02}")))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        response.sessions[2].issue_title.as_deref(),
        Some("Completed issue 19")
    );
    assert_eq!(
        response
            .sessions
            .last()
            .and_then(|session| session.issue_title.as_deref()),
        Some("Completed issue 20")
    );
    assert!(response
        .sessions
        .iter()
        .all(|session| session.issue_title.as_deref() != Some("Other project issue")));
    assert!(response
        .sessions
        .iter()
        .all(|session| session.agent_type == AgentType::Codex));
}

#[test]
fn list_agent_sessions_returns_workflow_skill_name_when_present() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "workflow-skill-list-project");
    let issue_id = insert_issue_with_title(
        &database.connection,
        project_id,
        "running",
        "Workflow skill issue",
    );
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let session_id = insert_agent_session_row(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Running,
        1_780_638_900_000,
        None,
    );
    database
        .connection
        .execute(
            "UPDATE agent_sessions SET workflow_skill_name = ?1 WHERE id = ?2",
            rusqlite::params!["bmad-dev-story", session_id],
        )
        .expect("persist workflow skill name");
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let response = service
        .list_agent_sessions(project_id)
        .expect("list agent sessions");

    assert_eq!(response.sessions.len(), 1);
    assert_eq!(response.sessions[0].session_id, session_id);
    assert_eq!(response.sessions[0].agent_profile_name, "Codex");
    assert_eq!(
        response.sessions[0].workflow_skill_name.as_deref(),
        Some("bmad-dev-story")
    );
}

#[test]
fn agent_session_repository_reads_sessions_for_claude_profiles() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "claude-session-project");
    let issue_id =
        insert_issue_with_title(&database.connection, project_id, "running", "Claude issue");
    let profile = AgentProfileRepository::new(&database.connection)
        .save_profile(
            None,
            "Claude",
            AgentType::Claude,
            "/usr/local/bin/claude",
            &AgentScope::Global,
            None,
            "default",
            false,
            "review",
            "",
            "json",
            true,
        )
        .expect("save claude profile");
    insert_agent_session_row(
        &database.connection,
        issue_id,
        profile.id,
        AgentSessionStatus::Running,
        1_780_638_500_000,
        None,
    );

    let sessions = AgentSessionRepository::new(&database.connection)
        .list_by_project_id(project_id)
        .expect("list claude profile sessions");

    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].agent_type, AgentType::Claude);
}

#[test]
fn list_agent_sessions_does_not_project_issue_from_another_project() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let issue_project_id = insert_project(&database.connection, "issue-project");
    let session_project_id = insert_project(&database.connection, "session-project");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let issue_id = insert_issue_with_title(
        &database.connection,
        issue_project_id,
        "running",
        "Leaked issue",
    );
    let session_id = insert_agent_session_row(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Running,
        1_780_638_000_000,
        None,
    );
    database
        .connection
        .execute(
            "UPDATE agent_sessions SET project_id = ?1 WHERE id = ?2",
            rusqlite::params![session_project_id, session_id],
        )
        .expect("desync session project");
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let response = service
        .list_agent_sessions(session_project_id)
        .expect("list agent sessions");

    assert_eq!(response.sessions.len(), 1);
    assert_eq!(response.sessions[0].session_id, session_id);
    assert_eq!(response.sessions[0].issue_id, Some(issue_id));
    assert_eq!(response.sessions[0].issue_title, None);
    assert_eq!(response.sessions[0].issue_status, None);
}

#[test]
fn list_agent_sessions_orders_completed_ties_by_session_id_desc() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "completed-order-project");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let shared_closed_at = 1_780_620_999_999;

    let first_issue = insert_issue_with_title(
        &database.connection,
        project_id,
        "running",
        "First completed issue",
    );
    let first_session_id = insert_agent_session_row(
        &database.connection,
        first_issue,
        profile_id,
        AgentSessionStatus::Closed,
        shared_closed_at - 1,
        Some(shared_closed_at),
    );

    let second_issue = insert_issue_with_title(
        &database.connection,
        project_id,
        "running",
        "Second completed issue",
    );
    let second_session_id = insert_agent_session_row(
        &database.connection,
        second_issue,
        profile_id,
        AgentSessionStatus::Stopped,
        shared_closed_at - 1,
        Some(shared_closed_at),
    );

    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let response = service
        .list_agent_sessions(project_id)
        .expect("list agent sessions");

    assert_eq!(response.sessions.len(), 2);
    assert_eq!(
        response
            .sessions
            .iter()
            .map(|session| session.session_id)
            .collect::<Vec<_>>(),
        vec![second_session_id, first_session_id]
    );
}

#[test]
fn list_agent_sessions_rejects_missing_project() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let error = service
        .list_agent_sessions(404)
        .expect_err("missing project should fail");

    assert_eq!(error.code, CommandErrorCode::ProjectNotFound);
}

#[test]
fn list_agent_sessions_marks_running_session_as_needing_attention_when_log_ends_with_codex_prompt()
{
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "attention-project");
    let issue_id = insert_issue_with_title(
        &database.connection,
        project_id,
        "running",
        "Needs review issue",
    );
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let log_path = temp_dir.path().join("attention.log");
    std::fs::write(
        &log_path,
        "Codex finished the current reply.\n\n› Run /review on my current changes\n",
    )
    .expect("write log");
    let session_id = insert_agent_session_row_with_details(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Running,
        AgentSessionAttention::None,
        1_780_628_111_000,
        None,
        log_path.to_string_lossy().as_ref(),
    );

    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let response = service
        .list_agent_sessions(project_id)
        .expect("list agent sessions");

    assert_eq!(response.sessions.len(), 1);
    assert_eq!(response.sessions[0].session_id, session_id);
    assert_eq!(
        response.sessions[0].attention,
        AgentSessionAttention::Requested
    );

    let refreshed_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find session")
        .expect("session should exist");
    assert_eq!(
        refreshed_session.attention,
        AgentSessionAttention::Requested
    );
}

#[test]
fn set_session_attention_marks_running_session_and_records_manual_request_event() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "manual-attention-project");
    let issue_id = insert_issue(&database.connection, project_id, "running");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let session_id = insert_agent_session_row(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Running,
        1_780_628_333_000,
        None,
    );

    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let result = service
        .set_session_attention(SetAgentSessionAttentionInput {
            project_id,
            session_id,
            attention: AgentSessionAttention::Requested,
        })
        .expect("set attention");

    assert_eq!(result.session_id, session_id);
    assert_eq!(result.attention, AgentSessionAttention::Requested);

    let refreshed_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find session")
        .expect("session should exist");
    assert_eq!(
        refreshed_session.attention,
        AgentSessionAttention::Requested
    );

    let issue_response = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    )
    .list_issues(project_id)
    .expect("list issues");
    assert_eq!(issue_response.issues.len(), 1);
    assert_eq!(
        issue_response.issues[0].linked_session_attention,
        Some(AgentSessionAttention::Requested)
    );

    let session_events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert_eq!(session_events.len(), 1);
    assert_eq!(
        session_events[0].event_type,
        SessionEventType::SessionAttentionRequested
    );

    let payload: Value =
        serde_json::from_str(&session_events[0].payload_json).expect("parse payload");
    assert_eq!(payload["sessionId"].as_i64(), Some(session_id));
    assert_eq!(payload["issueId"].as_i64(), Some(issue_id));
    assert_eq!(payload["attention"].as_str(), Some("requested"));
    assert_eq!(payload["trigger"].as_str(), Some("manual"));
}

#[test]
fn list_agent_sessions_prunes_broken_structured_standalone_sessions() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "standalone-prune-project");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let broken_session_id = insert_standalone_agent_session_row(
        &database.connection,
        project_id,
        profile_id,
        AgentSessionStatus::Stopped,
        AgentSessionAttention::None,
        1_780_628_440_000,
        Some(1_780_628_441_000),
        "/tmp/structured-project-1-pid-123-1780628440000.jsonl",
    );
    let valid_session_id = insert_standalone_agent_session_row(
        &database.connection,
        project_id,
        profile_id,
        AgentSessionStatus::Stopped,
        AgentSessionAttention::None,
        1_780_628_442_000,
        Some(1_780_628_443_000),
        "/tmp/structured-project-1-pid-123-1780628442000.jsonl",
    );
    database
        .connection
        .execute(
            "UPDATE agent_sessions SET provider_session_id = 'thread-valid' WHERE id = ?1",
            rusqlite::params![valid_session_id],
        )
        .expect("set valid session thread id");

    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let response = service
        .list_agent_sessions(project_id)
        .expect("list sessions should succeed");

    assert_eq!(response.sessions.len(), 1);
    assert_eq!(response.sessions[0].session_id, valid_session_id);

    let broken_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(broken_session_id)
        .expect("find broken session");
    assert!(broken_session.is_none());
}

#[test]
fn list_agent_sessions_runtime_result_reports_pruned_session_ids() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "standalone-runtime-prune-project");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let broken_session_id = insert_standalone_agent_session_row(
        &database.connection,
        project_id,
        profile_id,
        AgentSessionStatus::Stopped,
        AgentSessionAttention::None,
        1_780_628_440_000,
        Some(1_780_628_441_000),
        "/tmp/structured-project-1-pid-456-1780628440000.jsonl",
    );

    let agent_registry = AgentSessionRegistry::new();
    agent_registry.register(broken_session_id, Arc::new(NoopStructuredHandle));

    let result = AgentSessionService::list_agent_sessions_in_data_dir(
        temp_dir.path(),
        project_id,
        &PtySessionManager::new(),
        &agent_registry,
    )
    .expect("list sessions should succeed");

    assert!(result.response.sessions.is_empty());
    assert_eq!(result.pruned_runtime_session_ids, vec![broken_session_id]);
}

#[test]
fn set_session_attention_clears_requested_attention_and_records_manual_clear_event() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "manual-clear-project");
    let issue_id = insert_issue(&database.connection, project_id, "running");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let session_id = insert_agent_session_row_with_details(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Running,
        AgentSessionAttention::Requested,
        1_780_628_444_000,
        None,
        "/tmp/manual-clear.log",
    );

    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let result = service
        .set_session_attention(SetAgentSessionAttentionInput {
            project_id,
            session_id,
            attention: AgentSessionAttention::None,
        })
        .expect("clear attention");

    assert_eq!(result.session_id, session_id);
    assert_eq!(result.attention, AgentSessionAttention::None);

    let refreshed_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find session")
        .expect("session should exist");
    assert_eq!(refreshed_session.attention, AgentSessionAttention::None);

    let issue_response = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    )
    .list_issues(project_id)
    .expect("list issues");
    assert_eq!(issue_response.issues.len(), 1);
    assert_eq!(
        issue_response.issues[0].linked_session_attention,
        Some(AgentSessionAttention::None)
    );

    let session_events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert_eq!(session_events.len(), 1);
    assert_eq!(
        session_events[0].event_type,
        SessionEventType::SessionAttentionCleared
    );

    let payload: Value =
        serde_json::from_str(&session_events[0].payload_json).expect("parse payload");
    assert_eq!(payload["sessionId"].as_i64(), Some(session_id));
    assert_eq!(payload["issueId"].as_i64(), Some(issue_id));
    assert_eq!(payload["attention"].as_str(), Some("none"));
    assert_eq!(payload["trigger"].as_str(), Some("manual"));
}

#[test]
fn reconcile_unrecoverable_running_sessions_marks_session_stopped_and_records_restart_reason() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "restart-reconcile-project");
    let issue_id = insert_issue(&database.connection, project_id, "running");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let session_id = insert_agent_session_row_with_details(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Running,
        AgentSessionAttention::None,
        1_780_628_555_000,
        None,
        "/tmp/restart-reconcile.log",
    );
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );
    let manager = PtySessionManager::new();

    service
        .reconcile_unrecoverable_running_sessions(
            project_id,
            &manager,
            &AgentSessionRegistry::new(),
        )
        .expect("reconcile running sessions");

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find session")
        .expect("session exists");
    assert_eq!(session.status, AgentSessionStatus::Stopped);
    assert!(session.closed_at.is_some());

    let issue = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    )
    .list_issues(project_id)
    .expect("list issues")
    .issues
    .into_iter()
    .find(|candidate| candidate.id == issue_id)
    .expect("linked issue exists");
    assert_eq!(issue.status, IssueStatus::Running);
    assert_eq!(
        issue.linked_session_status,
        Some(AgentSessionStatus::Stopped)
    );

    let events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("list session events");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, SessionEventType::SessionExited);

    let payload: Value = serde_json::from_str(&events[0].payload_json).expect("parse payload");
    assert_eq!(payload["sessionId"].as_i64(), Some(session_id));
    assert_eq!(payload["issueId"].as_i64(), Some(issue_id));
    assert_eq!(payload["status"].as_str(), Some("stopped"));
    assert!(payload["exitCode"].is_null());
    assert_eq!(
        payload["reason"].as_str(),
        Some("app_restarted_no_active_pty")
    );
    assert_eq!(
        payload["logPath"].as_str(),
        Some("/tmp/restart-reconcile.log")
    );
}

#[test]
fn reconcile_unrecoverable_running_sessions_keeps_registered_structured_session_running() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "structured-restart-reconcile-project");
    let issue_id = insert_issue(&database.connection, project_id, "running");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let session_id = insert_agent_session_row_with_details(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Running,
        AgentSessionAttention::None,
        1_780_628_555_000,
        None,
        "/tmp/structured-restart-reconcile.log",
    );
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );
    let manager = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let handle: Arc<dyn AgentSessionHandle> = Arc::new(NoopStructuredHandle);
    registry.register(session_id, handle);

    service
        .reconcile_unrecoverable_running_sessions(project_id, &manager, &registry)
        .expect("reconcile running sessions");

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find session")
        .expect("session exists");
    assert_eq!(session.status, AgentSessionStatus::Running);
    assert!(session.closed_at.is_none());
}

#[test]
fn set_session_attention_rejects_non_running_session() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "manual-invalid-project");
    let issue_id = insert_issue(&database.connection, project_id, "running");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let session_id = insert_agent_session_row(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Closed,
        1_780_628_555_000,
        Some(1_780_628_556_000),
    );

    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let error = service
        .set_session_attention(SetAgentSessionAttentionInput {
            project_id,
            session_id,
            attention: AgentSessionAttention::Requested,
        })
        .expect_err("closed session should be rejected");

    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(
        error.message,
        "只有运行中的 Agent Session 可以更新关注状态。"
    );
}

#[test]
fn resume_agent_session_rejects_completed_issue() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "resume-completed-project");
    let issue_id = insert_issue(&database.connection, project_id, "completed");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let session_id = insert_agent_session_row(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Closed,
        1_780_628_555_000,
        Some(1_780_628_556_000),
    );
    database
        .connection
        .execute(
            "UPDATE agent_sessions SET provider_session_id = 'thread-completed' WHERE id = ?1",
            rusqlite::params![session_id],
        )
        .expect("set codex session id");

    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );
    let registry = AgentSessionRegistry::new();
    let broadcaster = redwhisk_lib::agent::agent_event_broadcaster::AgentEventBroadcaster::new();
    let pty = redwhisk_lib::agent::pty_session_manager::PtySessionManager::new();

    let error = service
        .resume_agent_session(
            temp_dir.path(),
            ResumeAgentSessionInput {
                project_id,
                session_id,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect_err("completed issue session should not resume");

    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(error.message, "已完成 Issue 的 Session 不能继续运行。");
    assert_eq!(
        error.reason.as_deref(),
        Some("completedIssueSessionCannotRun")
    );
}

#[test]
fn mark_session_running_reopens_existing_session_record() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "resume-record-project");
    let issue_id = insert_issue(&database.connection, project_id, "review");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let session_id = insert_agent_session_row(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Closed,
        1_780_628_555_000,
        Some(1_780_628_556_000),
    );

    let transaction = database
        .connection
        .unchecked_transaction()
        .expect("transaction");
    let reopened = AgentSessionRepository::mark_running_in_transaction(
        &transaction,
        session_id,
        1_780_628_557_000,
    )
    .expect("mark running")
    .expect("session reopened");
    transaction.commit().expect("commit");

    assert_eq!(reopened.id, session_id);
    assert_eq!(reopened.status, AgentSessionStatus::Running);
    assert_eq!(reopened.closed_at, None);
    assert_eq!(reopened.last_active_at, 1_780_628_557_000);

    let count: i64 = database
        .connection
        .query_row(
            "SELECT COUNT(*) FROM agent_sessions WHERE issue_id = ?1 AND del = 0",
            rusqlite::params![issue_id],
            |row| row.get(0),
        )
        .expect("count sessions");
    assert_eq!(count, 1);
}

#[test]
fn record_session_termination_marks_zero_exit_as_closed_and_persists_event() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "termination-closed-project");
    let issue_id = insert_issue(&database.connection, project_id, "running");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let session_id = insert_agent_session_row(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Running,
        1_780_628_400_000,
        None,
    );

    AgentSessionService::record_session_termination_in_data_dir(
        temp_dir.path(),
        session_id,
        PtyExitStatus { exit_code: Some(0) },
    )
    .expect("record termination");

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find session")
        .expect("session should exist");
    assert_eq!(session.status, AgentSessionStatus::Closed);
    assert!(session.closed_at.is_some());

    let session_events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert_eq!(session_events.len(), 1);
    assert_eq!(
        session_events[0].event_type,
        SessionEventType::SessionExited
    );

    let payload: Value =
        serde_json::from_str(&session_events[0].payload_json).expect("parse payload");
    assert_eq!(payload["sessionId"].as_i64(), Some(session_id));
    assert_eq!(payload["issueId"].as_i64(), Some(issue_id));
    assert_eq!(payload["status"].as_str(), Some("closed"));
    assert_eq!(payload["exitCode"].as_i64(), Some(0));
    assert_eq!(payload["reason"].as_str(), Some("process_exited"));
    assert_eq!(payload["logPath"].as_str(), Some("/tmp/log"));
}

#[test]
fn record_session_termination_for_standalone_session_keeps_issue_state_unchanged() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "standalone-termination-project");
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let session_id = insert_standalone_agent_session_row(
        &database.connection,
        project_id,
        profile_id,
        AgentSessionStatus::Running,
        AgentSessionAttention::None,
        1_780_628_400_000,
        None,
        "/tmp/standalone-log",
    );

    AgentSessionService::record_session_termination_in_data_dir(
        temp_dir.path(),
        session_id,
        PtyExitStatus { exit_code: Some(0) },
    )
    .expect("record standalone termination");

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find session")
        .expect("session should exist");
    assert_eq!(session.status, AgentSessionStatus::Closed);
    assert_eq!(session.issue_id, None);
    assert!(session.closed_at.is_some());

    let issue_response = IssueService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
    )
    .list_issues(project_id)
    .expect("list issues");
    assert_eq!(issue_response.issues.len(), 1);
    assert_eq!(issue_response.issues[0].id, issue_id);
    assert_eq!(issue_response.issues[0].status, IssueStatus::Backlog);
    assert_eq!(issue_response.issues[0].linked_session_id, None);
    assert_eq!(issue_response.issues[0].linked_session_status, None);
    assert_eq!(issue_response.issues[0].linked_session_attention, None);

    let issue_actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue_id)
        .expect("issue actions");
    assert_eq!(issue_actions.len(), 1);
    assert_eq!(issue_actions[0].action_type, IssueActionType::IssueCreated);

    let session_events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert_eq!(session_events.len(), 1);
    assert_eq!(
        session_events[0].event_type,
        SessionEventType::SessionExited
    );

    let payload: Value =
        serde_json::from_str(&session_events[0].payload_json).expect("parse payload");
    assert_eq!(payload["status"].as_str(), Some("closed"));
    assert_eq!(payload["exitCode"].as_i64(), Some(0));
    assert!(payload["issueId"].is_null());
    assert_eq!(payload["logPath"].as_str(), Some("/tmp/standalone-log"));
}

#[test]
fn record_session_termination_marks_non_zero_exit_as_crashed_and_is_idempotent() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "termination-crashed-project");
    let issue_id = insert_issue(&database.connection, project_id, "running");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let session_id = insert_agent_session_row(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Running,
        1_780_628_500_000,
        None,
    );

    AgentSessionService::record_session_termination_in_data_dir(
        temp_dir.path(),
        session_id,
        PtyExitStatus { exit_code: Some(7) },
    )
    .expect("record first termination");
    AgentSessionService::record_session_termination_in_data_dir(
        temp_dir.path(),
        session_id,
        PtyExitStatus { exit_code: Some(9) },
    )
    .expect("record duplicate termination");

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find session")
        .expect("session should exist");
    assert_eq!(session.status, AgentSessionStatus::Crashed);
    assert!(session.closed_at.is_some());

    let issue = IssueRepository::new(&database.connection)
        .find_by_id(issue_id)
        .expect("find issue")
        .expect("issue should exist");
    assert_eq!(issue.status, IssueStatus::Running);

    let session_events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert_eq!(session_events.len(), 1);
    assert_eq!(
        session_events[0].event_type,
        SessionEventType::SessionExited
    );

    let payload: Value =
        serde_json::from_str(&session_events[0].payload_json).expect("parse payload");
    assert_eq!(payload["status"].as_str(), Some("crashed"));
    assert_eq!(payload["exitCode"].as_i64(), Some(7));
    assert_eq!(payload["reason"].as_str(), Some("non_zero_exit_code"));
}

#[test]
fn pty_session_manager_forwards_input_resizes_and_persists_output() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let command = echo_stdin_command(temp_dir.path());
    let log_path = temp_dir.path().join("pty-session.log");
    let manager = PtySessionManager::new();

    let pending = manager
        .spawn_pending(&PtySpawnRequest {
            mode: PtyCommandMode::ExecReplace,
            command: command.to_string_lossy().to_string(),
            working_dir: temp_dir.path().to_string_lossy().to_string(),
            log_path: log_path.to_string_lossy().to_string(),
            initial_prompt: None,
            rows: 24,
            cols: 80,
            startup_check_total_ms: 500,
            startup_check_interval_ms: 25,
        })
        .expect("spawn pending pty");
    manager
        .register(77, pending, |_| {})
        .expect("register session");

    manager
        .write_input(77, "hello from pty\r")
        .expect("write input");
    manager.resize(77, 32, 120).expect("resize");

    let mut snapshot = String::new();
    for _ in 0..20 {
        std::thread::sleep(std::time::Duration::from_millis(50));
        let _ = manager.flush_log(77);
        snapshot = read_terminal_snapshot(&log_path, 8_192).expect("read snapshot");
        if snapshot.contains("hello from pty") {
            break;
        }
    }

    assert!(snapshot.contains("hello from pty"));
    manager.kill(77).expect("kill session");
}

#[test]
fn pty_session_manager_broadcasts_output_bytes_while_persisting_log() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let command = echo_stdin_command(temp_dir.path());
    let log_path = temp_dir.path().join("pty-session-output-event.log");
    let manager = PtySessionManager::new();
    let (sender, receiver) = std::sync::mpsc::channel();
    manager.set_output_sink(move |event| {
        let _ = sender.send(event);
    });

    let pending = manager
        .spawn_pending(&PtySpawnRequest {
            mode: PtyCommandMode::ExecReplace,
            command: command.to_string_lossy().to_string(),
            working_dir: temp_dir.path().to_string_lossy().to_string(),
            log_path: log_path.to_string_lossy().to_string(),
            initial_prompt: None,
            rows: 24,
            cols: 80,
            startup_check_total_ms: 500,
            startup_check_interval_ms: 25,
        })
        .expect("spawn pending pty");
    manager
        .register_for_project(42, 77, pending, |_| {})
        .expect("register project session");
    manager.add_output_subscriber(77);

    manager
        .write_input(77, "hello event stream\r")
        .expect("write input");

    let mut events = Vec::new();
    let mut snapshot = String::new();
    for _ in 0..40 {
        if let Ok(event) = receiver.recv_timeout(std::time::Duration::from_millis(50)) {
            events.push(event);
        }
        let _ = manager.flush_log(77);
        snapshot = read_terminal_snapshot(&log_path, 8_192).expect("read snapshot");
        if snapshot.contains("hello event stream")
            && events.iter().any(|event| {
                event
                    .data
                    .windows("hello".len())
                    .any(|chunk| chunk == b"hello")
            })
        {
            break;
        }
    }

    assert!(snapshot.contains("hello event stream"));
    assert!(events.iter().any(|event| {
        event.project_id == 42
            && event.session_id == 77
            && event.sequence > 0
            && !event.data.is_empty()
    }));
    manager.kill(77).expect("kill session");
}

#[test]
fn pty_session_manager_restores_complete_output_chunks_for_active_session() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let command = echo_stdin_command(temp_dir.path());
    let log_path = temp_dir.path().join("pty-session-restore.log");
    let manager = PtySessionManager::new();
    let pending = manager
        .spawn_pending(&PtySpawnRequest {
            mode: PtyCommandMode::ExecReplace,
            command: command.to_string_lossy().to_string(),
            working_dir: temp_dir.path().to_string_lossy().to_string(),
            log_path: log_path.to_string_lossy().to_string(),
            initial_prompt: None,
            rows: 24,
            cols: 80,
            startup_check_total_ms: 500,
            startup_check_interval_ms: 25,
        })
        .expect("spawn pending pty");
    manager
        .register_for_project(42, 77, pending, |_| {})
        .expect("register project session");

    manager
        .write_input(77, "restore me\r")
        .expect("write input");

    let mut snapshot = manager.restore_snapshot(77).expect("restore snapshot");
    for _ in 0..20 {
        if snapshot.chunks.iter().any(|chunk| {
            chunk
                .windows("restore".len())
                .any(|data| data == b"restore")
        }) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
        snapshot = manager.restore_snapshot(77).expect("restore snapshot");
    }

    assert!(snapshot.is_complete);
    assert!(snapshot.sequence > 0);
    assert!(snapshot.chunks.iter().any(|chunk| chunk
        .windows("restore".len())
        .any(|data| data == b"restore")));
    manager.kill(77).expect("kill session");
}

#[test]
fn inject_session_prompt_records_event_and_writes_into_running_terminal() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "inject-prompt-project");
    let issue_id = insert_issue(&database.connection, project_id, "running");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let session_id = insert_agent_session_row(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Running,
        1_780_628_600_000,
        None,
    );
    database
        .connection
        .execute(
            "UPDATE agent_sessions SET display_mode = 'tui' WHERE id = ?1",
            rusqlite::params![session_id],
        )
        .expect("set tui display mode");

    let command = echo_stdin_command(temp_dir.path());
    let log_path = temp_dir.path().join("inject-prompt.log");
    let manager = PtySessionManager::new();
    let pending = manager
        .spawn_pending(&PtySpawnRequest {
            mode: PtyCommandMode::ExecReplace,
            command: command.to_string_lossy().to_string(),
            working_dir: temp_dir.path().to_string_lossy().to_string(),
            log_path: log_path.to_string_lossy().to_string(),
            initial_prompt: None,
            rows: 24,
            cols: 80,
            startup_check_total_ms: 500,
            startup_check_interval_ms: 25,
        })
        .expect("spawn pending pty");
    manager
        .register(session_id, pending, |_| {})
        .expect("register session");

    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let result = service
        .inject_session_prompt(
            InjectAgentSessionPromptInput {
                project_id,
                session_id,
                prompt: "please continue".to_string(),
                kind: AgentSessionPromptKind::FollowUp,
            },
            &manager,
            &AgentSessionRegistry::new(),
        )
        .expect("inject prompt");

    assert_eq!(result.session_id, session_id);
    assert_eq!(result.provider_session_id, None);

    let mut snapshot = String::new();
    for _ in 0..20 {
        std::thread::sleep(std::time::Duration::from_millis(50));
        let _ = manager.flush_log(session_id);
        snapshot = read_terminal_snapshot(&log_path, 8_192).expect("read snapshot");
        if snapshot.contains("please continue") {
            break;
        }
    }

    assert!(snapshot.contains("please continue"));

    let session_events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert_eq!(session_events.len(), 1);
    assert_eq!(
        session_events[0].event_type,
        SessionEventType::SessionPromptInjected
    );

    let payload: Value =
        serde_json::from_str(&session_events[0].payload_json).expect("parse payload");
    assert_eq!(payload["sessionId"].as_i64(), Some(session_id));
    assert_eq!(payload["issueId"].as_i64(), Some(issue_id));
    assert_eq!(payload["kind"].as_str(), Some("follow_up"));
    assert_eq!(payload["prompt"].as_str(), Some("please continue"));
    assert_eq!(payload["submitted"].as_bool(), Some(true));

    manager.kill(session_id).expect("kill session");
}

#[test]
fn inject_session_prompt_keeps_review_issue_in_same_session_and_log() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "review-prompt-project");
    let issue_id = insert_issue(&database.connection, project_id, "review");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let log_path = temp_dir.path().join("review-prompt.log");
    std::fs::write(&log_path, "review log header\n").expect("write log");
    let session_id = insert_agent_session_row_with_details(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Running,
        AgentSessionAttention::None,
        1_780_628_600_000,
        None,
        log_path.to_string_lossy().as_ref(),
    );
    database
        .connection
        .execute(
            "UPDATE agent_sessions SET display_mode = 'tui' WHERE id = ?1",
            rusqlite::params![session_id],
        )
        .expect("set tui display mode");

    let command = echo_stdin_command(temp_dir.path());
    let manager = PtySessionManager::new();
    let pending = manager
        .spawn_pending(&PtySpawnRequest {
            mode: PtyCommandMode::ExecReplace,
            command: command.to_string_lossy().to_string(),
            working_dir: temp_dir.path().to_string_lossy().to_string(),
            log_path: log_path.to_string_lossy().to_string(),
            initial_prompt: None,
            rows: 24,
            cols: 80,
            startup_check_total_ms: 500,
            startup_check_interval_ms: 25,
        })
        .expect("spawn pending pty");
    manager
        .register(session_id, pending, |_| {})
        .expect("register session");

    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );
    let issue_action_count_before = EventRepository::new(&database.connection)
        .list_issue_actions(issue_id)
        .expect("issue actions before inject")
        .len();

    let result = service
        .inject_session_prompt(
            InjectAgentSessionPromptInput {
                project_id,
                session_id,
                prompt: "apply the requested fixes".to_string(),
                kind: AgentSessionPromptKind::FollowUp,
            },
            &manager,
            &AgentSessionRegistry::new(),
        )
        .expect("inject review prompt");

    assert_eq!(result.session_id, session_id);
    assert_eq!(result.provider_session_id, None);

    let issue = IssueRepository::new(&database.connection)
        .find_by_id(issue_id)
        .expect("find issue")
        .expect("issue should exist");
    assert_eq!(issue.status, IssueStatus::Review);

    let sessions = AgentSessionRepository::new(&database.connection)
        .list_by_project_id(project_id)
        .expect("list sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_id, session_id);

    let refreshed_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find session")
        .expect("session should exist");
    assert_eq!(refreshed_session.log_path, log_path.to_string_lossy());

    let mut snapshot = String::new();
    for _ in 0..20 {
        std::thread::sleep(std::time::Duration::from_millis(50));
        let _ = manager.flush_log(session_id);
        snapshot = read_terminal_snapshot(&log_path, 8_192).expect("read snapshot");
        if snapshot.contains("apply the requested fixes") {
            break;
        }
    }

    assert!(snapshot.contains("apply the requested fixes"));

    let session_events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert_eq!(session_events.len(), 1);
    assert_eq!(
        session_events[0].event_type,
        SessionEventType::SessionPromptInjected
    );

    let payload: Value =
        serde_json::from_str(&session_events[0].payload_json).expect("parse payload");
    assert_eq!(payload["sessionId"].as_i64(), Some(session_id));
    assert_eq!(payload["issueId"].as_i64(), Some(issue_id));
    assert_eq!(payload["kind"].as_str(), Some("follow_up"));
    assert_eq!(
        payload["prompt"].as_str(),
        Some("apply the requested fixes")
    );

    let issue_actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue_id)
        .expect("issue actions");
    assert_eq!(issue_actions.len(), issue_action_count_before);

    manager.kill(session_id).expect("kill session");
}

#[test]
fn inject_session_prompt_sends_message_via_agent_registry_for_structured_session() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "structured-prompt-project");
    let issue_id = insert_issue(&database.connection, project_id, "review");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let session_id = insert_agent_session_row(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Running,
        1_780_628_600_000,
        None,
    );

    // Structured session 不在 pty_sessions，只在 agent_registry 注册 handle。
    let manager = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let handle: Arc<dyn AgentSessionHandle> = Arc::new(RecordingStructuredHandle::default());
    registry.register(session_id, handle);

    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let result = service
        .inject_session_prompt(
            InjectAgentSessionPromptInput {
                project_id,
                session_id,
                prompt: "resolve conflicts".to_string(),
                kind: AgentSessionPromptKind::FollowUp,
            },
            &manager,
            &registry,
        )
        .expect("inject structured prompt");

    assert_eq!(result.session_id, session_id);

    let events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0].event_type,
        SessionEventType::SessionPromptInjected,
    );

    let payload: Value = serde_json::from_str(&events[0].payload_json).expect("parse payload");
    assert_eq!(payload["prompt"].as_str(), Some("resolve conflicts"));
}

#[test]
fn inject_session_prompt_returns_not_running_when_no_active_channel() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "idle-prompt-project");
    let issue_id = insert_issue(&database.connection, project_id, "review");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let session_id = insert_agent_session_row(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Closed,
        1_780_628_600_000,
        None,
    );

    // 既无 pty 也无 registry handle：典型场景是 worktree session 已关闭。
    let manager = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    let error = service
        .inject_session_prompt(
            InjectAgentSessionPromptInput {
                project_id,
                session_id,
                prompt: "follow up".to_string(),
                kind: AgentSessionPromptKind::FollowUp,
            },
            &manager,
            &registry,
        )
        .expect_err("expected AgentSessionNotRunning");

    assert_eq!(error.code, CommandErrorCode::AgentSessionNotRunning);

    // 没有任何 prompt 注入事件被记录。
    let events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert!(events.is_empty());
}

#[derive(Default, Clone)]
struct RecordingStructuredHandle {
    sent: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
}

impl AgentSessionHandle for RecordingStructuredHandle {
    fn send_message(
        &self,
        text: String,
        _attachments: Vec<AgentMessageAttachment>,
    ) -> Result<(), AgentSessionError> {
        self.sent.lock().expect("lock").push(text);
        Ok(())
    }

    fn cancel_turn(&self) -> Result<(), AgentSessionError> {
        Ok(())
    }

    fn respond_permission(
        &self,
        _request_id: &str,
        _decision: AgentPermissionDecision,
    ) -> Result<(), AgentSessionError> {
        Ok(())
    }

    fn set_model(&self, _model_id: String) -> Result<(), AgentSessionError> {
        Ok(())
    }

    fn set_effort(&self, _effort: Option<String>) -> Result<(), AgentSessionError> {
        Ok(())
    }

    fn set_mode(&self, _mode_id: &str) -> Result<(), AgentSessionError> {
        Ok(())
    }

    fn list_models(&self) -> Result<Vec<AgentModel>, AgentSessionError> {
        Ok(Vec::new())
    }

    fn list_modes(&self) -> Vec<AgentMode> {
        Vec::new()
    }

    fn read_timeline(&self) -> Result<Vec<AgentTimelineItem>, AgentSessionError> {
        Ok(Vec::new())
    }

    fn shutdown(&self) {}

    fn thread_id(&self) -> Option<String> {
        Some("thread-recording".to_string())
    }
}

fn migrated_database(data_dir: &std::path::Path) -> redwhisk_lib::db::connection::Database {
    let database = DatabaseConfig::new(data_dir).open().expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    database
}

fn insert_project(connection: &rusqlite::Connection, repo_name: &str) -> i64 {
    let repo_dir = std::env::temp_dir().join(format!(
        "{repo_name}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time")
            .as_nanos()
    ));
    std::fs::create_dir_all(&repo_dir).expect("create repo dir");
    init_repo(&repo_dir);
    connection
        .execute(
            "INSERT INTO projects (name, repo_path, created_at, last_opened_at)
             VALUES (?1, ?2, 1780624800000, 1780624800000)",
            rusqlite::params![repo_name, repo_dir.to_string_lossy().to_string()],
        )
        .expect("insert project");
    connection.last_insert_rowid()
}

fn insert_issue(connection: &rusqlite::Connection, project_id: i64, status: &str) -> i64 {
    insert_issue_with_title(connection, project_id, status, "Issue title")
}

fn insert_issue_with_title(
    connection: &rusqlite::Connection,
    project_id: i64,
    status: &str,
    title: &str,
) -> i64 {
    let service = redwhisk_lib::features::issue::IssueService::new(
        IssueRepository::new(connection),
        ProjectRepository::new(connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: title.to_string(),
            description: "Issue description".to_string(),
            attachments: Vec::new(),
            label_ids: Vec::new(),
        })
        .expect("create issue");

    connection
        .execute(
            "UPDATE issues SET status = ?1 WHERE id = ?2",
            rusqlite::params![status, issue.id],
        )
        .expect("update issue status");

    issue.id
}

fn insert_agent_session_row(
    connection: &rusqlite::Connection,
    issue_id: i64,
    agent_profile_id: i64,
    status: AgentSessionStatus,
    last_active_at: i64,
    closed_at: Option<i64>,
) -> i64 {
    insert_agent_session_row_with_details(
        connection,
        issue_id,
        agent_profile_id,
        status,
        AgentSessionAttention::None,
        last_active_at,
        closed_at,
        "/tmp/log",
    )
}

fn insert_agent_session_row_with_details(
    connection: &rusqlite::Connection,
    issue_id: i64,
    agent_profile_id: i64,
    status: AgentSessionStatus,
    attention: AgentSessionAttention,
    last_active_at: i64,
    closed_at: Option<i64>,
    log_path: &str,
) -> i64 {
    let project_id: i64 = connection
        .query_row(
            "SELECT project_id FROM issues WHERE id = ?1",
            rusqlite::params![issue_id],
            |row| row.get(0),
        )
        .expect("project id for issue");

    connection
        .execute(
            "INSERT INTO agent_sessions (
                project_id,
                number,
                issue_id,
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
            ) VALUES (?1, (SELECT COALESCE(MAX(number), 0) + 1 FROM agent_sessions WHERE project_id = ?1), ?2, ?3, ?4, ?5, '/tmp/repo', 'codex', 'prompt', ?6, ?7, ?7, ?8)",
            rusqlite::params![
                project_id,
                issue_id,
                agent_profile_id,
                agent_session_status_str(&status),
                agent_session_attention_str(&attention),
                log_path,
                last_active_at,
                closed_at,
            ],
        )
        .expect("insert agent session row");
    connection.last_insert_rowid()
}

fn insert_standalone_agent_session_row(
    connection: &rusqlite::Connection,
    project_id: i64,
    agent_profile_id: i64,
    status: AgentSessionStatus,
    attention: AgentSessionAttention,
    last_active_at: i64,
    closed_at: Option<i64>,
    log_path: &str,
) -> i64 {
    connection
        .execute(
            "INSERT INTO agent_sessions (
                project_id,
                number,
                issue_id,
                title,
                agent_profile_id,
                status,
                attention,
                working_dir,
                command_snapshot,
                prompt_snapshot,
                workspace_mode,
                target_branch,
                workspace_branch,
                workspace_path,
                worktree_root_path,
                log_path,
                last_active_at,
                started_at,
                closed_at
            ) VALUES (?1, (SELECT COALESCE(MAX(number), 0) + 1 FROM agent_sessions WHERE project_id = ?1), NULL, 'Standalone Session', ?2, ?3, ?4, '/tmp/repo', 'codex', 'prompt', 'current_branch', NULL, NULL, '/tmp/repo', NULL, ?5, ?6, ?6, ?7)",
            rusqlite::params![
                project_id,
                agent_profile_id,
                agent_session_status_str(&status),
                agent_session_attention_str(&attention),
                log_path,
                last_active_at,
                closed_at,
            ],
        )
        .expect("insert standalone agent session row");
    connection.last_insert_rowid()
}

fn insert_agent_profile(
    connection: &rusqlite::Connection,
    scope: AgentScope,
    project_id: Option<i64>,
) -> i64 {
    insert_agent_profile_with_command(connection, scope, project_id, "/usr/local/bin/codex")
}

fn insert_agent_profile_with_command(
    connection: &rusqlite::Connection,
    scope: AgentScope,
    project_id: Option<i64>,
    command: &str,
) -> i64 {
    let repository = AgentProfileRepository::new(connection);
    let profile = repository
        .save_profile(
            None,
            "Codex",
            AgentType::Codex,
            command,
            &scope,
            project_id,
            "full-auto",
            true,
            "bmad-dev-story",
            "",
            "json",
            true,
        )
        .expect("save profile");
    profile.id
}

fn success_command(base_dir: &std::path::Path) -> std::path::PathBuf {
    let path = base_dir.join("success-agent.sh");
    std::fs::write(&path, "#!/bin/sh\nsleep 1\n").expect("write success script");
    set_executable(&path);
    path
}

fn init_repo(path: &std::path::Path) {
    git(path, &["init", "-b", "main"]);
    git(path, &["config", "user.name", "RedWhisk Test"]);
    git(path, &["config", "user.email", "redwhisk@example.test"]);
    std::fs::write(path.join(".gitignore"), "target/\n").expect("write gitignore");
    git(path, &["add", ".gitignore"]);
    git(path, &["commit", "-m", "initial"]);
}

fn git(repo: &std::path::Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .args(args)
        .current_dir(repo)
        .status()
        .expect("run git");
    assert!(
        status.success(),
        "git command failed: git {}",
        args.join(" ")
    );
}

fn echo_stdin_command(base_dir: &std::path::Path) -> std::path::PathBuf {
    let path = base_dir.join("echo-stdin.sh");
    // Codex TUI 首条 prompt 以 trailing argv 注入；stdin 路径用于 inject / 自定义 binary。
    // 同时回显参数与 stdin，便于两类路径的集成断言。
    std::fs::write(
        &path,
        "#!/bin/sh\nfor arg in \"$@\"; do printf '%s\\n' \"$arg\"; done\ncat\n",
    )
    .expect("write echo stdin script");
    set_executable(&path);
    path
}
fn set_executable(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = std::fs::metadata(path).expect("metadata").permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(path, permissions).expect("set permissions");
}

fn agent_session_status_str(status: &AgentSessionStatus) -> &'static str {
    match status {
        AgentSessionStatus::Running => "running",
        AgentSessionStatus::Closed => "closed",
        AgentSessionStatus::Crashed => "crashed",
        AgentSessionStatus::Stopped => "stopped",
    }
}

fn agent_session_attention_str(attention: &AgentSessionAttention) -> &'static str {
    match attention {
        AgentSessionAttention::None => "none",
        AgentSessionAttention::Requested => "requested",
    }
}

fn table_columns(connection: &rusqlite::Connection, table_name: &str) -> Vec<String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table_name})"))
        .expect("table info");

    statement
        .query_map([], |row| row.get::<_, String>(1))
        .expect("query columns")
        .collect::<rusqlite::Result<Vec<_>>>()
        .expect("collect columns")
}
