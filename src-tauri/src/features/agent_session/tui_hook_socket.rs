//! hook 命令与本机 Unix socket。
//!
//! 命令不做业务判断：把 stdin 原样带上 source 与调用方给出的环境交给 listener。
//! socket 拒绝时 exit 0、stdout 为空。无法解析的 JSON 由 listener 丢弃。

use std::fs;
use std::io::{self, ErrorKind, Read, Write};
use std::net::Shutdown;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

pub const TUI_HOOK_SOCKET_FILE_NAME: &str = "tui-hook.sock";

pub fn tui_hook_socket_path(data_dir: &Path) -> PathBuf {
    data_dir.join(TUI_HOOK_SOCKET_FILE_NAME)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookCommandOutput {
    pub exit_code: i32,
    pub stdout: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HookCommandEnv {
    pub session_id: Option<String>,
    pub agent_kind: Option<String>,
}

/// listener 收到的一行。字段原样保留，不在这里做 turn 判断。
#[derive(Debug, Clone, PartialEq)]
pub struct TuiHookEnvelope {
    pub source: String,
    pub payload: Value,
    pub session_id: Option<String>,
    pub agent_kind: Option<String>,
}

/// 本机状态通道是否可被后续设置查询。绑定失败为不可用。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TuiHookChannelStatus {
    Available,
    Unavailable,
}

pub struct TuiHookChannel {
    status: TuiHookChannelStatus,
    listener: Option<TuiHookListener>,
}

impl TuiHookChannel {
    pub fn start(path: &Path) -> Self {
        match TuiHookListener::bind(path) {
            Ok(listener) => Self {
                status: TuiHookChannelStatus::Available,
                listener: Some(listener),
            },
            Err(_) => Self {
                status: TuiHookChannelStatus::Unavailable,
                listener: None,
            },
        }
    }

    pub fn status(&self) -> TuiHookChannelStatus {
        self.status
    }

    pub fn listener(&self) -> Option<&TuiHookListener> {
        self.listener.as_ref()
    }

    pub fn into_listener(mut self) -> Option<TuiHookListener> {
        self.listener.take()
    }
}

pub struct TuiHookListener {
    listener: UnixListener,
    path: PathBuf,
}

impl TuiHookListener {
    pub fn bind(path: &Path) -> io::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let listener = UnixListener::bind(path)?;
        Ok(Self {
            listener,
            path: path.to_path_buf(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// 接受一条短连接并读出第一行。
    pub fn accept_next_line(&self) -> io::Result<String> {
        let (mut stream, _) = self.listener.accept()?;
        let mut buf = Vec::new();
        stream.read_to_end(&mut buf)?;
        let text = String::from_utf8_lossy(&buf);
        Ok(text.lines().next().unwrap_or("").to_string())
    }

    pub fn accept_one_line(&self) -> io::Result<String> {
        self.accept_next_line()
    }

    /// 处理已经读到的一行：坏 JSON 丢弃；能解析则交给 `on_envelope`。
    pub fn dispatch_line(line: &str, mut on_envelope: impl FnMut(TuiHookEnvelope)) {
        if let Some(envelope) = parse_hook_line(line) {
            on_envelope(envelope);
        }
    }
}

impl Drop for TuiHookListener {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// `--source codex|grok`。读完 stdin，向 socket 送一行 JSON。连不上则 exit 0。
pub fn run_hook_command(
    source: &str,
    stdin: &str,
    socket_path: &Path,
    env: &HookCommandEnv,
) -> HookCommandOutput {
    let Ok(line) = encode_hook_line(
        source,
        stdin,
        env.session_id.as_deref(),
        env.agent_kind.as_deref(),
    ) else {
        return empty_success();
    };
    let Ok(mut stream) = UnixStream::connect(socket_path) else {
        return empty_success();
    };
    let _ = stream.write_all(line.as_bytes());
    let _ = stream.write_all(b"\n");
    let _ = stream.shutdown(Shutdown::Write);
    empty_success()
}

pub fn encode_hook_line(
    source: &str,
    raw_json: &str,
    session_id: Option<&str>,
    agent_kind: Option<&str>,
) -> io::Result<String> {
    let payload: Value = serde_json::from_str(raw_json)
        .map_err(|error| io::Error::new(ErrorKind::InvalidData, error))?;
    Ok(json!({
        "source": source,
        "payload": payload,
        "sessionId": session_id,
        "agentKind": agent_kind,
    })
    .to_string())
}

pub fn hook_event_name(payload: &Value) -> Option<String> {
    for key in ["hook_event_name", "hookEventName"] {
        if let Some(value) = payload.get(key).and_then(Value::as_str) {
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

pub fn parse_hook_line(line: &str) -> Option<TuiHookEnvelope> {
    let value: Value = serde_json::from_str(line.trim()).ok()?;
    let source = value.get("source")?.as_str()?.to_string();
    let payload = value.get("payload")?.clone();
    if !payload.is_object() {
        return None;
    }
    Some(TuiHookEnvelope {
        source,
        payload,
        session_id: value
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string),
        agent_kind: value
            .get("agentKind")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn empty_success() -> HookCommandOutput {
    HookCommandOutput {
        exit_code: 0,
        stdout: String::new(),
    }
}
