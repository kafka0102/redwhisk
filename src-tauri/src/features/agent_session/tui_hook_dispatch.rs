//! 本机 hook socket 的接受循环。业务判断只调用 ticket 01 的 resolve / apply。

use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::tui_hook_socket::{
    hook_event_name, parse_hook_line, run_hook_command, tui_hook_socket_path, HookCommandEnv,
    TuiHookChannel, TuiHookChannelStatus, TuiHookEnvelope, TuiHookListener,
};
use super::tui_hook_turn::{
    apply_tui_hook_event, resolve_tui_hook_session, ResolvedTuiHookEvent, TuiHookCorrelation,
    TuiHookCorrelationFailure, TuiHookSource,
};
use crate::agent::agent_event_broadcaster::AGENT_SESSION_LIST_CHANGED_EVENT;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::connection::DatabaseConfig;
use crate::local_data_path::{redwhisk_data_dir, redwhisk_data_dir_from_home};

static UNMATCHED_TUI_HOOK_EVENTS: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentSessionListChangedPayload {
    project_id: i64,
    session_id: Option<i64>,
    reason: &'static str,
}

/// 应用启动时绑定。失败返回 false，调用方记成通道不可用。
pub(crate) fn spawn_tui_hook_listener(app: AppHandle) -> bool {
    let Ok(data_dir) = redwhisk_data_dir(&app) else {
        return false;
    };
    let channel = TuiHookChannel::start(&tui_hook_socket_path(&data_dir));
    if channel.status() != TuiHookChannelStatus::Available {
        return false;
    }
    let Some(listener) = channel.into_listener() else {
        return false;
    };
    thread::spawn(move || serve(listener, app, data_dir));
    true
}

fn serve(listener: TuiHookListener, app: AppHandle, data_dir: PathBuf) {
    let Ok(database) = DatabaseConfig::new(&data_dir).open() else {
        eprintln!("[tui_hook] 打开数据库失败，本机状态通道停止");
        return;
    };
    let repository = AgentSessionRepository::new(&database.connection);
    loop {
        let line = match listener.accept_next_line() {
            Ok(line) => line,
            Err(_) => {
                thread::sleep(Duration::from_millis(200));
                continue;
            }
        };
        if let Err(error) = handle_hook_line(&repository, &app, &line) {
            eprintln!("[tui_hook] 处理 hook 事件失败：{error}");
        }
    }
}

fn handle_hook_line(
    repository: &AgentSessionRepository<'_>,
    app: &AppHandle,
    line: &str,
) -> rusqlite::Result<()> {
    let Some(envelope) = parse_hook_line(line) else {
        return Ok(());
    };
    let Some(source) = source_from_name(&envelope.source) else {
        return Ok(());
    };
    let Some(event_name) = hook_event_name(&envelope.payload) else {
        return Ok(());
    };
    let correlation = TuiHookCorrelation {
        redwhisk_session_id: parse_session_id(envelope.session_id.as_deref()),
        agent_kind: envelope.agent_kind.as_deref().and_then(source_from_name),
        payload: envelope.payload.clone(),
    };
    match resolve_tui_hook_session(repository, &correlation)? {
        Ok(session_id) => {
            apply_resolved(repository, app, session_id, source, &event_name, &envelope)
        }
        Err(TuiHookCorrelationFailure::Unmatched) => {
            UNMATCHED_TUI_HOOK_EVENTS.fetch_add(1, Ordering::Relaxed);
            Ok(())
        }
    }
}

fn apply_resolved(
    repository: &AgentSessionRepository<'_>,
    app: &AppHandle,
    session_id: i64,
    source: TuiHookSource,
    event_name: &str,
    envelope: &TuiHookEnvelope,
) -> rusqlite::Result<()> {
    let outcome = apply_tui_hook_event(
        repository,
        &ResolvedTuiHookEvent {
            session_id,
            source,
            event_name: event_name.to_string(),
            payload: envelope.payload.clone(),
        },
        now_ms(),
    )?;
    let Some(reason) = outcome.list_changed_reason else {
        return Ok(());
    };
    let Some(project_id) = repository.find_session_project_id(session_id)? else {
        return Ok(());
    };
    let _ = app.emit(
        AGENT_SESSION_LIST_CHANGED_EVENT,
        AgentSessionListChangedPayload {
            project_id,
            session_id: Some(session_id),
            reason,
        },
    );
    Ok(())
}

fn source_from_name(name: &str) -> Option<TuiHookSource> {
    match name {
        "codex" => Some(TuiHookSource::Codex),
        "grok" => Some(TuiHookSource::Grok),
        _ => None,
    }
}

fn parse_session_id(value: Option<&str>) -> Option<i64> {
    value?.parse().ok()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// `redwhisk hook --source codex|grok`。socket 拒绝时 exit 0，stdout 为空。
pub fn run_tui_hook_command_from_process() -> i32 {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let source = source_flag(&args).unwrap_or("");
    let mut stdin = String::new();
    let _ = io::stdin().read_to_string(&mut stdin);
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    let socket = tui_hook_socket_path(&redwhisk_data_dir_from_home(home));
    let env = HookCommandEnv {
        session_id: std::env::var("REDWHISK_SESSION_ID").ok(),
        agent_kind: std::env::var("REDWHISK_AGENT_KIND").ok(),
    };
    let output = run_hook_command(source, &stdin, &socket, &env);
    let _ = io::stdout().write_all(output.stdout.as_bytes());
    output.exit_code
}

fn source_flag(args: &[String]) -> Option<&str> {
    args.iter().enumerate().find_map(|(index, arg)| {
        if let Some(value) = arg.strip_prefix("--source=") {
            return Some(value);
        }
        if arg == "--source" {
            return args.get(index + 1).map(String::as_str);
        }
        None
    })
}
