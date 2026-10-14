use rusqlite::{params, Connection};
use serde_json::json;

use super::tui_hook_turn::{apply_tui_hook_event, ResolvedTuiHookEvent, TuiHookSource};
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::migrations::MigrationRunner;

pub(super) fn database() -> Connection {
    let connection = Connection::open_in_memory().expect("open database");
    MigrationRunner::default()
        .run(&connection)
        .expect("run migrations");
    connection
        .execute(
            "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
             VALUES (1, 'RedWhisk', '/tmp/redwhisk', 1, 1)",
            [],
        )
        .expect("insert project");
    for (id, agent_type) in [(101_i64, "codex"), (102, "grok"), (103, "claude")] {
        connection
            .execute(
                "INSERT INTO agent_profiles (
                   id, name, agent_type, command, scope, project_id, mode, dangerous,
                   default_skill, prompt_template, del
                 ) VALUES (?1, ?2, ?2, ?2, 'project', 1, 'full-auto', 1, '', '', 0)",
                params![id, agent_type],
            )
            .expect("insert profile");
    }
    connection
}

pub(super) struct SessionSeed {
    pub id: i64,
    pub agent_type: &'static str,
    pub display_mode: &'static str,
    pub status: &'static str,
    pub provider_session_id: Option<&'static str>,
    pub is_turn_running: i64,
    pub turn_started_at: Option<i64>,
    pub turn_ended_at: Option<i64>,
    pub current_turn_id: Option<&'static str>,
    pub attention: &'static str,
}

pub(super) fn insert_session(connection: &Connection, seed: SessionSeed) {
    let profile_id = match seed.agent_type {
        "codex" => 101,
        "grok" => 102,
        "claude" => 103,
        _ => panic!("unknown agent type"),
    };
    connection
        .execute(
            "INSERT INTO agent_sessions (
               id, project_id, number, agent_profile_id, provider_session_id, status, attention,
               working_dir, command_snapshot, prompt_snapshot, log_path, last_active_at,
               started_at, del, display_mode, is_turn_running, turn_started_at, turn_ended_at,
               current_turn_id
             ) VALUES (
               ?1, 1, ?1, ?2, ?3, ?4, ?5,
               '/tmp/redwhisk', '', '', '/tmp/s.log', 1,
               1, 0, ?6, ?7, ?8, ?9, ?10
             )",
            params![
                seed.id,
                profile_id,
                seed.provider_session_id,
                seed.status,
                seed.attention,
                seed.display_mode,
                seed.is_turn_running,
                seed.turn_started_at,
                seed.turn_ended_at,
                seed.current_turn_id,
            ],
        )
        .expect("insert session");
}

pub(super) fn tui(id: i64, agent_type: &'static str) -> SessionSeed {
    SessionSeed {
        id,
        agent_type,
        display_mode: "tui",
        status: "running",
        provider_session_id: None,
        is_turn_running: 0,
        turn_started_at: None,
        turn_ended_at: None,
        current_turn_id: Some("keep-me"),
        attention: "requested",
    }
}

pub(super) struct TurnRow {
    pub is_turn_running: i64,
    pub turn_started_at: Option<i64>,
    pub turn_ended_at: Option<i64>,
    pub current_turn_id: Option<String>,
    pub attention: String,
    pub processing_ms: i64,
}

pub(super) fn read_turn(connection: &Connection, id: i64) -> TurnRow {
    connection
        .query_row(
            "SELECT is_turn_running, turn_started_at, turn_ended_at, current_turn_id, attention, processing_ms
             FROM agent_sessions WHERE id = ?1",
            params![id],
            |row| {
                Ok(TurnRow {
                    is_turn_running: row.get(0)?,
                    turn_started_at: row.get(1)?,
                    turn_ended_at: row.get(2)?,
                    current_turn_id: row.get(3)?,
                    attention: row.get(4)?,
                    processing_ms: row.get(5)?,
                })
            },
        )
        .expect("read turn")
}

pub(super) fn event(
    session_id: i64,
    source: TuiHookSource,
    name: &str,
    payload: serde_json::Value,
) -> ResolvedTuiHookEvent {
    ResolvedTuiHookEvent {
        session_id,
        source,
        event_name: name.to_string(),
        payload,
    }
}

#[test]
fn user_prompt_submit_marks_codex_and_grok_tui_running() {
    let database = database();
    insert_session(
        &database,
        SessionSeed {
            turn_ended_at: Some(50),
            ..tui(1, "codex")
        },
    );
    insert_session(&database, tui(2, "grok"));
    let repository = AgentSessionRepository::new(&database);

    for (id, source) in [(1, TuiHookSource::Codex), (2, TuiHookSource::Grok)] {
        let outcome = apply_tui_hook_event(
            &repository,
            &event(id, source, "UserPromptSubmit", json!({})),
            1_000,
        )
        .expect("apply");
        assert!(outcome.changed);
        assert!(outcome.marked_running);
        assert_eq!(outcome.list_changed_reason, Some("tui_hook_turn"));
        let row = read_turn(&database, id);
        assert_eq!(row.is_turn_running, 1);
        assert_eq!(row.turn_started_at, Some(1_000));
        assert_eq!(row.turn_ended_at, None);
        assert_eq!(row.current_turn_id.as_deref(), Some("keep-me"));
        assert_eq!(row.attention, "requested");
    }
}

#[test]
fn codex_stop_and_interrupt_clear_immediately_without_grace() {
    let database = database();
    for id in [1, 2] {
        insert_session(
            &database,
            SessionSeed {
                is_turn_running: 1,
                turn_started_at: Some(10),
                ..tui(id, "codex")
            },
        );
    }
    let repository = AgentSessionRepository::new(&database);

    for (id, name) in [(1, "Stop"), (2, "Interrupt")] {
        let outcome = apply_tui_hook_event(
            &repository,
            &event(id, TuiHookSource::Codex, name, json!({})),
            2_000,
        )
        .expect("apply");
        assert!(outcome.changed);
        assert!(!outcome.marked_running);
        assert_eq!(outcome.list_changed_reason, Some("tui_hook_turn"));
        let row = read_turn(&database, id);
        assert_eq!(row.is_turn_running, 0);
        assert_eq!(row.turn_ended_at, None);
        assert_eq!(row.turn_started_at, Some(10));
        assert_eq!(row.current_turn_id.as_deref(), Some("keep-me"));
    }
}

#[test]
fn grok_stop_clears_only_for_missing_or_end_turn_reason() {
    let database = database();
    for id in [1, 2, 3] {
        insert_session(
            &database,
            SessionSeed {
                is_turn_running: 1,
                turn_started_at: Some(10),
                ..tui(id, "grok")
            },
        );
    }
    let repository = AgentSessionRepository::new(&database);

    let cleared = apply_tui_hook_event(
        &repository,
        &event(1, TuiHookSource::Grok, "Stop", json!({})),
        2_000,
    )
    .expect("apply");
    assert!(cleared.changed);
    assert_eq!(read_turn(&database, 1).is_turn_running, 0);
    assert_eq!(read_turn(&database, 1).turn_ended_at, None);

    let end_turn = apply_tui_hook_event(
        &repository,
        &event(
            2,
            TuiHookSource::Grok,
            "Stop",
            json!({"reason": "end_turn"}),
        ),
        2_000,
    )
    .expect("apply");
    assert!(end_turn.changed);
    assert_eq!(read_turn(&database, 2).is_turn_running, 0);

    let shutdown = apply_tui_hook_event(
        &repository,
        &event(
            3,
            TuiHookSource::Grok,
            "Stop",
            json!({"reason": "shutdown"}),
        ),
        2_000,
    )
    .expect("apply");
    assert!(!shutdown.changed);
    assert_eq!(shutdown.list_changed_reason, None);
    assert_eq!(read_turn(&database, 3).is_turn_running, 1);
    assert_eq!(read_turn(&database, 3).turn_started_at, Some(10));
}

#[test]
fn grok_stop_failure_and_cancelled_clear() {
    let database = database();
    for id in [1, 2] {
        insert_session(
            &database,
            SessionSeed {
                is_turn_running: 1,
                ..tui(id, "grok")
            },
        );
    }
    let repository = AgentSessionRepository::new(&database);
    for (id, name) in [(1, "StopFailure"), (2, "StopCancelled")] {
        let outcome = apply_tui_hook_event(
            &repository,
            &event(id, TuiHookSource::Grok, name, json!({})),
            2_000,
        )
        .expect("apply");
        assert!(outcome.changed, "{name}");
        assert_eq!(read_turn(&database, id).is_turn_running, 0);
        assert_eq!(read_turn(&database, id).turn_ended_at, None);
    }
}

#[test]
fn grok_idle_prompt_clears_only_when_currently_running() {
    let database = database();
    insert_session(
        &database,
        SessionSeed {
            is_turn_running: 1,
            ..tui(1, "grok")
        },
    );
    insert_session(&database, tui(2, "grok"));
    let repository = AgentSessionRepository::new(&database);
    let payload = json!({"notificationType": "idle_prompt"});

    let running = apply_tui_hook_event(
        &repository,
        &event(1, TuiHookSource::Grok, "Notification", payload.clone()),
        2_000,
    )
    .expect("apply");
    assert!(running.changed);
    assert_eq!(read_turn(&database, 1).is_turn_running, 0);
    assert_eq!(read_turn(&database, 1).turn_ended_at, None);

    let idle = apply_tui_hook_event(
        &repository,
        &event(2, TuiHookSource::Grok, "Notification", payload),
        2_000,
    )
    .expect("apply");
    assert!(!idle.changed);
    assert_eq!(idle.list_changed_reason, None);
    assert_eq!(read_turn(&database, 2).is_turn_running, 0);
}

#[test]
fn unknown_event_and_json_row_and_zero_rows_are_ignored() {
    let database = database();
    insert_session(
        &database,
        SessionSeed {
            is_turn_running: 1,
            turn_started_at: Some(10),
            ..tui(1, "codex")
        },
    );
    insert_session(
        &database,
        SessionSeed {
            display_mode: "json",
            ..tui(2, "codex")
        },
    );
    let repository = AgentSessionRepository::new(&database);

    let unknown = apply_tui_hook_event(
        &repository,
        &event(1, TuiHookSource::Codex, "SessionStart", json!({})),
        2_000,
    )
    .expect("apply");
    assert!(!unknown.changed);
    assert_eq!(read_turn(&database, 1).is_turn_running, 1);

    let json_row = apply_tui_hook_event(
        &repository,
        &event(2, TuiHookSource::Codex, "UserPromptSubmit", json!({})),
        2_000,
    )
    .expect("apply");
    assert!(!json_row.changed);
    let json_turn = read_turn(&database, 2);
    assert_eq!(json_turn.is_turn_running, 0);
    assert_eq!(json_turn.turn_started_at, None);

    let missing = apply_tui_hook_event(
        &repository,
        &event(99, TuiHookSource::Codex, "Stop", json!({})),
        2_000,
    )
    .expect("apply");
    assert!(!missing.changed);
    assert_eq!(missing.list_changed_reason, None);
}

#[test]
fn codex_events_do_not_apply_grok_only_names() {
    let database = database();
    insert_session(
        &database,
        SessionSeed {
            is_turn_running: 1,
            ..tui(1, "codex")
        },
    );
    let repository = AgentSessionRepository::new(&database);
    let outcome = apply_tui_hook_event(
        &repository,
        &event(1, TuiHookSource::Codex, "StopFailure", json!({})),
        2_000,
    )
    .expect("apply");
    assert!(!outcome.changed);
    assert_eq!(read_turn(&database, 1).is_turn_running, 1);
}

#[test]
fn stopped_or_other_agent_type_rows_are_not_written() {
    let database = database();
    insert_session(
        &database,
        SessionSeed {
            status: "stopped",
            ..tui(1, "codex")
        },
    );
    insert_session(
        &database,
        SessionSeed {
            agent_type: "claude",
            ..tui(2, "claude")
        },
    );
    let repository = AgentSessionRepository::new(&database);
    for id in [1, 2] {
        let outcome = apply_tui_hook_event(
            &repository,
            &event(id, TuiHookSource::Codex, "UserPromptSubmit", json!({})),
            2_000,
        )
        .expect("apply");
        assert!(!outcome.changed);
        assert_eq!(read_turn(&database, id).is_turn_running, 0);
    }
}
