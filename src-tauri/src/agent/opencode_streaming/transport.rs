//! `opencode run --format json` 子进程传输层。
//!
//! 负责子进程生命周期与 NDJSON over stdout：
//! - 每行一个 JSON 对象
//! - 单向流：prompt 经 CLI 参数传入，本端只读 stdout
//!
//! PATH/alias 探测复用 `command_detector`（与 Claude/Codex 一致）。

use std::env;
use std::ffi::{OsStr, OsString};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::Value;

use crate::agent::command_detector::{run_command_lookup_with_path, CommandLookupResult};

const STDERR_BUFFER_LIMIT: usize = 8192;

/// 传输层错误。
#[derive(Debug, thiserror::Error)]
pub enum OpenCodeStreamingError {
    #[error("opencode 二进制未找到：{0}")]
    BinaryNotFound(String),
    #[error("启动 opencode 进程失败：{0}")]
    SpawnFailed(String),
    #[error("opencode 通道已关闭：{0}")]
    Closed(String),
    #[error("opencode 协议错误：{0}")]
    Protocol(String),
    #[error("opencode 请求序列化失败：{0}")]
    Serialize(#[from] serde_json::Error),
    #[error("opencode IO 错误：{0}")]
    Io(#[from] std::io::Error),
}

/// NDJSON 行回调。
pub type MessageHandler = Arc<dyn Fn(&Value) + Send + Sync>;

struct TransportState {
    message_handler: Mutex<Option<MessageHandler>>,
    stderr_buffer: Mutex<String>,
    closed: Mutex<Option<String>>,
    eof_sender: Mutex<Option<mpsc::Sender<String>>>,
    stdin: Mutex<Option<ChildStdin>>,
}

/// `opencode run --format json` 子进程传输层。
#[derive(Clone)]
pub struct OpenCodeTransport {
    state: Arc<TransportState>,
    child: Arc<Mutex<Option<Child>>>,
}

impl OpenCodeTransport {
    /// 启动 opencode 子进程。
    ///
    /// `binary` 为可执行路径（可含已拼装前缀）；`args` 为 `run --format json ...`；
    /// `cwd` 透传给子进程。
    pub fn spawn(
        binary: &str,
        args: &[String],
        cwd: Option<&str>,
    ) -> Result<Self, OpenCodeStreamingError> {
        let (program, preset_args) = split_command_line(binary)?;
        let resolved = resolve_spawn_program(program);
        let mut command = if resolved.requires_shell {
            shell_command(binary, args)
        } else {
            let mut command = Command::new(&resolved.program);
            command.args(preset_args).args(args);
            apply_spawn_environment(
                &mut command,
                resolved.lookup_path.as_deref(),
                &resolved.lookup_environment,
                &resolved.path_entries,
            );
            command
        };
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }

        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                OpenCodeStreamingError::BinaryNotFound(format!("{binary}: {error}"))
            } else {
                OpenCodeStreamingError::SpawnFailed(error.to_string())
            }
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| OpenCodeStreamingError::SpawnFailed("子进程未提供 stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| OpenCodeStreamingError::SpawnFailed("子进程未提供 stdout".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| OpenCodeStreamingError::SpawnFailed("子进程未提供 stderr".into()))?;

        let state = Arc::new(TransportState {
            message_handler: Mutex::new(None),
            stderr_buffer: Mutex::new(String::new()),
            closed: Mutex::new(None),
            eof_sender: Mutex::new(None),
            stdin: Mutex::new(Some(stdin)),
        });
        let child = Arc::new(Mutex::new(Some(child)));

        spawn_stdout_reader(stdout, Arc::clone(&state), Arc::clone(&child));
        spawn_stderr_reader(stderr, Arc::clone(&state));

        Ok(Self { state, child })
    }

    pub fn set_message_handler(&self, handler: MessageHandler) {
        if let Ok(mut guard) = self.state.message_handler.lock() {
            *guard = Some(handler);
        }
    }

    pub fn subscribe_eof(&self) -> mpsc::Receiver<String> {
        let (tx, rx) = mpsc::channel();
        if let Ok(mut eof_sender) = self.state.eof_sender.lock() {
            *eof_sender = Some(tx);
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

    pub fn shutdown(&self) {
        if let Ok(mut closed) = self.state.closed.lock() {
            if closed.is_none() {
                *closed = Some("客户端主动关闭".to_string());
            }
        }
        if let Ok(mut stdin_guard) = self.state.stdin.lock() {
            stdin_guard.take();
        }
        if let Ok(mut child_guard) = self.child.lock() {
            if let Some(mut child) = child_guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl Drop for OpenCodeTransport {
    fn drop(&mut self) {
        if Arc::strong_count(&self.child) == 1 {
            self.shutdown();
        }
    }
}

fn split_command_line(command: &str) -> Result<(&str, Vec<&str>), OpenCodeStreamingError> {
    let mut parts = command.split_whitespace();
    let program = parts.next().ok_or_else(|| {
        OpenCodeStreamingError::SpawnFailed("opencode binary 不能为空".to_string())
    })?;
    Ok((program, parts.collect()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedSpawnProgram {
    program: String,
    lookup_path: Option<OsString>,
    lookup_environment: Vec<(OsString, OsString)>,
    path_entries: Vec<PathBuf>,
    requires_shell: bool,
}

fn resolve_spawn_program(program: &str) -> ResolvedSpawnProgram {
    let lookup_result = if Path::new(program).components().count() > 1 {
        None
    } else {
        run_command_lookup_with_path(program).ok()
    };
    resolve_spawn_program_from_lookup(program, lookup_result)
}

fn resolve_spawn_program_from_lookup(
    program: &str,
    lookup_result: Option<CommandLookupResult>,
) -> ResolvedSpawnProgram {
    if Path::new(program).components().count() > 1 {
        return ResolvedSpawnProgram {
            program: program.to_string(),
            lookup_path: None,
            lookup_environment: Vec::new(),
            path_entries: spawn_path_entries_for_program(program),
            requires_shell: false,
        };
    }

    let requires_shell = lookup_result
        .as_ref()
        .is_some_and(|result| !is_direct_executable_lookup(&result.command));
    if requires_shell {
        return ResolvedSpawnProgram {
            program: program.to_string(),
            lookup_path: lookup_result
                .as_ref()
                .and_then(|result| result.path.clone()),
            lookup_environment: lookup_result
                .as_ref()
                .map(|result| result.environment.clone())
                .unwrap_or_default(),
            path_entries: Vec::new(),
            requires_shell: true,
        };
    }

    let resolved_program = lookup_result
        .as_ref()
        .map(|result| result.command.as_str())
        .unwrap_or(program);
    let path_entries = if resolved_program == program {
        Vec::new()
    } else {
        spawn_path_entries_for_program(resolved_program)
    };

    ResolvedSpawnProgram {
        program: resolved_program.to_string(),
        lookup_path: lookup_result
            .as_ref()
            .and_then(|result| result.path.clone()),
        lookup_environment: lookup_result
            .as_ref()
            .map(|result| result.environment.clone())
            .unwrap_or_default(),
        path_entries,
        requires_shell: false,
    }
}

fn is_direct_executable_lookup(command: &str) -> bool {
    let trimmed = command.trim();
    !trimmed.chars().any(char::is_whitespace) && Path::new(trimmed).components().count() > 1
}

fn build_shell_command_line(binary: &str, args: &[String]) -> String {
    let mut line = binary.trim().to_string();
    for arg in args {
        line.push(' ');
        if arg.contains(' ') || arg.contains('"') {
            line.push('"');
            line.push_str(&arg.replace('\\', "\\\\").replace('"', "\\\""));
            line.push('"');
        } else {
            line.push_str(arg);
        }
    }
    line
}

#[cfg(unix)]
fn shell_command(binary: &str, args: &[String]) -> Command {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut command = Command::new(shell);
    let line = build_shell_command_line(binary, args);
    command.args(["-lic", &line]);
    command
}

#[cfg(not(unix))]
fn shell_command(binary: &str, args: &[String]) -> Command {
    let mut command = Command::new("cmd");
    let line = build_shell_command_line(binary, args);
    command.args(["/C", &line]);
    command
}

fn spawn_path_entries_for_program(program: &str) -> Vec<PathBuf> {
    Path::new(program)
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(|parent| vec![parent.to_path_buf()])
        .unwrap_or_default()
}

fn apply_spawn_environment(
    command: &mut Command,
    lookup_path: Option<&OsStr>,
    lookup_environment: &[(OsString, OsString)],
    path_entries: &[PathBuf],
) {
    let fallback_path = env::var_os("PATH");
    let current_path = lookup_path.or(fallback_path.as_deref());
    if let Some(path) = build_spawn_path(current_path, path_entries) {
        command.env("PATH", path);
    }
    for (key, value) in lookup_environment {
        if is_shell_runtime_variable(key.as_os_str()) {
            continue;
        }
        command.env(key, value);
    }
}

fn build_spawn_path(current_path: Option<&OsStr>, path_entries: &[PathBuf]) -> Option<OsString> {
    let mut paths: Vec<PathBuf> = path_entries.to_vec();
    if let Some(current_path) = current_path {
        paths.extend(env::split_paths(current_path));
    }
    if paths.is_empty() {
        return None;
    }
    env::join_paths(paths).ok()
}

fn is_shell_runtime_variable(key: &OsStr) -> bool {
    matches!(
        key.to_str(),
        Some("PATH" | "PWD" | "OLDPWD" | "SHLVL" | "_")
    )
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
                Err(_) => continue,
            };
            if let Ok(guard) = state.message_handler.lock() {
                if let Some(handler) = guard.as_ref() {
                    handler(&value);
                }
            }
        }
        if let Ok(mut closed) = state.closed.lock() {
            if closed.is_none() {
                *closed = Some("stdout EOF".to_string());
            }
        }
        if let Ok(mut eof_sender) = state.eof_sender.lock() {
            if let Some(sender) = eof_sender.take() {
                let reason = state
                    .closed
                    .lock()
                    .ok()
                    .and_then(|guard| guard.clone())
                    .unwrap_or_else(|| "stdout EOF".to_string());
                let _ = sender.send(reason);
            }
        }
        if let Ok(mut guard) = child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.wait();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_command_line_preserves_program_and_args() {
        let (program, args) = split_command_line("opencode --foo").unwrap();
        assert_eq!(program, "opencode");
        assert_eq!(args, vec!["--foo"]);
    }

    #[test]
    fn build_shell_command_line_quotes_prompt_with_spaces() {
        let line = build_shell_command_line(
            "opencode",
            &[
                "run".into(),
                "--format".into(),
                "json".into(),
                "hello world".into(),
            ],
        );
        assert!(line.contains("\"hello world\""));
        assert!(line.starts_with("opencode run --format json "));
    }
}
