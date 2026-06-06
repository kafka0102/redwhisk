use redwhisk_lib::core::agent_session_service::AgentSessionService;
use redwhisk_lib::db::agent_profile_repository::AgentProfileRepository;
use redwhisk_lib::db::connection::DatabaseConfig;
use redwhisk_lib::db::issue_repository::IssueRepository;
use redwhisk_lib::db::migrations::MigrationRunner;
use redwhisk_lib::db::project_repository::ProjectRepository;
use redwhisk_lib::types::agent_profile::{AgentScope, AgentType};
use redwhisk_lib::types::agent_session::StartAgentSessionInput;
use redwhisk_lib::types::errors::CommandErrorCode;
use redwhisk_lib::types::issue::CreateIssueInput;

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
    );

    let error = service
        .start_agent_session(StartAgentSessionInput {
            project_id,
            issue_id,
            agent_profile_id: profile_id,
            prompt_snapshot: "   ".to_string(),
        })
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
    );

    let error = service
        .start_agent_session(StartAgentSessionInput {
            project_id,
            issue_id,
            agent_profile_id: profile_id,
            prompt_snapshot: "Use this snapshot".to_string(),
        })
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
    );

    let error = service
        .start_agent_session(StartAgentSessionInput {
            project_id,
            issue_id,
            agent_profile_id: profile_id,
            prompt_snapshot: "Use this snapshot".to_string(),
        })
        .expect_err("project profile should be bound to the same project");

    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(error.message, "项目级 Agent Profile 不属于当前 Project。");
}

#[test]
fn start_agent_session_returns_not_ready_after_validation_passes() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let database = migrated_database(temp_dir.path());
    let project_id = insert_project(&database.connection, "sample-repo");
    let issue_id = insert_issue(&database.connection, project_id, "backlog");
    let profile_id = insert_agent_profile(&database.connection, AgentScope::Global, None);
    let service = AgentSessionService::new(
        IssueRepository::new(&database.connection),
        ProjectRepository::new(&database.connection),
        AgentProfileRepository::new(&database.connection),
    );

    let error = service
        .start_agent_session(StartAgentSessionInput {
            project_id,
            issue_id,
            agent_profile_id: profile_id,
            prompt_snapshot: "Use this snapshot".to_string(),
        })
        .expect_err("start should stay not ready in story 2.2");

    assert_eq!(error.code, CommandErrorCode::AgentSessionStartNotReady);
    assert_eq!(error.message, "Agent Session 启动将在 Story 2.3 接入。");
}

fn migrated_database(data_dir: &std::path::Path) -> redwhisk_lib::db::connection::Database {
    let database = DatabaseConfig::new(data_dir).open().expect("database");
    MigrationRunner::default()
        .run(&database.connection)
        .expect("migrations");
    database
}

fn insert_project(connection: &rusqlite::Connection, repo_name: &str) -> i64 {
    connection
        .execute(
            "INSERT INTO projects (name, repo_path, created_at, last_opened_at)
             VALUES (?1, ?2, 1780624800000, 1780624800000)",
            rusqlite::params![repo_name, format!("/tmp/{repo_name}")],
        )
        .expect("insert project");
    connection.last_insert_rowid()
}

fn insert_issue(connection: &rusqlite::Connection, project_id: i64, status: &str) -> i64 {
    let service = redwhisk_lib::core::issue_service::IssueService::new(
        IssueRepository::new(connection),
        ProjectRepository::new(connection),
    );
    let issue = service
        .create_issue(CreateIssueInput {
            project_id,
            title: "Issue title".to_string(),
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

fn insert_agent_profile(
    connection: &rusqlite::Connection,
    scope: AgentScope,
    project_id: Option<i64>,
) -> i64 {
    let repository = AgentProfileRepository::new(connection);
    let profile = repository
        .save_profile(
            None,
            "Codex",
            AgentType::Codex,
            "/usr/local/bin/codex",
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
