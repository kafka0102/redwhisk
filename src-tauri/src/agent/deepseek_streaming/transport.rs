//! `dsh --profile acp` 的 stdio JSON-RPC 传输。
//!
//! 只做帧读写：请求 id 关联、通知回调、子进程生命周期。业务映射在 session。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::{json, Value};

use crate::agent::provider_spawn::build_provider_command;

const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 14 * 24 * 60 * 60 * 1000;
const STDERR_BUFFER_LIMIT: usize = 8192;

#[derive(Debug, thiserror::Error)]
pub enum DeepSeekStreamingError {
    #[error("dsh 二进制未找到：{0}")]
    BinaryNotFound(String),
    #[error("启动 dsh --profile acp 失败：{0}")]
    SpawnFailed(String),
    #[error("dsh ACP 请求超时（method={method}）")]
    RequestTimeout { method: String },
    #[error("dsh ACP 返回错误：{message}")]
    ServerError { message: String },
    #[error("dsh ACP 通道已关闭：{0}")]
    Closed(String),
    #[error("dsh ACP 协议错误：{0}")]
    Protocol(String),
    #[error("dsh ACP 请求序列化失败：{0}")]
    Serialize(#[from] serde_json::Error),
    #[error("dsh ACP IO 错误：{0}")]
    Io(#[from] std::io::Error),
}

pub type NotificationHandler = Arc<dyn Fn(&str, &Value) + Send + Sync>;

struct PendingRequest {
    sender: Option<mpsc::Sender<Result<Value, DeepSeekStreamingError>>>,
}

struct TransportState {
    pending: Mutex<HashMap<i64, PendingRequest>>,
    notification_handler: Mutex<Option<NotificationHandler>>,
    stderr_buffer: Mutex<String>,
    closed: Mutex<Option<String>>,
    next_id: AtomicI64,
    stdin: Mutex<Option<ChildStdin>>,
}

/// 长驻 ACP 子进程。
#[derive(Clone)]
pub struct DeepSeekStreamingTransport {
    state: Arc<TransportState>,
    child: Arc<Mutex<Option<Child>>>,
}

impl DeepSeekStreamingTransport {
    pub fn spawn(
        program: &str,
        args: &[String],
        cwd: Option<&str>,
    ) -> Result<Self, DeepSeekStreamingError> {
        if program.is_empty() {
            return Err(DeepSeekStreamingError::SpawnFailed(
                "dsh binary 不能为空".into(),
            ));
        }
        let mut command = build_provider_command(program, args);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }
        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                DeepSeekStreamingError::BinaryNotFound(format!("{program}: {error}"))
            } else {
                DeepSeekStreamingError::SpawnFailed(error.to_string())
            }
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| DeepSeekStreamingError::SpawnFailed("子进程未提供 stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| DeepSeekStreamingError::SpawnFailed("子进程未提供 stdout".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| DeepSeekStreamingError::SpawnFailed("子进程未提供 stderr".into()))?;
        let state = Arc::new(TransportState {
            pending: Mutex::new(HashMap::new()),
            notification_handler: Mutex::new(None),
            stderr_buffer: Mutex::new(String::new()),
            closed: Mutex::new(None),
            next_id: AtomicI64::new(1),
            stdin: Mutex::new(Some(stdin)),
        });
        let child = Arc::new(Mutex::new(Some(child)));
        spawn_stdout_reader(stdout, Arc::clone(&state), Arc::clone(&child));
        spawn_stderr_reader(stderr, Arc::clone(&state));
        Ok(Self { state, child })
    }

    pub fn set_notification_handler(&self, handler: NotificationHandler) {
        if let Ok(mut guard) = self.state.notification_handler.lock() {
            *guard = Some(handler);
        }
    }

    pub fn is_closed(&self) -> bool {
        self.state
            .closed
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(true)
    }

    pub fn request(&self, method: &str, params: Value) -> Result<Value, DeepSeekStreamingError> {
        self.request_with_timeout(method, params, DEFAULT_REQUEST_TIMEOUT_MS)
    }

    pub fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout_ms: u64,
    ) -> Result<Value, DeepSeekStreamingError> {
        if let Ok(closed) = self.state.closed.lock() {
            if let Some(message) = closed.as_ref() {
                return Err(DeepSeekStreamingError::Closed(format!(
                    "dsh ACP 已退出：{message}"
                )));
            }
        }
        let id = self.state.next_id.fetch_add(1, Ordering::SeqCst);
        let payload = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        let (tx, rx) = mpsc::channel::<Result<Value, DeepSeekStreamingError>>();
        {
            let mut pending = self
                .state
                .pending
                .lock()
                .map_err(|_| DeepSeekStreamingError::Protocol("pending 锁中毒".into()))?;
            pending.insert(id, PendingRequest { sender: Some(tx) });
        }
        self.write_line(&payload)?;
        match rx.recv_timeout(std::time::Duration::from_millis(timeout_ms)) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.remove_pending(id);
                Err(DeepSeekStreamingError::RequestTimeout {
                    method: method.to_string(),
                })
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.remove_pending(id);
                Err(DeepSeekStreamingError::Closed(
                    "dsh ACP 读线程已退出".into(),
                ))
            }
        }
    }

    /// 发送 JSON-RPC 通知（无 id，不等待响应）。ACP `session/cancel` 是通知。
    pub fn notify(&self, method: &str, params: Value) -> Result<(), DeepSeekStreamingError> {
        if self.is_closed() {
            return Err(DeepSeekStreamingError::Closed(
                "dsh ACP 已关闭，notify 被丢弃".into(),
            ));
        }
        self.write_line(&json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }))
    }

    pub fn shutdown(&self) {
        if let Ok(mut closed) = self.state.closed.lock() {
            if closed.is_none() {
                *closed = Some("客户端主动关闭".to_string());
            }
        }
        if let Ok(mut stdin_guard) = self.state.stdin.lock() {
            stdin_guard.take();
        }
        if let Ok(mut pending) = self.state.pending.lock() {
            for (_, mut entry) in pending.drain() {
                if let Some(sender) = entry.sender.take() {
                    let _ = sender.send(Err(DeepSeekStreamingError::Closed(
                        "dsh ACP 主动关闭".into(),
                    )));
                }
            }
        }
        if let Ok(mut child_guard) = self.child.lock() {
            if let Some(mut child) = child_guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    fn write_line(&self, value: &Value) -> Result<(), DeepSeekStreamingError> {
        let mut line = serde_json::to_string(value)?;
        line.push('\n');
        let mut stdin_guard = self
            .state
            .stdin
            .lock()
            .map_err(|_| DeepSeekStreamingError::Protocol("stdin 锁中毒".into()))?;
        let stdin = stdin_guard
            .as_mut()
            .ok_or_else(|| DeepSeekStreamingError::Closed("dsh ACP stdin 已关闭".into()))?;
        stdin.write_all(line.as_bytes())?;
        stdin.flush()?;
        Ok(())
    }

    fn remove_pending(&self, id: i64) {
        if let Ok(mut pending) = self.state.pending.lock() {
            pending.remove(&id);
        }
    }
}

impl Drop for DeepSeekStreamingTransport {
    fn drop(&mut self) {
        if Arc::strong_count(&self.child) == 1 {
            self.shutdown();
        }
    }
}

fn spawn_stdout_reader(
    stdout: ChildStdout,
    state: Arc<TransportState>,
    child: Arc<Mutex<Option<Child>>>,
) {
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            dispatch_message(&state, value);
        }
        mark_closed(&state);
        if let Ok(mut guard) = child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.wait();
            }
        }
    });
}

fn mark_closed(state: &TransportState) {
    if let Ok(mut closed) = state.closed.lock() {
        if closed.is_none() {
            *closed = Some("stdout EOF".to_string());
        }
    }
    if let Ok(mut pending) = state.pending.lock() {
        for (_, mut entry) in pending.drain() {
            if let Some(sender) = entry.sender.take() {
                let _ = sender.send(Err(DeepSeekStreamingError::Closed(
                    "dsh ACP stdout 关闭".into(),
                )));
            }
        }
    }
}

fn spawn_stderr_reader(stderr: ChildStderr, state: Arc<TransportState>) {
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for chunk in reader.lines() {
            let Ok(chunk) = chunk else { break };
            if let Ok(mut buffer) = state.stderr_buffer.lock() {
                buffer.push_str(&chunk);
                buffer.push('\n');
                if buffer.len() > STDERR_BUFFER_LIMIT {
                    let start = buffer.len() - STDERR_BUFFER_LIMIT;
                    buffer.drain(..start);
                }
            }
        }
    });
}

fn dispatch_message(state: &TransportState, value: Value) {
    let id = value.get("id").and_then(Value::as_i64);
    let method = value
        .get("method")
        .and_then(Value::as_str)
        .map(str::to_string);
    match (id, method) {
        (Some(_), Some(_)) => {}
        (Some(id), None) => dispatch_response(state, id, value),
        (None, Some(method)) => dispatch_notification(state, &method, &value),
        (None, None) => {}
    }
}

fn dispatch_response(state: &TransportState, id: i64, value: Value) {
    let mut pending = match state.pending.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    let Some(mut entry) = pending.remove(&id) else {
        return;
    };
    let result = if let Some(error) = value.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Unknown error")
            .to_string();
        Err(DeepSeekStreamingError::ServerError { message })
    } else {
        Ok(value.get("result").cloned().unwrap_or(Value::Null))
    };
    if let Some(sender) = entry.sender.take() {
        let _ = sender.send(result);
    }
}

fn dispatch_notification(state: &TransportState, method: &str, value: &Value) {
    let params = value.get("params").cloned().unwrap_or(Value::Null);
    if let Ok(guard) = state.notification_handler.lock() {
        if let Some(handler) = guard.as_ref() {
            handler(method, &params);
        }
    }
}
