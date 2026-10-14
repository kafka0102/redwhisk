use std::os::unix::net::UnixListener;
use std::thread;

use super::tui_hook_socket::{
    hook_event_name, parse_hook_line, run_hook_command, tui_hook_socket_path, HookCommandEnv,
    TuiHookChannel, TuiHookChannelStatus, TuiHookListener,
};
use super::tui_hook_turn::{apply_tui_hook_event, resolve_tui_hook_session, TuiHookCorrelation};
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::features::agent_session::tui_hook_turn_tests::{self, SessionSeed};

#[test]
fn hook_command_exits_zero_with_empty_stdout_when_socket_refuses() {
    let missing = std::path::PathBuf::from("/tmp/redwhisk-hook-socket-does-not-exist.sock");
    let _ = std::fs::remove_file(&missing);
    let output = run_hook_command(
        "codex",
        r#"{"hook_event_name":"UserPromptSubmit"}"#,
        &missing,
        &HookCommandEnv::default(),
    );
    assert_eq!(output.exit_code, 0);
    assert_eq!(output.stdout, "");
    assert!(!output.stdout.to_ascii_lowercase().contains("deny"));
}

#[test]
fn hook_event_name_reads_codex_and_grok_fields() {
    assert_eq!(
        hook_event_name(&serde_json::json!({"hook_event_name": "Interrupt"})).as_deref(),
        Some("Interrupt")
    );
    assert_eq!(
        hook_event_name(&serde_json::json!({"hookEventName": "Stop"})).as_deref(),
        Some("Stop")
    );
    assert_eq!(hook_event_name(&serde_json::json!({})), None);
}

#[test]
fn unparsable_json_is_discarded() {
    assert!(parse_hook_line("").is_none());
    assert!(parse_hook_line("not-json").is_none());
    assert!(parse_hook_line("{").is_none());
    let mut seen = 0;
    TuiHookListener::dispatch_line("not-json", |_| seen += 1);
    assert_eq!(seen, 0);
}

#[test]
fn listener_forwards_raw_payload_and_env_then_apply_marks_running() {
    let dir = tempfile::tempdir().expect("temp");
    let socket_path = dir.path().join("tui-hook.sock");
    let listener = TuiHookListener::bind(&socket_path).expect("bind");
    assert_eq!(listener.path(), socket_path.as_path());
    let server = thread::spawn(move || listener.accept_one_line().expect("accept"));

    let connection = tui_hook_turn_tests::database();
    tui_hook_turn_tests::insert_session(
        &connection,
        SessionSeed {
            id: 41,
            agent_type: "codex",
            display_mode: "tui",
            status: "running",
            provider_session_id: None,
            is_turn_running: 0,
            turn_started_at: None,
            turn_ended_at: Some(1),
            current_turn_id: None,
            attention: "none",
        },
    );
    let repository = AgentSessionRepository::new(&connection);

    let raw = r#"{"hook_event_name":"UserPromptSubmit","session_id":"provider-1"}"#;
    let output = run_hook_command(
        "codex",
        raw,
        &socket_path,
        &HookCommandEnv {
            session_id: Some("41".to_string()),
            agent_kind: Some("codex".to_string()),
        },
    );
    assert_eq!(output.exit_code, 0);
    assert_eq!(output.stdout, "");
    let line = server.join().expect("server");

    let envelope = parse_hook_line(line.trim()).expect("envelope");
    assert_eq!(envelope.source, "codex");
    assert_eq!(envelope.session_id.as_deref(), Some("41"));
    assert_eq!(envelope.agent_kind.as_deref(), Some("codex"));
    assert_eq!(
        envelope.payload["hook_event_name"].as_str(),
        Some("UserPromptSubmit")
    );

    let session_id = resolve_tui_hook_session(
        &repository,
        &TuiHookCorrelation {
            redwhisk_session_id: envelope
                .session_id
                .as_deref()
                .and_then(|value| value.parse().ok()),
            agent_kind: Some(super::tui_hook_turn::TuiHookSource::Codex),
            payload: envelope.payload.clone(),
        },
    )
    .expect("resolve")
    .expect("matched");
    let outcome = apply_tui_hook_event(
        &repository,
        &super::tui_hook_turn::ResolvedTuiHookEvent {
            session_id,
            source: super::tui_hook_turn::TuiHookSource::Codex,
            event_name: envelope.payload["hook_event_name"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            payload: envelope.payload,
        },
        2_000,
    )
    .expect("apply");
    assert!(outcome.changed);
}

#[test]
fn socket_roundtrip_does_not_write_stdout() {
    let dir = tempfile::tempdir().expect("temp");
    let socket_path = dir.path().join("tui-hook.sock");
    let listener = TuiHookListener::bind(&socket_path).expect("bind");
    let server = thread::spawn(move || listener.accept_one_line().expect("accept"));
    let output = run_hook_command(
        "grok",
        r#"{"hook_event_name":"Stop"}"#,
        &socket_path,
        &HookCommandEnv::default(),
    );
    let _ = server.join();
    assert_eq!(output.exit_code, 0);
    assert_eq!(output.stdout, "");
}

#[test]
fn socket_path_sits_beside_sqlite_in_the_data_dir() {
    let data_dir = std::path::PathBuf::from("/tmp/redwhisk-data");
    let path = tui_hook_socket_path(&data_dir);
    assert_eq!(path, data_dir.join("tui-hook.sock"));
    assert_eq!(
        path.parent(),
        Some(std::path::Path::new("/tmp/redwhisk-data"))
    );
}

#[test]
fn listener_bind_failure_is_queryable_as_unavailable() {
    let dir = tempfile::tempdir().expect("temp");
    let path = dir.path().join("tui-hook.sock");
    let _held = UnixListener::bind(&path).expect("hold");
    let channel = TuiHookChannel::start(&path);
    assert_eq!(channel.status(), TuiHookChannelStatus::Unavailable);
    assert!(channel.listener().is_none());
}
