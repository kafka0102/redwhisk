//! `codex app-server` 子进程传输层。
//!
//! 负责子进程生命周期与 NDJSON over stdio 帧协议：
//! - stdout 每行是一个紧凑 JSON 对象 + `\n`
//! - 三种 JSON-RPC 消息通过字段区分：
//!   - Response：含 `id`（数字）+ `result` 或 `error`
//!   - Request（server→client）：含 `id` + `method`（用于审批、用户输入）
//!   - Notification：含 `method`，无 `id`
//!
//! 本模块只做 wire-level 工作，不做业务语义。上层 `client` / `session`
//! 负责把通知归一化为 `AgentStreamEvent`，把审批 request 转成
//! `AgentPermissionRequest`。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::Value;

/// 默认请求超时（与 paseo 一致：14 天，等价于不超时，仅兜底死循环）。
const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 14 * 24 * 60 * 60 * 1000;
/// stderr 缓冲上限，避免内存膨胀；保留尾部用于诊断。
const STDERR_BUFFER_LIMIT: usize = 8192;

/// 传输层错误。
#[derive(Debug, thiserror::Error)]
pub enum CodexAppServerError {
    #[error("codex app-server 二进制未找到：{0}")]
    BinaryNotFound(String),
    #[error("启动 codex app-server 失败：{0}")]
    SpawnFailed(String),
    #[error("codex app-server 请求超时（method={method}）")]
    RequestTimeout { method: String },
    #[error("codex app-server 返回错误：{message}")]
    ServerError { message: String },
    #[error("codex app-server 通道已关闭：{0}")]
    Closed(String),
    #[error("codex app-server 协议错误：{0}")]
    Protocol(String),
    #[error("codex app-server 请求序列化失败：{0}")]
    Serialize(#[from] serde_json::Error),
    #[error("codex app-server IO 错误：{0}")]
    Io(#[from] std::io::Error),
}

/// server→client request 的处理函数。
///
/// 处理函数返回 `Ok(value)` 时，传输层把 `{id, result: value}` 写回 stdin；
/// 返回 `Err` 时写回 `{id, error: {message}}`。
pub type RequestHandler = Arc<dyn Fn(Value) -> Result<Value, CodexAppServerError> + Send + Sync>;

/// notification 回调。
pub type NotificationHandler = Arc<dyn Fn(&str, &Value) + Send + Sync>;

/// 一个待处理请求的应答通道。
struct PendingRequest {
    sender: Option<mpsc::Sender<Result<Value, CodexAppServerError>>>,
}

struct TransportState {
    pending: Mutex<HashMap<i64, PendingRequest>>,
    request_handlers: Mutex<HashMap<String, RequestHandler>>,
    notification_handler: Mutex<Option<NotificationHandler>>,
    /// stderr 尾部缓冲，进程退出时拼进错误消息。
    stderr_buffer: Mutex<String>,
    next_id: AtomicI64,
    stdin: Mutex<Option<ChildStdin>>,
    /// 进程已退出时填入错误消息，后续 request 立即失败。
    closed: Mutex<Option<String>>,
}

/// `codex app-server` 子进程传输层。
///
/// 持有子进程与读线程。`clone()` 共享底层状态（Arc），供多线程调用。
#[derive(Clone)]
pub struct CodexTransport {
    state: Arc<TransportState>,
    /// 子进程句柄，仅主实例持有，drop 时尝试 kill。
    child: Arc<Mutex<Option<Child>>>,
}

impl CodexTransport {
    /// 启动 `codex app-server` 子进程。
    ///
    /// `binary` 为 codex 可执行路径（通常 `codex`）；`cwd` 透传给子进程。
    /// 失败返回 `BinaryNotFound` / `SpawnFailed`。
    pub fn spawn(binary: &str, cwd: Option<&str>) -> Result<Self, CodexAppServerError> {
        let (program, args) = split_command_line(binary)?;
        let mut command = Command::new(program);
        command
            .args(args)
            .arg("app-server")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }

        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                CodexAppServerError::BinaryNotFound(format!("{binary}: {error}"))
            } else {
                CodexAppServerError::SpawnFailed(error.to_string())
            }
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| CodexAppServerError::SpawnFailed("子进程未提供 stdin".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| CodexAppServerError::SpawnFailed("子进程未提供 stdout".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| CodexAppServerError::SpawnFailed("子进程未提供 stderr".to_string()))?;

        let state = Arc::new(TransportState {
            pending: Mutex::new(HashMap::new()),
            request_handlers: Mutex::new(HashMap::new()),
            notification_handler: Mutex::new(None),
            stderr_buffer: Mutex::new(String::new()),
            next_id: AtomicI64::new(1),
            stdin: Mutex::new(Some(stdin)),
            closed: Mutex::new(None),
        });

        spawn_stdout_reader(stdout, Arc::clone(&state));
        spawn_stderr_reader(stderr, Arc::clone(&state));
        spawn_exit_watcher(Arc::clone(&state));

        Ok(Self {
            state,
            child: Arc::new(Mutex::new(Some(child))),
        })
    }

    /// 注册 notification 回调。覆盖式设置，整个 session 只有一个消费者。
    pub fn set_notification_handler(&self, handler: NotificationHandler) {
        if let Ok(mut guard) = self.state.notification_handler.lock() {
            *guard = Some(handler);
        }
    }

    /// 注册 server→client request 处理函数。
    pub fn set_request_handler(&self, method: &str, handler: RequestHandler) {
        if let Ok(mut guard) = self.state.request_handlers.lock() {
            guard.insert(method.to_string(), handler);
        }
    }

    /// 发送 JSON-RPC 请求并等待响应。
    ///
    /// 实现为：分配 id → 写入 stdin → 阻塞等待 mpsc 应答。超时由
    /// `timeout_ms` 控制，默认 14 天（等价于不超时）。
    pub fn request(&self, method: &str, params: Value) -> Result<Value, CodexAppServerError> {
        self.request_with_timeout(method, params, DEFAULT_REQUEST_TIMEOUT_MS)
    }

    pub fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout_ms: u64,
    ) -> Result<Value, CodexAppServerError> {
        if let Ok(closed) = self.state.closed.lock() {
            if let Some(message) = closed.as_ref() {
                return Err(CodexAppServerError::Closed(format!(
                    "codex app-server 已退出：{message}"
                )));
            }
        }

        let id = self.state.next_id.fetch_add(1, Ordering::SeqCst);
        let payload = serde_json::json!({
            "id": id,
            "method": method,
            "params": params,
        });

        let (tx, rx) = mpsc::channel::<Result<Value, CodexAppServerError>>();
        {
            let mut pending = self
                .state
                .pending
                .lock()
                .map_err(|_| CodexAppServerError::Protocol("pending 锁中毒".to_string()))?;
            pending.insert(id, PendingRequest { sender: Some(tx) });
        }

        self.write_line(&payload)?;

        match rx.recv_timeout(std::time::Duration::from_millis(timeout_ms)) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.remove_pending(id);
                Err(CodexAppServerError::RequestTimeout {
                    method: method.to_string(),
                })
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.remove_pending(id);
                Err(CodexAppServerError::Closed(
                    "codex app-server 读线程已退出".to_string(),
                ))
            }
        }
    }

    /// 发送 notification（无 id，无需等待应答）。
    pub fn notify(&self, method: &str, params: Value) -> Result<(), CodexAppServerError> {
        if self.is_closed() {
            return Err(CodexAppServerError::Closed(
                "codex app-server 已关闭，notify 被丢弃".to_string(),
            ));
        }
        let payload = serde_json::json!({
            "method": method,
            "params": params,
        });
        self.write_line(&payload)
    }

    /// 优雅关闭：关闭 stdin → 等待子进程退出 → 超时则 kill。
    pub fn shutdown(&self) {
        // 标记关闭，阻止新请求写入。
        if let Ok(mut closed) = self.state.closed.lock() {
            if closed.is_none() {
                *closed = Some("客户端主动关闭".to_string());
            }
        }
        // 关闭 stdin 让子进程自然退出。
        if let Ok(mut stdin_guard) = self.state.stdin.lock() {
            stdin_guard.take();
        }
        // 唤醒所有等待中的请求。
        if let Ok(mut pending) = self.state.pending.lock() {
            for (_, mut entry) in pending.drain() {
                if let Some(sender) = entry.sender.take() {
                    let _ = sender.send(Err(CodexAppServerError::Closed(
                        "codex app-server 主动关闭".to_string(),
                    )));
                }
            }
        }
        // kill 子进程。
        if let Ok(mut child_guard) = self.child.lock() {
            if let Some(mut child) = child_guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    fn is_closed(&self) -> bool {
        self.state
            .closed
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(true)
    }

    fn write_line(&self, value: &Value) -> Result<(), CodexAppServerError> {
        let mut line = serde_json::to_string(value)?;
        line.push('\n');
        let mut stdin_guard = self
            .state
            .stdin
            .lock()
            .map_err(|_| CodexAppServerError::Protocol("stdin 锁中毒".to_string()))?;
        let stdin = stdin_guard.as_mut().ok_or_else(|| {
            CodexAppServerError::Closed("codex app-server stdin 已关闭".to_string())
        })?;
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

impl Drop for CodexTransport {
    fn drop(&mut self) {
        // 仅当最后一个 Arc 引用释放时执行关闭。
        if Arc::strong_count(&self.child) == 1 {
            self.shutdown();
        }
    }
}

fn split_command_line(command: &str) -> Result<(&str, Vec<&str>), CodexAppServerError> {
    let mut parts = command.split_whitespace();
    let program = parts.next().ok_or_else(|| {
        CodexAppServerError::SpawnFailed("codex app-server binary 不能为空".to_string())
    })?;
    Ok((program, parts.collect()))
}

fn spawn_stdout_reader(stdout: ChildStdout, state: Arc<TransportState>) {
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
                Err(_) => continue,
            };
            dispatch_message(&state, value);
        }
        // 读到 EOF，标记关闭并唤醒所有 pending。
        if let Ok(mut closed) = state.closed.lock() {
            if closed.is_none() {
                *closed = Some("stdout EOF".to_string());
            }
        }
        if let Ok(mut pending) = state.pending.lock() {
            for (_, mut entry) in pending.drain() {
                if let Some(sender) = entry.sender.take() {
                    let _ = sender.send(Err(CodexAppServerError::Closed(
                        "codex app-server stdout 关闭".to_string(),
                    )));
                }
            }
        }
    });
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

fn spawn_exit_watcher(state: Arc<TransportState>) {
    // 子进程的 wait 由 Drop 时的 kill + wait 负责；这里仅作占位，
    // 避免引入额外句柄复杂度。stdout EOF 已能覆盖进程退出感知。
    let _ = state;
}

fn dispatch_message(state: &TransportState, value: Value) {
    let is_response = value.get("id").and_then(Value::as_i64).is_some()
        && (value.get("result").is_some() || value.get("error").is_some());
    if is_response {
        dispatch_response(state, value);
        return;
    }

    let has_method = value.get("method").and_then(Value::as_str).is_some();
    let has_id = value.get("id").and_then(Value::as_i64).is_some();
    if has_method && has_id {
        // server→client request（审批、用户输入）
        dispatch_server_request(state, value);
        return;
    }

    if has_method {
        // notification
        dispatch_notification(state, value);
    }
}

fn dispatch_response(state: &TransportState, value: Value) {
    let id = match value.get("id").and_then(Value::as_i64) {
        Some(id) => id,
        None => return,
    };
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
        Err(CodexAppServerError::ServerError { message })
    } else {
        Ok(value.get("result").cloned().unwrap_or(Value::Null))
    };
    if let Some(sender) = entry.sender.take() {
        let _ = sender.send(result);
    }
}

fn dispatch_server_request(state: &TransportState, value: Value) {
    let id = match value.get("id").and_then(Value::as_i64) {
        Some(id) => id,
        None => return,
    };
    let method = match value.get("method").and_then(Value::as_str) {
        Some(method) => method.to_string(),
        None => return,
    };
    let params = value.get("params").cloned().unwrap_or(Value::Null);

    let handler = {
        let guard = match state.request_handlers.lock() {
            Ok(guard) => guard,
            Err(_) => {
                write_response(state, id, Err("request handler 锁中毒".to_string()));
                return;
            }
        };
        guard.get(&method).cloned()
    };

    let response_result = match handler {
        Some(handler) => (handler)(params).map_err(|error| error.to_string()),
        None => Err(format!("未注册的 server→client request: {method}")),
    };

    write_response(state, id, response_result);
}

fn write_response(state: &TransportState, id: i64, result: Result<Value, String>) {
    let payload = match result {
        Ok(value) => serde_json::json!({ "id": id, "result": value }),
        Err(message) => serde_json::json!({ "id": id, "error": { "message": message } }),
    };
    let mut line = match serde_json::to_string(&payload) {
        Ok(line) => line,
        Err(_) => return,
    };
    line.push('\n');
    if let Ok(mut stdin_guard) = state.stdin.lock() {
        if let Some(stdin) = stdin_guard.as_mut() {
            let _ = stdin.write_all(line.as_bytes());
            let _ = stdin.flush();
        }
    }
}

fn dispatch_notification(state: &TransportState, value: Value) {
    let method = match value.get("method").and_then(Value::as_str) {
        Some(method) => method.to_string(),
        None => return,
    };
    let params = value.get("params").cloned().unwrap_or(Value::Null);
    if let Ok(guard) = state.notification_handler.lock() {
        if let Some(handler) = guard.as_ref() {
            handler(&method, &params);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn dispatch_response_routes_result_to_pending() {
        let state = TransportState {
            pending: Mutex::new(HashMap::new()),
            request_handlers: Mutex::new(HashMap::new()),
            notification_handler: Mutex::new(None),
            stderr_buffer: Mutex::new(String::new()),
            next_id: AtomicI64::new(1),
            stdin: Mutex::new(None),
            closed: Mutex::new(None),
        };
        let state = Arc::new(state);

        let (tx, rx) = mpsc::channel();
        state
            .pending
            .lock()
            .unwrap()
            .insert(42, PendingRequest { sender: Some(tx) });

        dispatch_message(
            &state,
            json!({ "id": 42, "result": { "thread": { "id": "thr_1" } } }),
        );

        let result = rx.recv_timeout(std::time::Duration::from_secs(1)).unwrap();
        assert_eq!(result.unwrap()["thread"]["id"], "thr_1");
    }

    #[test]
    fn dispatch_response_routes_error_to_pending() {
        let state = TransportState {
            pending: Mutex::new(HashMap::new()),
            request_handlers: Mutex::new(HashMap::new()),
            notification_handler: Mutex::new(None),
            stderr_buffer: Mutex::new(String::new()),
            next_id: AtomicI64::new(1),
            stdin: Mutex::new(None),
            closed: Mutex::new(None),
        };
        let state = Arc::new(state);

        let (tx, rx) = mpsc::channel();
        state
            .pending
            .lock()
            .unwrap()
            .insert(7, PendingRequest { sender: Some(tx) });

        dispatch_message(&state, json!({ "id": 7, "error": { "message": "boom" } }));

        let result = rx.recv_timeout(std::time::Duration::from_secs(1)).unwrap();
        match result {
            Err(CodexAppServerError::ServerError { message }) => assert_eq!(message, "boom"),
            other => panic!("期望 ServerError，实际 {other:?}"),
        }
    }

    #[test]
    fn dispatch_notification_invokes_handler() {
        let state = TransportState {
            pending: Mutex::new(HashMap::new()),
            request_handlers: Mutex::new(HashMap::new()),
            notification_handler: Mutex::new(None),
            stderr_buffer: Mutex::new(String::new()),
            next_id: AtomicI64::new(1),
            stdin: Mutex::new(None),
            closed: Mutex::new(None),
        };
        let state = Arc::new(state);

        let captured: Arc<Mutex<Vec<(String, Value)>>> = Arc::new(Mutex::new(Vec::new()));
        let captured_for_handler = Arc::clone(&captured);
        let handler: NotificationHandler = Arc::new(move |method, params| {
            captured_for_handler
                .lock()
                .unwrap()
                .push((method.to_string(), params.clone()));
        });
        if let Ok(mut notification_handler) = state.notification_handler.lock() {
            *notification_handler = Some(handler);
        }

        dispatch_message(
            &state,
            json!({ "method": "turn/started", "params": { "turn": { "id": "t1" } } }),
        );

        let captured = captured.lock().unwrap();
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0].0, "turn/started");
        assert_eq!(captured[0].1["turn"]["id"], "t1");
    }
}
