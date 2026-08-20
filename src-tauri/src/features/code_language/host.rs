use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

use super::reader::{handshake_and_listen, DiagnosticsListener, PendingResponses};
use super::resolver::LanguageRuntime;
use super::rpc::{file_uri, write_rpc};
use crate::types::code_language::CodeLanguageUnavailableReason;

const NEXT_REQUEST_ID: i64 = 3;

#[derive(Debug)]
pub struct LanguageHost {
    child: Mutex<Child>,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: PendingResponses,
    next_id: AtomicI64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpawnLanguageHostError {
    Unavailable(CodeLanguageUnavailableReason),
}

impl LanguageHost {
    pub fn spawn(runtime: &LanguageRuntime) -> Result<Self, SpawnLanguageHostError> {
        Self::spawn_with_diagnostics(runtime, Arc::new(|_, _| {}))
    }

    pub fn spawn_with_diagnostics(
        runtime: &LanguageRuntime,
        on_diagnostics: DiagnosticsListener,
    ) -> Result<Self, SpawnLanguageHostError> {
        let mut command = Command::new(&runtime.program);
        command
            .args(&runtime.args)
            .current_dir(&runtime.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        let mut child = command.spawn().map_err(|_| {
            SpawnLanguageHostError::Unavailable(CodeLanguageUnavailableReason::SpawnFailed)
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or(SpawnLanguageHostError::Unavailable(
                CodeLanguageUnavailableReason::SpawnFailed,
            ))?;
        let stdout = child
            .stdout
            .take()
            .ok_or(SpawnLanguageHostError::Unavailable(
                CodeLanguageUnavailableReason::SpawnFailed,
            ))?;
        let stdin = Arc::new(Mutex::new(stdin));
        let pending: PendingResponses = Arc::new(Mutex::new(Default::default()));

        let initialize = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "processId": null,
                "rootUri": file_uri(&runtime.cwd),
                "rootPath": runtime.cwd,
                "capabilities": {},
                "initializationOptions": {
                    "hostInfo": "RedWhisk",
                    "tsserver": {
                        "path": runtime.tsserver_path
                    }
                }
            }
        });

        if let Err(reason) = handshake_and_listen(
            Arc::clone(&stdin),
            stdout,
            initialize,
            on_diagnostics,
            Arc::clone(&pending),
        ) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(SpawnLanguageHostError::Unavailable(reason));
        }

        Ok(Self {
            child: Mutex::new(child),
            stdin,
            pending,
            next_id: AtomicI64::new(NEXT_REQUEST_ID),
        })
    }

    pub fn is_alive(&self) -> bool {
        match self.child.lock() {
            Ok(mut child) => matches!(child.try_wait(), Ok(None)),
            Err(_) => false,
        }
    }

    pub fn write_message(&self, value: &Value) -> std::io::Result<()> {
        let mut stdin = self
            .stdin
            .lock()
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error.to_string()))?;
        write_rpc(&mut *stdin, value)
    }

    pub fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> std::io::Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let request_id = json!(id);
        let (sender, receiver) = mpsc::channel();
        {
            let mut pending = self.pending.lock().map_err(|error| {
                std::io::Error::new(std::io::ErrorKind::Other, error.to_string())
            })?;
            pending.insert(request_id.clone(), sender);
        }
        if let Err(error) = self.write_message(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        })) {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&request_id);
            }
            return Err(error);
        }
        match receiver.recv_timeout(timeout) {
            Ok(message) => Ok(message),
            Err(error) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&request_id);
                }
                Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    error.to_string(),
                ))
            }
        }
    }

    pub fn stop(&self) {
        let _ = self.write_message(&json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "shutdown",
            "params": null
        }));
        let _ = self.write_message(&json!({
            "jsonrpc": "2.0",
            "method": "exit",
            "params": null
        }));
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for LanguageHost {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::code_language::CodeLanguageDiagnostic;
    use serde_json::json;
    use std::fs;
    use std::path::Path;
    use std::sync::mpsc;
    use std::time::Duration;
    use tempfile::tempdir;

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, contents).expect("write file");
    }

    fn fake_lsp_script() -> &'static str {
        r#"
import json
import sys

def read_msg():
    headers = {}
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        if line in (b"\r\n", b"\n"):
            break
        key, value = line.decode("utf-8").split(":", 1)
        headers[key.strip().lower()] = value.strip()
    length = int(headers.get("content-length", "0"))
    body = sys.stdin.buffer.read(length)
    return json.loads(body)

def write_msg(payload):
    raw = json.dumps(payload).encode("utf-8")
    sys.stdout.buffer.write(f"Content-Length: {len(raw)}\r\n\r\n".encode("ascii") + raw)
    sys.stdout.buffer.flush()

while True:
    message = read_msg()
    if message is None:
        break
    method = message.get("method")
    if method == "initialize":
        write_msg({"jsonrpc": "2.0", "id": message["id"], "result": {"capabilities": {}}})
    elif method == "textDocument/didOpen":
        uri = message["params"]["textDocument"]["uri"]
        write_msg({
            "jsonrpc": "2.0",
            "method": "textDocument/publishDiagnostics",
            "params": {
                "uri": uri,
                "diagnostics": [{
                    "range": {
                        "start": {"line": 0, "character": 12},
                        "end": {"line": 0, "character": 15}
                    },
                    "severity": 1,
                    "message": "Cannot find name 'bar'."
                }]
            }
        })
    elif method == "shutdown":
        write_msg({"jsonrpc": "2.0", "id": message["id"], "result": None})
    elif method == "exit":
        break
"#
    }

    fn runtime_with_script(workspace: &Path, script: &str) -> LanguageRuntime {
        let script_path = workspace.join("fake_lsp.py");
        write_file(&script_path, script);
        write_file(&workspace.join("tsserver.js"), "fake-tsserver");
        LanguageRuntime {
            program: "python3".to_string(),
            args: vec![script_path.to_string_lossy().into_owned()],
            cwd: workspace.to_path_buf(),
            tsserver_path: workspace.join("tsserver.js"),
        }
    }

    #[test]
    fn handshake_ready_after_initialize() {
        let temp_dir = tempdir().expect("temp dir");
        let workspace = temp_dir.path().join("repo");
        let runtime = runtime_with_script(&workspace, fake_lsp_script());
        let host = LanguageHost::spawn(&runtime).expect("spawn fake host");
        assert!(host.is_alive(), "握手完成后宿主应仍在运行");
        host.stop();
        assert!(!host.is_alive(), "停止后宿主应退出");
    }

    #[test]
    fn did_open_delivers_publish_diagnostics() {
        let temp_dir = tempdir().expect("temp dir");
        let workspace = temp_dir.path().join("repo");
        let runtime = runtime_with_script(&workspace, fake_lsp_script());
        let (sender, receiver) = mpsc::channel::<(String, Vec<CodeLanguageDiagnostic>)>();
        let host = LanguageHost::spawn_with_diagnostics(
            &runtime,
            Arc::new(move |uri, diagnostics| {
                let _ = sender.send((uri, diagnostics));
            }),
        )
        .expect("spawn fake host");

        let uri = file_uri(&workspace.join("src/file.ts"));
        host.write_message(&json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": {
                "textDocument": {
                    "uri": uri,
                    "languageId": "typescript",
                    "version": 1,
                    "text": "const foo = bar;\n"
                }
            }
        }))
        .expect("didOpen");

        let (received_uri, diagnostics) = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("diagnostics from fake host");
        assert_eq!(received_uri, uri);
        assert_eq!(diagnostics[0].message, "Cannot find name 'bar'.");
        host.stop();
    }

    #[test]
    fn spawn_failed_when_process_cannot_start() {
        let temp_dir = tempdir().expect("temp dir");
        let workspace = temp_dir.path().join("repo");
        fs::create_dir_all(&workspace).expect("workspace");
        let runtime = LanguageRuntime {
            program: workspace
                .join("missing-binary")
                .to_string_lossy()
                .into_owned(),
            args: vec!["--stdio".to_string()],
            cwd: workspace,
            tsserver_path: temp_dir.path().join("tsserver.js"),
        };

        let error = LanguageHost::spawn(&runtime).expect_err("missing binary");
        assert_eq!(
            error,
            SpawnLanguageHostError::Unavailable(CodeLanguageUnavailableReason::SpawnFailed)
        );
    }

    #[test]
    fn spawn_failed_when_handshake_is_rejected() {
        let temp_dir = tempdir().expect("temp dir");
        let workspace = temp_dir.path().join("repo");
        let runtime = runtime_with_script(
            &workspace,
            r#"
import json
import sys

def read_msg():
    headers = {}
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        if line in (b"\r\n", b"\n"):
            break
        key, value = line.decode("utf-8").split(":", 1)
        headers[key.strip().lower()] = value.strip()
    length = int(headers.get("content-length", "0"))
    body = sys.stdin.buffer.read(length)
    return json.loads(body)

def write_msg(payload):
    raw = json.dumps(payload).encode("utf-8")
    sys.stdout.buffer.write(f"Content-Length: {len(raw)}\r\n\r\n".encode("ascii") + raw)
    sys.stdout.buffer.flush()

message = read_msg()
write_msg({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32000, "message": "no"}})
"#
            .trim(),
        );

        let error = LanguageHost::spawn(&runtime).expect_err("handshake rejected");
        assert_eq!(
            error,
            SpawnLanguageHostError::Unavailable(CodeLanguageUnavailableReason::SpawnFailed)
        );
    }
}
