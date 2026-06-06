use redwhisk_lib::core::agent_session_service::AgentSessionService;
use redwhisk_lib::db::agent_profile_repository::AgentProfileRepository;
use redwhisk_lib::db::agent_session_repository::AgentSessionRepository;
use redwhisk_lib::db::connection::DatabaseConfig;
use redwhisk_lib::db::event_repository::EventRepository;
use redwhisk_lib::db::issue_repository::IssueRepository;
use redwhisk_lib::db::migrations::MigrationRunner;
use redwhisk_lib::db::project_repository::ProjectRepository;
use redwhisk_lib::types::agent_profile::{AgentScope, AgentType};
use redwhisk_lib::types::agent_session::{
    AgentSessionAttention, AgentSessionStatus, StartAgentSessionInput,
};
use redwhisk_lib::types::errors::CommandErrorCode;
use redwhisk_lib::types::issue::CreateIssueInput;
use redwhisk_lib::types::issue::IssueStatus;
use redwhisk_lib::types::issue_action::IssueActionType;
use redwhisk_lib::types::session_event::SessionEventType;

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
            "closed_at"
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
    insert_agent_session_row(
        &database.connection,
        newer_running_issue,
        profile_id,
        AgentSessionStatus::Running,
        1_780_628_000_000,
        None,
    );
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
        let status = if index % 2 == 0 {
            AgentSessionStatus::Closed
        } else {
            AgentSessionStatus::Stopped
        };
        insert_agent_session_row(
            &database.connection,
            issue_id,
            profile_id,
            status,
            closed_at - 10,
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
        response.sessions[1].issue_title.as_deref(),
        Some("Older running issue")
    );
    assert!(response.sessions[..2]
        .iter()
        .all(|session| session.status == AgentSessionStatus::Running));
    assert!(response.sessions[2..]
        .iter()
        .all(|session| session.status != AgentSessionStatus::Running));
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
    let service = redwhisk_lib::core::issue_service::IssueService::new(
        IssueRepository::new(connection),
        ProjectRepository::new(connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: title.to_string(),
            description: "Issue description".to_string(),
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
    connection
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
                started_at,
                closed_at
            ) VALUES (?1, ?2, ?3, ?4, '/tmp/repo', 'codex', 'prompt', '/tmp/log', ?5, ?5, ?6)",
            rusqlite::params![
                issue_id,
                agent_profile_id,
                agent_session_status_str(&status),
                agent_session_attention_str(&AgentSessionAttention::None),
                last_active_at,
                closed_at,
            ],
        )
        .expect("insert agent session row");
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
