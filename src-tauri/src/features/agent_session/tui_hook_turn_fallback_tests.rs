use std::collections::HashMap;

use serde_json::json;

use super::tui_hook_turn::{
    apply_tui_hook_event, expire_recorded_silent_tui_hook_turns, expire_silent_tui_hook_turns,
    note_tui_hook_turn_started, provider_session_id_from_payload, resolve_tui_hook_session,
    tui_hook_turn_clock_contains,
    TuiHookCorrelation, TuiHookSource, TUI_HOOK_SILENCE_WINDOW,
};
use super::tui_hook_turn_tests::{database, event, insert_session, read_turn, tui, SessionSeed};
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::types::agent_session::AgentSessionStatus;

#[test]
fn correlation_prefers_redwhisk_session_id_when_kind_matches() {
    let database = database();
    insert_session(
        &database,
        SessionSeed {
            provider_session_id: Some("other"),
            ..tui(7, "codex")
        },
    );
    let repository = AgentSessionRepository::new(&database);
    let resolved = resolve_tui_hook_session(
        &repository,
        &TuiHookCorrelation {
            redwhisk_session_id: Some(7),
            agent_kind: Some(TuiHookSource::Codex),
            payload: json!({"session_id": "missing"}),
        },
    )
    .expect("resolve")
    .expect("matched");
    assert_eq!(resolved, 7);
}

#[test]
fn correlation_falls_back_to_provider_session_id_aliases() {
    let database = database();
    insert_session(
        &database,
        SessionSeed {
            provider_session_id: Some("codex-thread"),
            ..tui(4, "codex")
        },
    );
    insert_session(
        &database,
        SessionSeed {
            provider_session_id: Some("grok-thread"),
            ..tui(5, "grok")
        },
    );
    let repository = AgentSessionRepository::new(&database);

    assert_eq!(
        provider_session_id_from_payload(&json!({"session_id": "codex-thread"})).as_deref(),
        Some("codex-thread")
    );
    assert_eq!(
        provider_session_id_from_payload(&json!({"sessionId": "grok-thread"})).as_deref(),
        Some("grok-thread")
    );
    assert_eq!(
        provider_session_id_from_payload(&json!({"session_id": "alias-for-grok"})).as_deref(),
        Some("alias-for-grok")
    );

    let codex = resolve_tui_hook_session(
        &repository,
        &TuiHookCorrelation {
            redwhisk_session_id: None,
            agent_kind: Some(TuiHookSource::Codex),
            payload: json!({"sessionId": "codex-thread"}),
        },
    )
    .expect("resolve")
    .expect("matched");
    assert_eq!(codex, 4);

    let grok = resolve_tui_hook_session(
        &repository,
        &TuiHookCorrelation {
            redwhisk_session_id: Some(99),
            agent_kind: Some(TuiHookSource::Grok),
            payload: json!({"session_id": "grok-thread"}),
        },
    )
    .expect("resolve")
    .expect("matched");
    assert_eq!(grok, 5);
}

#[test]
fn correlation_drops_when_both_steps_fail_or_kind_mismatches() {
    let database = database();
    insert_session(
        &database,
        SessionSeed {
            provider_session_id: Some("live"),
            ..tui(8, "codex")
        },
    );
    insert_session(
        &database,
        SessionSeed {
            status: "stopped",
            provider_session_id: Some("stopped-provider"),
            ..tui(9, "codex")
        },
    );
    insert_session(
        &database,
        SessionSeed {
            display_mode: "json",
            provider_session_id: Some("json-provider"),
            ..tui(10, "codex")
        },
    );
    let repository = AgentSessionRepository::new(&database);

    let mismatch = resolve_tui_hook_session(
        &repository,
        &TuiHookCorrelation {
            redwhisk_session_id: Some(8),
            agent_kind: Some(TuiHookSource::Grok),
            payload: json!({}),
        },
    )
    .expect("resolve");
    assert!(mismatch.is_err());

    let both_fail = resolve_tui_hook_session(
        &repository,
        &TuiHookCorrelation {
            redwhisk_session_id: None,
            agent_kind: None,
            payload: json!({"cwd": "/tmp/redwhisk", "session_id": "nope"}),
        },
    )
    .expect("resolve");
    assert!(both_fail.is_err());

    let not_running = resolve_tui_hook_session(
        &repository,
        &TuiHookCorrelation {
            redwhisk_session_id: Some(9),
            agent_kind: Some(TuiHookSource::Codex),
            payload: json!({"session_id": "stopped-provider"}),
        },
    )
    .expect("resolve");
    assert!(not_running.is_err());

    let json_mode = resolve_tui_hook_session(
        &repository,
        &TuiHookCorrelation {
            redwhisk_session_id: Some(10),
            agent_kind: Some(TuiHookSource::Codex),
            payload: json!({"session_id": "json-provider"}),
        },
    )
    .expect("resolve");
    assert!(json_mode.is_err());

    assert_eq!(read_turn(&database, 8).is_turn_running, 0);
    assert_eq!(read_turn(&database, 9).is_turn_running, 0);
    assert_eq!(read_turn(&database, 10).is_turn_running, 0);
}

#[test]
fn silence_window_clears_only_and_does_not_revive_after_restart() {
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
            is_turn_running: 1,
            turn_started_at: Some(10),
            ..tui(2, "grok")
        },
    );
    insert_session(&database, tui(3, "codex"));
    let repository = AgentSessionRepository::new(&database);
    let window_ms = TUI_HOOK_SILENCE_WINDOW.as_millis() as i64;
    let mut clocks = HashMap::new();
    clocks.insert(1, 1_000);

    let (too_soon, too_soon_stale) =
        expire_silent_tui_hook_turns(&repository, &clocks, 1_000 + window_ms - 1).expect("expire");
    assert!(too_soon.is_empty());
    assert!(too_soon_stale.is_empty());
    assert_eq!(read_turn(&database, 1).is_turn_running, 1);

    let (expired, stale) =
        expire_silent_tui_hook_turns(&repository, &clocks, 1_000 + window_ms).expect("expire");
    assert_eq!(expired, vec![1]);
    assert!(stale.is_empty());
    assert_eq!(read_turn(&database, 1).is_turn_running, 0);
    assert_eq!(read_turn(&database, 1).turn_ended_at, None);
    // 没有内存墙钟（进程重启后的半截 turn）只清不置，也不补。
    assert_eq!(read_turn(&database, 2).is_turn_running, 1);
    assert_eq!(read_turn(&database, 3).is_turn_running, 0);

    let (again, again_stale) =
        expire_silent_tui_hook_turns(&repository, &clocks, 1_000 + window_ms).expect("expire");
    assert!(again.is_empty());
    // 已经清掉的行不再改，调用方应忘掉墙钟。
    assert_eq!(again_stale, vec![1]);
}

#[test]
fn successful_stop_forgets_the_silence_clock_so_heartbeat_does_not_rewrite() {
    let database = database();
    insert_session(
        &database,
        SessionSeed {
            is_turn_running: 1,
            turn_started_at: Some(10),
            ..tui(41, "codex")
        },
    );
    let repository = AgentSessionRepository::new(&database);
    note_tui_hook_turn_started(41, 1_000);
    let stopped = apply_tui_hook_event(
        &repository,
        &event(41, TuiHookSource::Codex, "Stop", json!({})),
        2_000,
    )
    .expect("apply");
    assert!(stopped.changed);
    assert_eq!(read_turn(&database, 41).is_turn_running, 0);

    let window_ms = TUI_HOOK_SILENCE_WINDOW.as_millis() as i64;
    let expired = expire_recorded_silent_tui_hook_turns(&repository, 2_000 + window_ms)
        .expect("expire");
    assert!(
        expired.is_empty(),
        "Stop 已清标志后，内存墙钟必须忘掉该 session，心跳不得再打空 UPDATE"
    );
    assert_eq!(read_turn(&database, 41).is_turn_running, 0);
    assert_eq!(read_turn(&database, 41).turn_ended_at, None);
}

#[test]
fn process_exit_still_clears_turn_flag_immediately() {
    let connection = database();
    insert_session(
        &connection,
        SessionSeed {
            is_turn_running: 1,
            turn_started_at: Some(10),
            turn_ended_at: Some(20),
            ..tui(1, "codex")
        },
    );
    let repository = AgentSessionRepository::new(&connection);
    note_tui_hook_turn_started(1, 1_000);
    let transaction = connection.unchecked_transaction().expect("begin");
    let record = AgentSessionRepository::mark_terminated_in_transaction(
        &transaction,
        1,
        AgentSessionStatus::Crashed,
        5_000,
    )
    .expect("terminate")
    .expect("row");
    transaction.commit().expect("commit");
    assert_eq!(record.status, AgentSessionStatus::Crashed);
    let row = read_turn(&connection, 1);
    assert_eq!(row.is_turn_running, 0);
    assert_eq!(row.turn_ended_at, None);
    assert_eq!(row.turn_started_at, None);
    let last_active_at: i64 = connection
        .query_row(
            "SELECT last_active_at FROM agent_sessions WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .expect("last active");

    let window_ms = TUI_HOOK_SILENCE_WINDOW.as_millis() as i64;
    let expired = expire_recorded_silent_tui_hook_turns(&repository, 5_000 + window_ms)
        .expect("expire");
    assert!(
        expired.is_empty(),
        "进程退出已清标志后，内存墙钟必须忘掉该 session"
    );
    let last_active_after: i64 = connection
        .query_row(
            "SELECT last_active_at FROM agent_sessions WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .expect("last active after");
    assert_eq!(
        last_active_after, last_active_at,
        "心跳不得再对已退出的行打 UPDATE"
    );
    assert!(
        !tui_hook_turn_clock_contains(1),
        "进程退出后内存墙钟必须忘掉该 session"
    );
}

#[test]
fn accumulate_active_time_skips_tui_even_when_turn_is_running() {
    let database = database();
    insert_session(
        &database,
        SessionSeed {
            display_mode: "json",
            is_turn_running: 1,
            turn_started_at: Some(1_000),
            ..tui(1, "codex")
        },
    );
    insert_session(
        &database,
        SessionSeed {
            is_turn_running: 1,
            turn_started_at: Some(1_000),
            ..tui(2, "codex")
        },
    );
    insert_session(
        &database,
        SessionSeed {
            is_turn_running: 1,
            turn_started_at: Some(1_000),
            ..tui(3, "grok")
        },
    );
    let repository = AgentSessionRepository::new(&database);
    repository
        .accumulate_active_time_ms(5_000, 6_000)
        .expect("accumulate");

    assert_eq!(read_turn(&database, 1).processing_ms, 5_000);
    assert_eq!(read_turn(&database, 2).processing_ms, 0);
    assert_eq!(read_turn(&database, 3).processing_ms, 0);
}
