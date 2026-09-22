use std::collections::HashMap;
use std::io::{BufReader, Read};
use std::process::ChildStdin;
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::protocol::{parse_project_load_signal, parse_publish_diagnostics, ProjectLoadSignal};
use super::readiness::Readiness;
use super::rpc::{read_rpc, write_rpc};
use crate::types::code_language::{CodeLanguageDiagnostic, CodeLanguageUnavailableReason};

pub(crate) const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(8);

pub type DiagnosticsListener = Arc<dyn Fn(String, Vec<CodeLanguageDiagnostic>) + Send + Sync>;
pub type PendingResponses = Arc<Mutex<HashMap<Value, mpsc::Sender<Value>>>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HandshakeState {
    Pending,
    Ready,
    Failed,
}

#[derive(Debug)]
struct HandshakeInner {
    state: Mutex<HandshakeState>,
    wake: Condvar,
}

/// LSP `initialize` 握手门闩：进程拉起后在后台完成，不堵住 `ensure` 调用方。
#[derive(Debug, Clone)]
pub(crate) struct Handshake {
    inner: Arc<HandshakeInner>,
}

impl Handshake {
    pub(crate) fn new() -> Self {
        Self {
            inner: Arc::new(HandshakeInner {
                state: Mutex::new(HandshakeState::Pending),
                wake: Condvar::new(),
            }),
        }
    }

    pub(crate) fn mark_ready(&self) {
        self.set(HandshakeState::Ready);
    }

    pub(crate) fn mark_failed(&self) {
        self.set(HandshakeState::Failed);
    }

    pub(crate) fn wait(&self, timeout: Duration) -> bool {
        let Ok(mut state) = self.inner.state.lock() else {
            return false;
        };
        let deadline = Instant::now() + timeout;
        loop {
            match *state {
                HandshakeState::Ready => return true,
                HandshakeState::Failed => return false,
                HandshakeState::Pending => {
                    let now = Instant::now();
                    if now >= deadline {
                        return false;
                    }
                    let remaining = deadline - now;
                    state = match self.inner.wake.wait_timeout(state, remaining) {
                        Ok((guard, _)) => guard,
                        Err(_) => return false,
                    };
                }
            }
        }
    }

    fn set(&self, next: HandshakeState) {
        let Ok(mut state) = self.inner.state.lock() else {
            return;
        };
        *state = next;
        drop(state);
        self.inner.wake.notify_all();
    }
}

pub fn handshake_and_listen(
    stdin: Arc<Mutex<ChildStdin>>,
    stdout: impl Read + Send + 'static,
    initialize: Value,
    on_diagnostics: DiagnosticsListener,
    pending: PendingResponses,
    readiness: Arc<Readiness>,
    handshake: Handshake,
) -> Result<(), CodeLanguageUnavailableReason> {
    let reader_stdin = Arc::clone(&stdin);
    let handshake_for_reader = handshake.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        match read_initialize_result(&mut reader) {
            Ok(_) => {
                let initialized = json!({
                    "jsonrpc": "2.0",
                    "method": "initialized",
                    "params": {}
                });
                if write_locked(&reader_stdin, &initialized).is_err() {
                    handshake_for_reader.mark_failed();
                    readiness.host_stopped();
                    return;
                }
                handshake_for_reader.mark_ready();
                dispatch_loop(
                    &mut reader,
                    reader_stdin,
                    on_diagnostics,
                    pending,
                    Arc::clone(&readiness),
                );
            }
            Err(_) => {
                handshake_for_reader.mark_failed();
            }
        }
        // 语言服务退出（含崩溃）：唤醒等待就绪的请求，避免它们等满上限。
        readiness.host_stopped();
    });

    if let Err(reason) = write_locked(&stdin, &initialize) {
        handshake.mark_failed();
        return Err(reason);
    }

    Ok(())
}

fn dispatch_loop(
    reader: &mut BufReader<impl Read>,
    stdin: Arc<Mutex<ChildStdin>>,
    on_diagnostics: DiagnosticsListener,
    pending: PendingResponses,
    readiness: Arc<Readiness>,
) {
    loop {
        let message = match read_rpc(reader) {
            Ok(message) => message,
            Err(_) => break,
        };
        if let Some((uri, diagnostics)) = parse_publish_diagnostics(&message) {
            on_diagnostics(uri, diagnostics);
            continue;
        }
        if let Some(signal) = parse_project_load_signal(&message) {
            match signal {
                ProjectLoadSignal::Started => readiness.loading_started(),
                ProjectLoadSignal::Finished => readiness.loading_finished(),
            }
            continue;
        }
        if message.get("method").is_some() {
            if let Some(id) = message.get("id") {
                let _ = write_locked(
                    &stdin,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": null
                    }),
                );
            }
            continue;
        }
        if let Some(id) = message.get("id") {
            if let Ok(mut pending) = pending.lock() {
                if let Some(sender) = pending.remove(id) {
                    let _ = sender.send(message);
                }
            }
        }
    }
}

fn read_initialize_result(reader: &mut BufReader<impl Read>) -> Result<Value, ()> {
    loop {
        let message = read_rpc(reader).map_err(|_| ())?;
        if message.get("id") == Some(&json!(1)) {
            if message.get("error").is_some() {
                return Err(());
            }
            if message.get("result").is_some() {
                return Ok(message);
            }
        }
    }
}

fn write_locked(
    stdin: &Mutex<ChildStdin>,
    value: &Value,
) -> Result<(), CodeLanguageUnavailableReason> {
    let mut stdin = stdin
        .lock()
        .map_err(|_| CodeLanguageUnavailableReason::SpawnFailed)?;
    write_rpc(&mut *stdin, value).map_err(|_| CodeLanguageUnavailableReason::SpawnFailed)
}
