use crate::db::agent_profile_repository::AgentProfileRepository;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::issue_repository::IssueRepository;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::features::agent_session::AgentSessionService;
use rusqlite::{params, Connection};

fn setup() -> Connection {
    let connection = Connection::open_in_memory().expect("open database");
    MigrationRunner::default()
        .run(&connection)
        .expect("run migrations");
    connection
        .execute(
            "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
             VALUES (1, 'RedWhisk', ?1, 1, 1)",
            params![std::env::temp_dir().to_string_lossy().to_string()],
        )
        .expect("insert project");
    connection
        .execute(
            "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
             VALUES (101, 'Codex', 'codex', 'codex', 'project', 1, 'full-auto', 1, '', '', 0)",
            [],
        )
        .expect("insert profile");
    connection
        .execute(
            "INSERT INTO agent_sessions (
               id, project_id, number, issue_id, title, agent_profile_id, status, attention,
               working_dir, command_snapshot, prompt_snapshot, workspace_mode,
               target_branch, workspace_branch, workspace_path,
               worktree_root_path, log_path, list_inserted_at, last_active_at, started_at,
               closed_at, del
             ) VALUES (
               410, 1, 1, NULL, NULL, 101, 'running', 'none',
               '/tmp', '', '', 'current_branch',
               NULL, NULL, '/tmp',
               NULL, '/tmp/session.jsonl', 1, 1, 1,
               NULL, 0
             )",
            [],
        )
        .expect("insert session");
    connection
}

fn service(connection: &Connection) -> AgentSessionService<'_> {
    AgentSessionService::new(
        IssueRepository::new(connection),
        ProjectRepository::new(connection),
        AgentProfileRepository::new(connection),
        AgentSessionRepository::new(connection),
    )
}

#[test]
fn list_item_has_no_session_token_usage_before_any_event() {
    let connection = setup();
    let listed = service(&connection)
        .list_agent_sessions(1)
        .expect("list sessions");
    assert_eq!(listed.sessions[0].token_input, None);
    assert_eq!(listed.sessions[0].token_output, None);
    assert_eq!(listed.sessions[0].token_cache, None);
}

#[test]
fn received_zero_usage_is_distinct_from_missing_usage() {
    let connection = setup();
    AgentSessionRepository::new(&connection)
        .overwrite_session_token_usage(410, 0, 0, 0)
        .expect("overwrite zeros");

    let listed = service(&connection)
        .list_agent_sessions(1)
        .expect("list sessions");
    assert_eq!(listed.sessions[0].token_input, Some(0));
    assert_eq!(listed.sessions[0].token_output, Some(0));
    assert_eq!(listed.sessions[0].token_cache, Some(0));
}

#[test]
fn codex_total_overwrite_replaces_list_item_totals_instead_of_adding() {
    let connection = setup();
    let repository = AgentSessionRepository::new(&connection);
    repository
        .overwrite_session_token_usage(410, 1_100, 300, 400)
        .expect("first overwrite");
    repository
        .overwrite_session_token_usage(410, 2_000, 500, 100)
        .expect("second overwrite");

    let listed = service(&connection)
        .list_agent_sessions(1)
        .expect("list sessions");
    assert_eq!(listed.sessions[0].token_input, Some(2_000));
    assert_eq!(listed.sessions[0].token_output, Some(500));
    assert_eq!(listed.sessions[0].token_cache, Some(100));
}

#[test]
fn usage_updated_event_overwrites_list_item_session_tokens() {
    let connection = setup();
    let persisted = crate::agent::session_token_usage::persist_session_token_usage(
        &AgentSessionRepository::new(&connection),
        410,
        &crate::types::agent_session_stream::AgentStreamEvent::UsageUpdated {
            usage: crate::types::agent_session_stream::AgentUsage {
                input_tokens: Some(100),
                output_tokens: Some(20),
                context_window_max_tokens: Some(200_000),
                context_window_used_tokens: Some(120),
                session_token_input: Some(1_100),
                session_token_output: Some(300),
                session_token_cache: Some(400),
                session_token_merge:
                    crate::types::agent_session_stream::SessionTokenMerge::Overwrite,
            },
        },
    )
    .expect("persist usage event");
    assert!(persisted);

    let listed = service(&connection)
        .list_agent_sessions(1)
        .expect("list sessions");
    assert_eq!(listed.sessions[0].token_input, Some(1_100));
    assert_eq!(listed.sessions[0].token_output, Some(300));
    assert_eq!(listed.sessions[0].token_cache, Some(400));
}

#[test]
fn codex_total_payload_persists_onto_list_item() {
    let connection = setup();
    let snapshot =
        crate::agent::session_token_usage::normalize_codex_token_usage(&serde_json::json!({
            "last": {
                "input_tokens": 100,
                "cached_input_tokens": 20,
                "output_tokens": 30,
            },
            "total": {
                "input_tokens": 1_500,
                "cached_input_tokens": 400,
                "output_tokens": 300,
            },
        }))
        .expect("normalize total");
    let persisted = crate::agent::session_token_usage::persist_session_token_usage(
        &AgentSessionRepository::new(&connection),
        410,
        &crate::types::agent_session_stream::AgentStreamEvent::UsageUpdated {
            usage: crate::types::agent_session_stream::AgentUsage {
                input_tokens: Some(100),
                output_tokens: Some(30),
                context_window_max_tokens: Some(200_000),
                context_window_used_tokens: Some(130),
                session_token_input: Some(snapshot.input),
                session_token_output: Some(snapshot.output),
                session_token_cache: Some(snapshot.cache),
                session_token_merge:
                    crate::types::agent_session_stream::SessionTokenMerge::Overwrite,
            },
        },
    )
    .expect("persist normalized usage");
    assert!(persisted);

    let listed = service(&connection)
        .list_agent_sessions(1)
        .expect("list sessions");
    assert_eq!(listed.sessions[0].token_input, Some(1_100));
    assert_eq!(listed.sessions[0].token_output, Some(300));
    assert_eq!(listed.sessions[0].token_cache, Some(400));
}

fn claude_usage_event(
    input: u64,
    output: u64,
    cache: u64,
    merge: crate::types::agent_session_stream::SessionTokenMerge,
) -> crate::types::agent_session_stream::AgentStreamEvent {
    crate::types::agent_session_stream::AgentStreamEvent::UsageUpdated {
        usage: crate::types::agent_session_stream::AgentUsage {
            input_tokens: Some(input),
            output_tokens: Some(output),
            context_window_max_tokens: None,
            context_window_used_tokens: None,
            session_token_input: Some(input),
            session_token_output: Some(output),
            session_token_cache: Some(cache),
            session_token_merge: merge,
        },
    }
}

#[test]
fn claude_turn_commits_accumulate_across_turns_on_list_item() {
    let connection = setup();
    let repository = AgentSessionRepository::new(&connection);
    let first = crate::agent::session_token_usage::persist_session_token_usage(
        &repository,
        410,
        &claude_usage_event(
            150,
            30,
            50,
            crate::types::agent_session_stream::SessionTokenMerge::TurnCommit,
        ),
    )
    .expect("persist first turn");
    let second = crate::agent::session_token_usage::persist_session_token_usage(
        &repository,
        410,
        &claude_usage_event(
            80,
            20,
            10,
            crate::types::agent_session_stream::SessionTokenMerge::TurnCommit,
        ),
    )
    .expect("persist second turn");
    assert!(first);
    assert!(second);

    let listed = service(&connection)
        .list_agent_sessions(1)
        .expect("list sessions");
    assert_eq!(listed.sessions[0].token_input, Some(230));
    assert_eq!(listed.sessions[0].token_output, Some(50));
    assert_eq!(listed.sessions[0].token_cache, Some(60));
}

#[test]
fn claude_same_turn_assistant_and_result_are_not_double_counted() {
    let connection = setup();
    let repository = AgentSessionRepository::new(&connection);
    let mut accumulator = crate::agent::session_token_usage::SessionTokenAccumulator::default();
    crate::agent::session_token_usage::persist_session_token_usage_with(
        &repository,
        410,
        &claude_usage_event(
            100,
            10,
            40,
            crate::types::agent_session_stream::SessionTokenMerge::TurnLatest,
        ),
        &mut accumulator,
    )
    .expect("persist assistant fragment");
    crate::agent::session_token_usage::persist_session_token_usage_with(
        &repository,
        410,
        &claude_usage_event(
            150,
            30,
            50,
            crate::types::agent_session_stream::SessionTokenMerge::TurnCommit,
        ),
        &mut accumulator,
    )
    .expect("persist result");

    let listed = service(&connection)
        .list_agent_sessions(1)
        .expect("list sessions");
    assert_eq!(listed.sessions[0].token_input, Some(150));
    assert_eq!(listed.sessions[0].token_output, Some(30));
    assert_eq!(listed.sessions[0].token_cache, Some(50));
}

#[test]
fn claude_in_progress_turn_overwrites_current_turn_and_keeps_committed() {
    let connection = setup();
    let repository = AgentSessionRepository::new(&connection);
    let mut accumulator = crate::agent::session_token_usage::SessionTokenAccumulator::default();
    crate::agent::session_token_usage::persist_session_token_usage_with(
        &repository,
        410,
        &claude_usage_event(
            150,
            30,
            50,
            crate::types::agent_session_stream::SessionTokenMerge::TurnCommit,
        ),
        &mut accumulator,
    )
    .expect("commit first turn");
    crate::agent::session_token_usage::persist_session_token_usage_with(
        &repository,
        410,
        &claude_usage_event(
            100,
            10,
            40,
            crate::types::agent_session_stream::SessionTokenMerge::TurnLatest,
        ),
        &mut accumulator,
    )
    .expect("preview second turn");
    let listed = service(&connection)
        .list_agent_sessions(1)
        .expect("list after preview");
    assert_eq!(listed.sessions[0].token_input, Some(250));
    assert_eq!(listed.sessions[0].token_output, Some(40));
    assert_eq!(listed.sessions[0].token_cache, Some(90));

    crate::agent::session_token_usage::persist_session_token_usage_with(
        &repository,
        410,
        &claude_usage_event(
            120,
            20,
            40,
            crate::types::agent_session_stream::SessionTokenMerge::TurnLatest,
        ),
        &mut accumulator,
    )
    .expect("overwrite current turn");
    let listed = service(&connection)
        .list_agent_sessions(1)
        .expect("list after overwrite");
    assert_eq!(listed.sessions[0].token_input, Some(270));
    assert_eq!(listed.sessions[0].token_output, Some(50));
    assert_eq!(listed.sessions[0].token_cache, Some(90));

    crate::agent::session_token_usage::persist_session_token_usage_with(
        &repository,
        410,
        &claude_usage_event(
            80,
            20,
            10,
            crate::types::agent_session_stream::SessionTokenMerge::TurnCommit,
        ),
        &mut accumulator,
    )
    .expect("commit second turn");
    let listed = service(&connection)
        .list_agent_sessions(1)
        .expect("list after second commit");
    assert_eq!(listed.sessions[0].token_input, Some(230));
    assert_eq!(listed.sessions[0].token_output, Some(50));
    assert_eq!(listed.sessions[0].token_cache, Some(60));
}

#[test]
fn opencode_turn_completed_same_caliber_usage_accumulates_on_list_item() {
    let connection = setup();
    let repository = AgentSessionRepository::new(&connection);
    let snapshot =
        crate::agent::session_token_usage::normalize_claude_token_usage(&serde_json::json!({
            "input": 10,
            "output": 20,
        }))
        .expect("normalize opencode tokens");
    let persisted = crate::agent::session_token_usage::persist_session_token_usage(
        &repository,
        410,
        &crate::types::agent_session_stream::AgentStreamEvent::TurnCompleted {
            turn_id: Some("part-2".into()),
            usage: Some(crate::types::agent_session_stream::AgentUsage {
                input_tokens: Some(10),
                output_tokens: Some(20),
                context_window_max_tokens: None,
                context_window_used_tokens: None,
                session_token_input: Some(snapshot.input),
                session_token_output: Some(snapshot.output),
                session_token_cache: Some(snapshot.cache),
                session_token_merge:
                    crate::types::agent_session_stream::SessionTokenMerge::TurnCommit,
            }),
            stop_reason: None,
            subtype: None,
        },
    )
    .expect("persist opencode turn");
    assert!(persisted);

    let listed = service(&connection)
        .list_agent_sessions(1)
        .expect("list sessions");
    assert_eq!(listed.sessions[0].token_input, Some(10));
    assert_eq!(listed.sessions[0].token_output, Some(20));
    assert_eq!(listed.sessions[0].token_cache, Some(0));
}
