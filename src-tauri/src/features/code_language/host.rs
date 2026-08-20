use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

use super::resolver::LanguageRuntime;
use crate::types::code_language::CodeLanguageUnavailableReason;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug)]
pub struct LanguageHost {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpawnLanguageHostError {
    Unavailable(CodeLanguageUnavailableReason),
}

impl LanguageHost {
    pub fn spawn(runtime: &LanguageRuntime) -> Result<Self, SpawnLanguageHostError> {
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
        let mut stdin = child
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

        if let Err(error) = handshake(&mut stdin, stdout, &runtime.cwd, &runtime.tsserver_path) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }

        Ok(Self { child, stdin })
    }

    pub fn is_alive(&mut self) -> bool {
        match self.child.try_wait() {
            Ok(None) => true,
            _ => false,
        }
    }

    pub fn stop(&mut self) {
        let _ = write_rpc(
            &mut self.stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "shutdown",
                "params": null
            }),
        );
        let _ = write_rpc(
            &mut self.stdin,
            &json!({
                "jsonrpc": "2.0",
                "method": "exit",
                "params": null
            }),
        );
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for LanguageHost {
    fn drop(&mut self) {
        self.stop();
    }
}

fn handshake(
    stdin: &mut ChildStdin,
    stdout: impl Read + Send + 'static,
    workspace_root: &Path,
    tsserver_path: &Path,
) -> Result<(), SpawnLanguageHostError> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let result = read_initialize_result(&mut reader);
        let _ = sender.send(result);
        drain_reader(reader);
    });

    let root_uri = file_uri(workspace_root);
    write_rpc(
        stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "processId": null,
                "rootUri": root_uri,
                "rootPath": workspace_root,
                "capabilities": {},
                "initializationOptions": {
                    "hostInfo": "RedWhisk",
                    "tsserver": {
                        "path": tsserver_path
                    }
                }
            }
        }),
    )
    .map_err(|_| SpawnLanguageHostError::Unavailable(CodeLanguageUnavailableReason::SpawnFailed))?;

    match receiver.recv_timeout(HANDSHAKE_TIMEOUT) {
        Ok(Ok(_)) => {}
        _ => {
            return Err(SpawnLanguageHostError::Unavailable(
                CodeLanguageUnavailableReason::SpawnFailed,
            ));
        }
    }

    write_rpc(
        stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "initialized",
            "params": {}
        }),
    )
    .map_err(|_| SpawnLanguageHostError::Unavailable(CodeLanguageUnavailableReason::SpawnFailed))?;

    Ok(())
}

fn drain_reader(mut reader: BufReader<impl Read>) {
    let mut buffer = [0_u8; 4096];
    while let Ok(size) = reader.read(&mut buffer) {
        if size == 0 {
            break;
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

fn write_rpc(writer: &mut impl Write, value: &Value) -> std::io::Result<()> {
    let body = serde_json::to_vec(value)?;
    write!(writer, "Content-Length: {}\r\n\r\n", body.len())?;
    writer.write_all(&body)?;
    writer.flush()
}

fn read_rpc(reader: &mut BufReader<impl Read>) -> std::io::Result<Value> {
    let mut content_length = None;
    loop {
        let mut line = String::new();
        let size = reader.read_line(&mut line)?;
        if size == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "lsp stream closed",
            ));
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length =
                Some(value.trim().parse::<usize>().map_err(|error| {
                    std::io::Error::new(std::io::ErrorKind::InvalidData, error)
                })?);
        }
    }
    let length = content_length.ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "missing Content-Length")
    })?;
    let mut body = vec![0_u8; length];
    reader.read_exact(&mut body)?;
    serde_json::from_slice(&body)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))
}

fn file_uri(path: &Path) -> String {
    let display = path.display().to_string();
    if display.starts_with('/') {
        format!("file://{display}")
    } else {
        format!("file:///{display}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
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
        let mut host = LanguageHost::spawn(&runtime).expect("spawn fake host");
        assert!(host.is_alive(), "握手完成后宿主应仍在运行");
        host.stop();
        assert!(!host.is_alive(), "停止后宿主应退出");
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
