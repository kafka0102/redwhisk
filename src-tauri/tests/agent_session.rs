use redwhisk_lib::agent::pty_session_manager::{
    read_terminal_snapshot, PtyExitStatus, PtySessionManager, PtySpawnRequest,
};
use redwhisk_lib::core::agent_session_service::AgentSessionService;
use redwhisk_lib::core::issue_service::IssueService;
use redwhisk_lib::db::agent_profile_repository::AgentProfileRepository;
use redwhisk_lib::db::agent_session_repository::AgentSessionRepository;
use redwhisk_lib::db::connection::DatabaseConfig;
use redwhisk_lib::db::event_repository::EventRepository;
use redwhisk_lib::db::issue_repository::IssueRepository;
use redwhisk_lib::db::migrations::MigrationRunner;
use redwhisk_lib::db::project_repository::ProjectRepository;
use redwhisk_lib::types::agent_profile::{AgentScope, AgentType};
use redwhisk_lib::types::agent_session::{
    AgentSessionAttention, AgentSessionPromptKind, AgentSessionStatus,
    InjectAgentSessionPromptInput, RestoreAgentSessionTerminalInput, SetAgentSessionAttentionInput,
    StartAgentSessionInput, StartStandaloneAgentSessionInput,
};
use redwhisk_lib::types::errors::CommandErrorCode;
use redwhisk_lib::types::issue::IssueStatus;
use redwhisk_lib::types::issue::{CompleteIssueManualInput, CreateIssueInput};
use redwhisk_lib::types::issue_action::IssueActionType;
use redwhisk_lib::types::session_event::SessionEventType;
use serde_json::Value;

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
            "codex_session_id",
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
            "latest_output"
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
            },
        )
        .expect_err("project profile should be bound to the same project");

    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(error.message, "项目级 Agent Profile 不属于当前 Project。");
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
fn start_standalone_agent_session_creates_session_records_event_and_lists_it() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "standalone-success-project");
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
        .start_standalone_agent_session(
            temp_dir.path(),
            StartStandaloneAgentSessionInput {
                project_id,
                title: "Scratch Session".to_string(),
                agent_profile_id: profile_id,
                prompt_snapshot: "Help me inspect the current repo".to_string(),
            },
        )
        .expect("standalone start should succeed");

    let session = AgentSessionRepository::new(&database.connection)
        .find_by_id(result.session_id)
        .expect("find session")
        .expect("session should exist");
    assert_eq!(session.project_id, project_id);
    assert_eq!(session.issue_id, None);
    assert_eq!(session.title.as_deref(), Some("Scratch Session"));
    assert_eq!(session.agent_profile_id, profile_id);
    assert_eq!(session.status, AgentSessionStatus::Running);

    let session_events = EventRepository::new(&database.connection)
        .list_session_events(result.session_id)
        .expect("session events");
    assert_eq!(session_events.len(), 1);
    assert_eq!(
        session_events[0].event_type,
        SessionEventType::SessionStarted
    );

    let issue_actions = database
        .connection
        .query_row("SELECT COUNT(*) FROM issue_actions", [], |row| {
            row.get::<_, i64>(0)
        })
        .expect("issue action count");
    assert_eq!(issue_actions, 0);

    let response = service
        .list_agent_sessions(project_id)
        .expect("list agent sessions");
    assert_eq!(response.sessions.len(), 1);
    assert_eq!(response.sessions[0].session_id, result.session_id);
    assert_eq!(response.sessions[0].issue_id, None);
    assert_eq!(response.sessions[0].issue_title, None);
    assert_eq!(
        response.sessions[0].title.as_deref(),
        Some("Scratch Session")
    );
    assert!(!response.sessions[0].log_path.is_empty());
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
fn start_standalone_agent_session_returns_start_failed_and_rolls_back_when_command_cannot_start() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "standalone-fail-project");
    let profile_id = insert_agent_profile_with_command(
        &database.connection,
        AgentScope::Global,
        None,
        temp_dir
            .path()
            .join("missing-standalone-command")
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
        .start_standalone_agent_session(
            temp_dir.path(),
            StartStandaloneAgentSessionInput {
                project_id,
                title: "Scratch Session".to_string(),
                agent_profile_id: profile_id,
                prompt_snapshot: "Help me inspect the current repo".to_string(),
            },
        )
        .expect_err("standalone start should fail when command cannot start");

    assert_eq!(error.code, CommandErrorCode::AgentSessionStartFailed);

    let session_count = database
        .connection
        .query_row("SELECT COUNT(*) FROM agent_sessions", [], |row| {
            row.get::<_, i64>(0)
        })
        .expect("agent session count");
    assert_eq!(session_count, 0);

    let session_event_count = database
        .connection
        .query_row("SELECT COUNT(*) FROM session_events", [], |row| {
            row.get::<_, i64>(0)
        })
        .expect("session event count");
    assert_eq!(session_event_count, 0);
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
            },
        )
        .expect_err("insert-time unique violation should map to existing-session error");

    assert_eq!(error.code, CommandErrorCode::AgentSessionAlreadyExists);
    assert_eq!(error.message, "当前 Issue 已存在关联 Agent Session。");
    let issue = IssueRepository::new(&database.connection)
        .find_by_id(issue_id)
        .expect("find issue")
        .expect("issue should exist");
    assert_eq!(issue.status, IssueStatus::Backlog);
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

    assert_eq!(response.sessions.len(), 22);
    assert_eq!(
        response.sessions[0].issue_title.as_deref(),
        Some("Newest running issue")
    );
    assert_eq!(
        response.sessions[0].latest_output.as_deref(),
        Some("Running pnpm test -- --run agents-activity.test.tsx")
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
        (1..=20)
            .rev()
            .map(|index| Some(format!("Completed issue {index:02}")))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        response.sessions[2].issue_title.as_deref(),
        Some("Completed issue 20")
    );
    assert_eq!(
        response
            .sessions
            .last()
            .and_then(|session| session.issue_title.as_deref()),
        Some("Completed issue 01")
    );
    assert!(response
        .sessions
        .iter()
        .all(|session| session.issue_title.as_deref() != Some("Completed issue 00")));
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
        shared_closed_at - 2,
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
fn write_terminal_input_clears_requested_attention_after_successful_write() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "clear-attention-project");
    let issue_id = insert_issue(&database.connection, project_id, "running");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let log_path = temp_dir.path().join("clear-attention.log");
    std::fs::write(&log_path, "› Run /review on my current changes\n").expect("write log");
    let session_id = insert_agent_session_row_with_details(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Running,
        AgentSessionAttention::Requested,
        1_780_628_222_000,
        None,
        log_path.to_string_lossy().as_ref(),
    );

    let command = echo_stdin_command(temp_dir.path());
    let manager = PtySessionManager::new();
    let pending = manager
        .spawn_pending(&PtySpawnRequest {
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
    manager.register(session_id, pending, |_| {});

    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );

    service
        .write_terminal_input(
            redwhisk_lib::types::agent_session::WriteAgentSessionTerminalInput {
                project_id,
                session_id,
                data: "hello from user\r".to_string(),
            },
            &manager,
        )
        .expect("write input");

    let refreshed_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find session")
        .expect("session should exist");
    assert_eq!(refreshed_session.attention, AgentSessionAttention::None);

    manager.kill(session_id).expect("kill session");
}

#[test]
fn write_terminal_input_keeps_review_issue_bound_to_same_running_session() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "review-continue-project");
    let issue_id = insert_issue(&database.connection, project_id, "review");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let log_path = temp_dir.path().join("review-continue.log");
    std::fs::write(&log_path, "existing review context\n").expect("write log");
    let session_id = insert_agent_session_row_with_details(
        &database.connection,
        issue_id,
        profile_id,
        AgentSessionStatus::Running,
        AgentSessionAttention::Requested,
        1_780_628_223_000,
        None,
        log_path.to_string_lossy().as_ref(),
    );

    let command = echo_stdin_command(temp_dir.path());
    let manager = PtySessionManager::new();
    let pending = manager
        .spawn_pending(&PtySpawnRequest {
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
    manager.register(session_id, pending, |_| {});

    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );
    let issue_action_count_before = EventRepository::new(&database.connection)
        .list_issue_actions(issue_id)
        .expect("issue actions before write")
        .len();

    service
        .write_terminal_input(
            redwhisk_lib::types::agent_session::WriteAgentSessionTerminalInput {
                project_id,
                session_id,
                data: "fix the latest review findings\r".to_string(),
            },
            &manager,
        )
        .expect("write review input");

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
    assert_eq!(sessions[0].status, AgentSessionStatus::Running);

    let refreshed_session = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find session")
        .expect("session should exist");
    assert_eq!(refreshed_session.log_path, log_path.to_string_lossy());
    assert_eq!(refreshed_session.attention, AgentSessionAttention::None);

    let mut snapshot = String::new();
    for _ in 0..20 {
        std::thread::sleep(std::time::Duration::from_millis(50));
        snapshot = read_terminal_snapshot(&log_path, 8_192).expect("read snapshot");
        if snapshot.contains("fix the latest review findings") {
            break;
        }
    }

    assert!(snapshot.contains("fix the latest review findings"));

    let session_events = EventRepository::new(&database.connection)
        .list_session_events(session_id)
        .expect("session events");
    assert!(session_events.is_empty());

    let issue_actions = EventRepository::new(&database.connection)
        .list_issue_actions(issue_id)
        .expect("issue actions");
    assert_eq!(issue_actions.len(), issue_action_count_before);

    manager.kill(session_id).expect("kill session");
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
        .reconcile_unrecoverable_running_sessions(project_id, &manager)
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
    manager.register(77, pending, |_| {});

    manager
        .write_input(77, "hello from pty\r")
        .expect("write input");
    manager.resize(77, 32, 120).expect("resize");

    let mut snapshot = String::new();
    for _ in 0..20 {
        std::thread::sleep(std::time::Duration::from_millis(50));
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
    manager.register_for_project(42, 77, pending, |_| {});

    manager
        .write_input(77, "hello event stream\r")
        .expect("write input");

    let mut events = Vec::new();
    let mut snapshot = String::new();
    for _ in 0..20 {
        if let Ok(event) = receiver.recv_timeout(std::time::Duration::from_millis(50)) {
            events.push(event);
        }
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
    manager.register_for_project(42, 77, pending, |_| {});

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
fn restore_terminal_returns_inactive_instead_of_error_when_session_exits_during_transition() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "restore-inactive-project");
    let profile_id = insert_agent_profile_with_command(
        &database.connection,
        AgentScope::Global,
        None,
        echo_stdin_command(temp_dir.path())
            .to_string_lossy()
            .as_ref(),
    );
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
        AgentSessionRepository::new(&database.connection),
    );
    let manager = PtySessionManager::new();

    let started = service
        .start_standalone_agent_session_with_pty(
            temp_dir.path(),
            StartStandaloneAgentSessionInput {
                project_id,
                title: "Restore Transition".to_string(),
                agent_profile_id: profile_id,
                prompt_snapshot: "keep running".to_string(),
            },
            &manager,
        )
        .expect("start standalone session with pty");

    manager
        .kill(started.session_id)
        .expect("kill standalone session");

    let mut saw_inactive = false;
    for _ in 0..40 {
        let result = service.restore_terminal(
            RestoreAgentSessionTerminalInput {
                project_id,
                session_id: started.session_id,
            },
            &manager,
        );

        match result {
            Ok(snapshot) if !snapshot.is_active => {
                saw_inactive = true;
                assert_eq!(snapshot.session_id, started.session_id);
                assert_eq!(snapshot.sequence, 0);
                assert!(snapshot.chunks.is_empty());
                assert!(!snapshot.is_complete);
                break;
            }
            Ok(_) => std::thread::sleep(std::time::Duration::from_millis(25)),
            Err(error) => panic!(
                "restore during session shutdown should not error: {} ({:?})",
                error.message, error.code
            ),
        }
    }

    assert!(
        saw_inactive,
        "expected restore to settle into inactive state"
    );
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

    let command = echo_stdin_command(temp_dir.path());
    let log_path = temp_dir.path().join("inject-prompt.log");
    let manager = PtySessionManager::new();
    let pending = manager
        .spawn_pending(&PtySpawnRequest {
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
    manager.register(session_id, pending, |_| {});

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
        )
        .expect("inject prompt");

    assert_eq!(result.session_id, session_id);
    assert_eq!(result.codex_session_id, None);

    let mut snapshot = String::new();
    for _ in 0..20 {
        std::thread::sleep(std::time::Duration::from_millis(50));
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

    let command = echo_stdin_command(temp_dir.path());
    let manager = PtySessionManager::new();
    let pending = manager
        .spawn_pending(&PtySpawnRequest {
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
    manager.register(session_id, pending, |_| {});

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
        )
        .expect("inject review prompt");

    assert_eq!(result.session_id, session_id);
    assert_eq!(result.codex_session_id, None);

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

fn migrated_database(data_dir: &std::path::Path) -> redwhisk_lib::db::connection::Database {
    let database = DatabaseConfig::new(data_dir).open().expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    database
}

fn insert_project(connection: &rusqlite::Connection, repo_name: &str) -> i64 {
    let repo_dir = std::env::temp_dir().join(repo_name);
    std::fs::create_dir_all(&repo_dir).expect("create repo dir");
    connection
        .execute(
            "INSERT INTO projects (name, repo_path, created_at, last_opened_at, completion_policy)
             VALUES (?1, ?2, 1780624800000, 1780624800000, 'manual')",
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
    let service = redwhisk_lib::core::issue_service::IssueService::new(
        IssueRepository::new(connection),
        ProjectRepository::new(connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: title.to_string(),
            description: "Issue description".to_string(),
            attachments: Vec::new(),
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
            ) VALUES (?1, ?2, ?3, ?4, ?5, '/tmp/repo', 'codex', 'prompt', ?6, ?7, ?7, ?8)",
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
            ) VALUES (?1, NULL, 'Standalone Session', ?2, ?3, ?4, '/tmp/repo', 'codex', 'prompt', ?5, ?6, ?6, ?7)",
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

fn echo_stdin_command(base_dir: &std::path::Path) -> std::path::PathBuf {
    let path = base_dir.join("echo-stdin.sh");
    std::fs::write(&path, "#!/bin/sh\ncat\n").expect("write echo stdin script");
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
