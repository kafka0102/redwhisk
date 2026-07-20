//! `claude -p --output-format stream-json` 子进程传输层。
//!
//! 负责子进程生命周期与 NDJSON over stdio 帧协议：
//! - stdout 每行是一个紧凑 JSON 对象（`SDKMessage`）+ `\n`
//! - 单向流：子进程持续输出事件，本端只读不写（单轮模型下 prompt 经
//!   `-p` 参数传入；未来长驻模式可经 `write_line` 写 stdin）
//!
//! 与 `codex_app_server/transport.rs` 的差异：
//! - 去掉 JSON-RPC 的 request/response id 配对（pending map、request_with_timeout）
//! - 去掉 server→client request 处理（Claude stream-json 无审批应答通道）
//! - 只保留：spawn 子进程 + stdout reader（逐行解析）+ stderr 环形缓冲 +
//!   message handler 回调 + shutdown
//!
//! PATH/alias 探测复用 `command_detector`（与 codex 一致），保证从 Tauri
//! 启动时能找到用户 `.zshrc` 里配置的 `claude` 路径。

use std::env;
use std::ffi::{OsStr, OsString};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::Value;

use crate::agent::command_detector::{run_command_lookup_with_path, CommandLookupResult};

/// stderr 缓冲上限，避免内存膨胀；保留尾部用于诊断。
const STDERR_BUFFER_LIMIT: usize = 8192;
/// claude 后台子代理等待上限 env 名（毫秒，`0` = 无限等待）。
///
/// claude 自 v2.1.182 起对后台子代理（background subagent）默认设 10 分钟
/// 等待 cap，超时自动终止子代理并标记为「用户中断」（`[Request interrupted
/// by user]`）。RedWhisk 作为本地工具、用户在场，设为 `0` 放开该限制，避免
/// 长任务子代理（如多步工作流的单张 ticket 实现）被静默打断；失控时由子代理
/// 中断提示与手动 cancel 兜底。
const CLAUDE_PRINT_BG_WAIT_CEILING_ENV: &str = "CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS";
/// 传输层错误。
#[derive(Debug, thiserror::Error)]
pub enum ClaudeStreamingError {
    #[error("claude 二进制未找到：{0}")]
    BinaryNotFound(String),
    #[error("启动 claude 进程失败：{0}")]
    SpawnFailed(String),
    #[error("claude 通道已关闭：{0}")]
    Closed(String),
    #[error("claude 协议错误：{0}")]
    Protocol(String),
    #[error("claude 请求序列化失败：{0}")]
    Serialize(#[from] serde_json::Error),
    #[error("claude IO 错误：{0}")]
    Io(#[from] std::io::Error),
}

/// SDKMessage 回调。每读到一行 NDJSON 就以原始 `Value` 调用一次。
pub type MessageHandler = Arc<dyn Fn(&Value) + Send + Sync>;

struct TransportState {
    /// 单一消息消费者（覆盖式设置）。
    message_handler: Mutex<Option<MessageHandler>>,
    /// stderr 尾部缓冲，进程退出时拼进错误消息。
    stderr_buffer: Mutex<String>,
    /// stdout reader 线程读到 EOF 后通知主线程。
    closed: Mutex<Option<String>>,
    /// stdout EOF 事件订阅（session 层据此补发 TurnFailed / 清理状态）。
    eof_sender: Mutex<Option<mpsc::Sender<String>>>,
    stdin: Mutex<Option<ChildStdin>>,
}

/// `claude -p --output-format stream-json` 子进程传输层。
///
/// 持有子进程与读线程。`clone()` 共享底层状态（Arc），供多线程调用。
#[derive(Clone)]
pub struct ClaudeTransport {
    state: Arc<TransportState>,
    /// 子进程句柄，仅主实例持有，drop 时尝试 kill。
    child: Arc<Mutex<Option<Child>>>,
}

impl ClaudeTransport {
    /// 启动 claude 子进程。
    ///
    /// `binary` 为 claude 可执行路径（通常 `claude`）；`args` 为传给 claude
    /// 的额外参数（如 `-p`、`--output-format stream-json`、prompt 等）；
    /// `cwd` 透传给子进程。
    pub fn spawn(
        binary: &str,
        args: &[String],
        cwd: Option<&str>,
    ) -> Result<Self, ClaudeStreamingError> {
        let (program, preset_args) = split_command_line(binary)?;
        let resolved_program = resolve_spawn_program(program);
        let mut command = if resolved_program.requires_shell {
            shell_command(binary, args)
        } else {
            let mut command = Command::new(&resolved_program.program);
            command.args(preset_args).args(args);
            apply_spawn_environment(
                &mut command,
                resolved_program.lookup_path.as_deref(),
                &resolved_program.lookup_environment,
                &resolved_program.path_entries,
            );
            command
        };
        // 放开 claude 后台子代理 10 分钟等待 cap，避免长任务子代理被静默
        // 中断（见 CLAUDE_PRINT_BG_WAIT_CEILING_ENV 注释）。
        command.env(CLAUDE_PRINT_BG_WAIT_CEILING_ENV, "0");
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }

        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                ClaudeStreamingError::BinaryNotFound(format!("{binary}: {error}"))
            } else {
                ClaudeStreamingError::SpawnFailed(error.to_string())
            }
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| ClaudeStreamingError::SpawnFailed("子进程未提供 stdin".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ClaudeStreamingError::SpawnFailed("子进程未提供 stdout".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| ClaudeStreamingError::SpawnFailed("子进程未提供 stderr".to_string()))?;

        let state = Arc::new(TransportState {
            message_handler: Mutex::new(None),
            stderr_buffer: Mutex::new(String::new()),
            closed: Mutex::new(None),
            eof_sender: Mutex::new(None),
            stdin: Mutex::new(Some(stdin)),
        });
        let child = Arc::new(Mutex::new(Some(child)));

        // child 也交给 stdout reader：进程自然退出（stdout EOF）时由 reader
        // 线程 take + wait 回收，避免父进程未及时 reap 而残留僵尸。
        spawn_stdout_reader(stdout, Arc::clone(&state), Arc::clone(&child));
        spawn_stderr_reader(stderr, Arc::clone(&state));

        Ok(Self { state, child })
    }

    /// 注册 SDKMessage 回调。覆盖式设置，整个 turn 只有一个消费者。
    pub fn set_message_handler(&self, handler: MessageHandler) {
        if let Ok(mut guard) = self.state.message_handler.lock() {
            *guard = Some(handler);
        }
    }

    /// 订阅 stdout EOF 事件。进程退出（读到 EOF）时通过返回的 receiver 收到原因。
    pub fn subscribe_eof(&self) -> mpsc::Receiver<String> {
        let (tx, rx) = mpsc::channel();
        if let Ok(mut eof_sender) = self.state.eof_sender.lock() {
            *eof_sender = Some(tx);
        }
        rx
    }

    /// 读取 stderr 尾部缓冲（best-effort），用于诊断。
    pub fn stderr_tail(&self) -> String {
        self.state
            .stderr_buffer
            .lock()
            .map(|buffer| buffer.clone())
            .unwrap_or_default()
    }

    /// 写一行 JSON 到 stdin（未来长驻模式用；单轮模型下首条消息走 `-p` 参数）。
    #[allow(dead_code)]
    pub fn write_line(&self, value: &Value) -> Result<(), ClaudeStreamingError> {
        let mut line = serde_json::to_string(value)?;
        line.push('\n');
        let mut stdin_guard = self
            .state
            .stdin
            .lock()
            .map_err(|_| ClaudeStreamingError::Protocol("stdin 锁中毒".to_string()))?;
        let stdin = stdin_guard
            .as_mut()
            .ok_or_else(|| ClaudeStreamingError::Closed("claude stdin 已关闭".to_string()))?;
        stdin.write_all(line.as_bytes())?;
        stdin.flush()?;
        Ok(())
    }

    /// 进程是否已关闭（读到 EOF 或被主动 shutdown）。
    pub fn is_closed(&self) -> bool {
        self.state
            .closed
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(true)
    }

    /// 优雅关闭：关闭 stdin → kill 子进程 → wait。
    pub fn shutdown(&self) {
        // 标记关闭，阻止新写入。
        if let Ok(mut closed) = self.state.closed.lock() {
            if closed.is_none() {
                *closed = Some("客户端主动关闭".to_string());
            }
        }
        // 关闭 stdin。
        if let Ok(mut stdin_guard) = self.state.stdin.lock() {
            stdin_guard.take();
        }
        // kill 子进程。
        if let Ok(mut child_guard) = self.child.lock() {
            if let Some(mut child) = child_guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl Drop for ClaudeTransport {
    fn drop(&mut self) {
        // 仅当最后一个 Arc 引用释放时执行关闭。stdout reader 线程也持有 child
        // 的 Arc clone，但它读到 EOF（并 reap 子进程）后即退出，引用随之回落，
        // 因此 struct 释放时这里仍能按预期 kill 仍存活的进程。
        if Arc::strong_count(&self.child) == 1 {
            self.shutdown();
        }
    }
}

fn split_command_line(command: &str) -> Result<(&str, Vec<&str>), ClaudeStreamingError> {
    let mut parts = command.split_whitespace();
    let program = parts
        .next()
        .ok_or_else(|| ClaudeStreamingError::SpawnFailed("claude binary 不能为空".to_string()))?;
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

/// 构造走 shell 的 claude 命令行（保留 alias 与额外参数）。
fn build_shell_command_line(binary: &str, args: &[String]) -> String {
    let mut line = binary.trim().to_string();
    for arg in args {
        line.push(' ');
        // 简单参数直接拼接；含空格的参数（如 prompt）需引用。
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
            dispatch_message(&state, value);
        }
        // 读到 EOF，标记关闭并通知订阅者。
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
        // 进程已关闭 stdout（通常即将或已经退出）。此处 wait 回收子进程，避免
        // 父进程未及时 reap 而残留僵尸。若 child 已被显式 shutdown 取走，此处
        // take 到 None，跳过。
        reap_child(&child);
    });
}

/// 回收子进程（take + wait），避免僵尸。
fn reap_child(child: &Arc<Mutex<Option<Child>>>) {
    if let Ok(mut guard) = child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.wait();
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
    if let Ok(guard) = state.message_handler.lock() {
        if let Some(handler) = guard.as_ref() {
            handler(&value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_command_line_preserves_program_and_args() {
        let (program, args) = split_command_line("claude --some-flag").unwrap();
        assert_eq!(program, "claude");
        assert_eq!(args, vec!["--some-flag"]);
    }

    #[test]
    fn resolve_spawn_program_keeps_path_commands() {
        assert_eq!(
            resolve_spawn_program("/opt/claude/bin/claude").program,
            "/opt/claude/bin/claude"
        );
        assert_eq!(resolve_spawn_program("./claude").program, "./claude");
    }

    #[test]
    fn resolve_spawn_program_adds_program_parent_to_child_path() {
        assert_eq!(
            resolve_spawn_program("/opt/claude/bin/claude").path_entries,
            vec![PathBuf::from("/opt/claude/bin")]
        );
    }

    #[test]
    fn apply_spawn_environment_skips_shell_runtime_variables() {
        let mut command = Command::new("/usr/bin/env");
        apply_spawn_environment(
            &mut command,
            Some(OsStr::new("/opt/node/bin:/usr/bin:/bin")),
            &[
                (
                    OsString::from("GVM_ROOT"),
                    OsString::from("/tmp/redwhisk-gvm"),
                ),
                (
                    OsString::from("PWD"),
                    OsString::from("/tmp/should-not-leak"),
                ),
            ],
            &[PathBuf::from("/opt/claude/bin")],
        );

        let envs: Vec<_> = command
            .get_envs()
            .map(|(key, value)| (key.to_os_string(), value.map(|entry| entry.to_os_string())))
            .collect();
        assert!(envs.iter().any(|(key, value)| {
            key == &OsString::from("GVM_ROOT")
                && value.as_ref() == Some(&OsString::from("/tmp/redwhisk-gvm"))
        }));
        assert!(envs.iter().all(|(key, _)| key != &OsString::from("PWD")));
        assert!(envs.iter().any(|(key, value)| {
            key == &OsString::from("PATH")
                && value.as_ref().is_some_and(|path| {
                    env::split_paths(path).collect::<Vec<_>>()
                        == vec![
                            PathBuf::from("/opt/claude/bin"),
                            PathBuf::from("/opt/node/bin"),
                            PathBuf::from("/usr/bin"),
                            PathBuf::from("/bin"),
                        ]
                })
        }));
    }

    #[test]
    fn dispatch_message_invokes_handler() {
        let state = TransportState {
            message_handler: Mutex::new(None),
            stderr_buffer: Mutex::new(String::new()),
            closed: Mutex::new(None),
            eof_sender: Mutex::new(None),
            stdin: Mutex::new(None),
        };
        let state = Arc::new(state);

        let captured: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
        let captured_for_handler = Arc::clone(&captured);
        let handler: MessageHandler = Arc::new(move |value| {
            captured_for_handler.lock().unwrap().push(value.clone());
        });
        state.message_handler.lock().unwrap().replace(handler);

        dispatch_message(&state, serde_json::json!({ "type": "result" }));

        let captured = captured.lock().unwrap();
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0]["type"], "result");
    }

    #[test]
    fn stdout_eof_reaps_child_to_avoid_zombie() {
        // 找一个会立即退出、stdout 随即 EOF 的命令（true）；reader 线程应 take +
        // wait 回收 child，否则子进程退出但父进程未 wait，残留僵尸。
        // 不同系统 true 路径不同（macOS 多在 /usr/bin/true），找不到则跳过。
        let true_path = ["/usr/bin/true", "/bin/true"]
            .into_iter()
            .find(|path| std::path::Path::new(path).exists());
        let Some(true_path) = true_path else {
            eprintln!("跳过：未找到 true 命令");
            return;
        };

        let transport = ClaudeTransport::spawn(true_path, &[], None).expect("spawn true");

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        loop {
            let reaped = transport
                .child
                .lock()
                .map(|guard| guard.is_none())
                .unwrap_or(false);
            if reaped || std::time::Instant::now() > deadline {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        let reaped = transport
            .child
            .lock()
            .map(|guard| guard.is_none())
            .unwrap_or(false);
        assert!(reaped, "进程退出后 child 应被 reap，避免僵尸");
    }
}
