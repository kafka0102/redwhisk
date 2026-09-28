//! `grok agent stdio` 子进程传输层（ACP：JSON-RPC 2.0 over stdio）。
//!
//! 与 `codex app-server` 同形态：长驻进程 + 按行分隔 JSON，三种消息按字段区分：
//! - Response：含 `id`（数字）+ `result` 或 `error`
//! - Request（server→client，如权限反向请求）：含 `id` + `method` —— 本期忽略
//! - Notification：含 `method`，无 `id`
//!
//! 本模块只做 wire-level 工作：请求 id 关联、响应分发、通知回调、
//! 子进程生命周期与 stderr 诊断尾巴。业务语义由 `session` 归一化。
//!
//! PATH / spawn 复用 [`crate::agent::provider_spawn`]（唯一来源 `command_detector`）。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::{json, Value};

use crate::agent::provider_spawn::{build_provider_command, split_command_line};

/// 默认请求超时（14 天）：ACP 的 `session/prompt` 可能长时间不返回，
/// 该值仅兜底死循环，不用于业务超时。
const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 14 * 24 * 60 * 60 * 1000;
const STDERR_BUFFER_LIMIT: usize = 8192;
pub(crate) const CLIENT_INITIATED_CLOSE_REASON: &str = "客户端主动关闭";
const STDOUT_EOF_REASON: &str = "stdout EOF";

/// 传输层错误。
#[derive(Debug, thiserror::Error)]
pub enum GrokStreamingError {
    #[error("grok 二进制未找到：{0}")]
    BinaryNotFound(String),
    #[error("启动 grok agent stdio 失败：{0}")]
    SpawnFailed(String),
    #[error("grok agent stdio 请求超时（method={method}）")]
    RequestTimeout { method: String },
    #[error("grok agent stdio 返回错误：{message}")]
    ServerError { message: String },
    #[error("grok agent stdio 通道已关闭：{0}")]
    Closed(String),
    #[error("grok agent stdio 协议错误：{0}")]
    Protocol(String),
    #[error("grok agent stdio 请求序列化失败：{0}")]
    Serialize(#[from] serde_json::Error),
    #[error("grok agent stdio IO 错误：{0}")]
    Io(#[from] std::io::Error),
}

/// notification 回调：`(method, params)`。
pub type NotificationHandler = Arc<dyn Fn(&str, &Value) + Send + Sync>;

struct PendingRequest {
    sender: Option<mpsc::Sender<Result<Value, GrokStreamingError>>>,
}

struct TransportState {
    pending: Mutex<HashMap<i64, PendingRequest>>,
    notification_handler: Mutex<Option<NotificationHandler>>,
    stderr_buffer: Mutex<String>,
    closed: Mutex<Option<String>>,
    eof_sender: Mutex<Option<mpsc::Sender<String>>>,
    next_id: AtomicI64,
    stdin: Mutex<Option<ChildStdin>>,
}

/// `grok agent stdio` 长驻子进程传输层。
#[derive(Clone)]
pub struct GrokStreamingTransport {
    state: Arc<TransportState>,
    child: Arc<Mutex<Option<Child>>>,
}

impl GrokStreamingTransport {
    /// 启动 `grok agent stdio` 子进程。
    ///
    /// `program` 为可执行首段（结构化参数由 adapter 重建后经 `args` 传入）；
    /// `cwd` 透传给子进程。
    pub fn spawn(
        program: &str,
        args: &[String],
        cwd: Option<&str>,
    ) -> Result<Self, GrokStreamingError> {
        let (program, preset) = split_command_line(program);
        if program.is_empty() {
            return Err(GrokStreamingError::SpawnFailed(
                "grok binary 不能为空".into(),
            ));
        }
        let mut all_args = preset.into_iter().map(str::to_string).collect::<Vec<_>>();
        all_args.extend(args.iter().cloned());

        let mut command = build_provider_command(program, &all_args);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }

        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                GrokStreamingError::BinaryNotFound(format!("{program}: {error}"))
            } else {
                GrokStreamingError::SpawnFailed(error.to_string())
            }
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| GrokStreamingError::SpawnFailed("子进程未提供 stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| GrokStreamingError::SpawnFailed("子进程未提供 stdout".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| GrokStreamingError::SpawnFailed("子进程未提供 stderr".into()))?;

        let state = Arc::new(TransportState {
            pending: Mutex::new(HashMap::new()),
            notification_handler: Mutex::new(None),
            stderr_buffer: Mutex::new(String::new()),
            closed: Mutex::new(None),
            eof_sender: Mutex::new(None),
            next_id: AtomicI64::new(1),
            stdin: Mutex::new(Some(stdin)),
        });
        let child = Arc::new(Mutex::new(Some(child)));

        spawn_stdout_reader(stdout, Arc::clone(&state), Arc::clone(&child));
        spawn_stderr_reader(stderr, Arc::clone(&state));

        Ok(Self { state, child })
    }

    /// 注册 notification 回调（覆盖式；整 session 只有一个消费者）。
    pub fn set_notification_handler(&self, handler: NotificationHandler) {
        if let Ok(mut guard) = self.state.notification_handler.lock() {
            *guard = Some(handler);
        }
    }

    /// 订阅子进程 stdout EOF，用于异常退出收尾。
    pub fn subscribe_eof(&self) -> mpsc::Receiver<String> {
        let (tx, rx) = mpsc::channel();
        if let Ok(mut guard) = self.state.eof_sender.lock() {
            *guard = Some(tx);
        }
        rx
    }

    pub fn stderr_tail(&self) -> String {
        self.state
            .stderr_buffer
            .lock()
            .map(|buffer| buffer.clone())
            .unwrap_or_default()
    }

    pub fn is_closed(&self) -> bool {
        self.state
            .closed
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(true)
    }

    /// 发送 JSON-RPC 请求并等待响应（默认超时 14 天）。
    pub fn request(&self, method: &str, params: Value) -> Result<Value, GrokStreamingError> {
        self.request_with_timeout(method, params, DEFAULT_REQUEST_TIMEOUT_MS)
    }

    pub fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout_ms: u64,
    ) -> Result<Value, GrokStreamingError> {
        if let Ok(closed) = self.state.closed.lock() {
            if let Some(message) = closed.as_ref() {
                return Err(GrokStreamingError::Closed(format!(
                    "grok agent stdio 已退出：{message}"
                )));
            }
        }

        let id = self.state.next_id.fetch_add(1, Ordering::SeqCst);
        let payload = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let (tx, rx) = mpsc::channel::<Result<Value, GrokStreamingError>>();
        {
            let mut pending = self
                .state
                .pending
                .lock()
                .map_err(|_| GrokStreamingError::Protocol("pending 锁中毒".into()))?;
            pending.insert(id, PendingRequest { sender: Some(tx) });
        }

        self.write_line(&payload)?;

        match rx.recv_timeout(std::time::Duration::from_millis(timeout_ms)) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.remove_pending(id);
                Err(GrokStreamingError::RequestTimeout {
                    method: method.to_string(),
                })
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.remove_pending(id);
                Err(GrokStreamingError::Closed(
                    "grok agent stdio 读线程已退出".into(),
                ))
            }
        }
    }

    /// 发送 JSON-RPC 通知（无 id，不等待响应）。
    pub fn notify(&self, method: &str, params: Value) -> Result<(), GrokStreamingError> {
        if self.is_closed() {
            return Err(GrokStreamingError::Closed(
                "grok agent stdio 已关闭，notify 被丢弃".into(),
            ));
        }
        self.write_line(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }

    /// 关闭会话：关闭 stdin → kill 子进程 → 唤醒等待中的请求。
    pub fn shutdown(&self) {
        if let Ok(mut closed) = self.state.closed.lock() {
            if closed.is_none() {
                *closed = Some(CLIENT_INITIATED_CLOSE_REASON.to_string());
            }
        }
        if let Ok(mut stdin_guard) = self.state.stdin.lock() {
            stdin_guard.take();
        }
        if let Ok(mut pending) = self.state.pending.lock() {
            for (_, mut entry) in pending.drain() {
                if let Some(sender) = entry.sender.take() {
                    let _ = sender.send(Err(GrokStreamingError::Closed(
                        "grok agent stdio 主动关闭".into(),
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

    fn write_line(&self, value: &Value) -> Result<(), GrokStreamingError> {
        let mut line = serde_json::to_string(value)?;
        line.push('\n');
        let mut stdin_guard = self
            .state
            .stdin
            .lock()
            .map_err(|_| GrokStreamingError::Protocol("stdin 锁中毒".into()))?;
        let stdin = stdin_guard
            .as_mut()
            .ok_or_else(|| GrokStreamingError::Closed("grok agent stdio stdin 已关闭".into()))?;
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

impl Drop for GrokStreamingTransport {
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
            let line = match line {
                Ok(line) => line,
                Err(_) => break,
            };
            if line.trim().is_empty() {
                continue;
            }
            let value: Value = match serde_json::from_str(&line) {
                Ok(value) => value,
                // 未知/畸形行按宽容处理：跳过而非中断整个流。
                Err(_) => continue,
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
    let reason = {
        let mut closed = match state.closed.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if closed.is_none() {
            *closed = Some(STDOUT_EOF_REASON.to_string());
        }
        closed.clone().unwrap_or_else(|| STDOUT_EOF_REASON.to_string())
    };
    if let Ok(mut pending) = state.pending.lock() {
        for (_, mut entry) in pending.drain() {
            if let Some(sender) = entry.sender.take() {
                let _ = sender.send(Err(GrokStreamingError::Closed(
                    "grok agent stdio stdout 关闭".into(),
                )));
            }
        }
    }
    if let Ok(mut eof_sender) = state.eof_sender.lock() {
        if let Some(sender) = eof_sender.take() {
            let _ = sender.send(reason);
        }
    }
}

fn spawn_stderr_reader(stderr: ChildStderr, state: Arc<TransportState>) {
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for chunk in reader.lines() {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(_) => break,
            };
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
    let method = value.get("method").and_then(Value::as_str);
    match (id, method) {
        (Some(_), Some(_)) => {
            // server→client request（如 session/request_permission）。
            // 本期不做可回复审批卡，忽略即可，不误发为 turn 事件。
        }
        (Some(id), None) => dispatch_response(state, id, value),
        (None, Some(method)) => dispatch_notification(state, method, &value),
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
        Err(GrokStreamingError::ServerError { message })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatch_classifies_response_request_and_notification() {
        let state = TransportState {
            pending: Mutex::new(HashMap::new()),
            notification_handler: Mutex::new(None),
            stderr_buffer: Mutex::new(String::new()),
            closed: Mutex::new(None),
            eof_sender: Mutex::new(None),
            next_id: AtomicI64::new(1),
            stdin: Mutex::new(None),
        };
        let (tx, rx) = mpsc::channel();
        state
            .pending
            .lock()
            .unwrap()
            .insert(7, PendingRequest { sender: Some(tx) });

        dispatch_message(
            &state,
            json!({"jsonrpc":"2.0","id":7,"result":{"sessionId":"s-1"}}),
        );
        assert_eq!(rx.recv().unwrap().unwrap()["sessionId"], "s-1");

        // 未注册的 server→client request 不应 panic、也不应写回响应。
        dispatch_message(
            &state,
            json!({"jsonrpc":"2.0","id":9,"method":"session/request_permission","params":{}}),
        );
    }

    #[test]
    fn dispatch_notification_forwards_method_and_params() {
        let received = Arc::new(Mutex::new(Vec::<(String, Value)>::new()));
        let sink = Arc::clone(&received);
        let state = TransportState {
            pending: Mutex::new(HashMap::new()),
            notification_handler: Mutex::new(Some(Arc::new(move |method: &str, params: &Value| {
                sink.lock()
                    .unwrap()
                    .push((method.to_string(), params.clone()));
            }))),
            stderr_buffer: Mutex::new(String::new()),
            closed: Mutex::new(None),
            eof_sender: Mutex::new(None),
            next_id: AtomicI64::new(1),
            stdin: Mutex::new(None),
        };

        dispatch_message(
            &state,
            json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s-1"}}),
        );

        let guard = received.lock().unwrap();
        assert_eq!(guard.len(), 1);
        assert_eq!(guard[0].0, "session/update");
        assert_eq!(guard[0].1["sessionId"], "s-1");
    }
}
