use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};

pub const DEFAULT_LOOKUP_TIMEOUT: Duration = Duration::from_secs(2);
/// nvm 等写在 `.zshrc` 的 hook 在无 TTY 时会卡住或自报 timeout；
/// 走 PTY 解析交互式 `$PATH` 的总预算（多次尝试共享，见 `command_detector`）。
///
/// 真实 `.zshrc`（nvm / compinit / pyenv / rbenv / 多条 PATH export）空闲约 1–3s，
/// 重载机器实测 5–15s，负载 100+ 时可达 40s。预算给到 45s 才能覆盖重载场景；
/// 此前 15s 一旦被越过，调用方只能拿到缺 nvm 目录的降级 PATH，spawn 出的终端与
/// Agent 会话随即报 `env: node: No such file or directory` / `codex: No such file
/// or directory`。
pub const INTERACTIVE_PATH_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug)]
pub enum LookupProcessError {
    Spawn(String),
    Timeout,
    Wait(String),
}

/// 跑短命令并在超时后杀掉，stdin 接 `/dev/null`，避免交互式 shell 卡在 TTY。
pub fn output_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Result<Output, LookupProcessError> {
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| LookupProcessError::Spawn(error.to_string()))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| LookupProcessError::Wait("stdout pipe missing".to_string()))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| LookupProcessError::Wait("stderr pipe missing".to_string()))?;
    let stdout_thread = thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout.read_to_end(&mut buffer);
        buffer
    });
    let stderr_thread = thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stderr.read_to_end(&mut buffer);
        buffer
    });

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => {
                thread::sleep(Duration::from_millis(15));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(LookupProcessError::Timeout);
            }
            Err(error) => return Err(LookupProcessError::Wait(error.to_string())),
        }
    };

    Ok(Output {
        status,
        stdout: stdout_thread.join().unwrap_or_default(),
        stderr: stderr_thread.join().unwrap_or_default(),
    })
}

impl LookupProcessError {
    pub fn to_lookup_message(self, command: &str) -> String {
        match self {
            LookupProcessError::Timeout => {
                format!("查找命令超时：{}。", command)
            }
            LookupProcessError::Spawn(message) | LookupProcessError::Wait(message) => message,
        }
    }
}

/// 从 shell 探测输出中取出 PATH 标记值，忽略 prompt / PTY 控制序列。
pub fn extract_marked_path(output: &[u8], marker: &str) -> Option<OsString> {
    let text = String::from_utf8_lossy(output);
    let rest = text.split(marker).nth(1)?;
    let value = rest
        .split(|ch| ch == '\n' || ch == '\r')
        .next()
        .unwrap_or("")
        .trim();
    if value.is_empty() {
        None
    } else {
        Some(OsString::from(value))
    }
}

/// 在伪终端里跑短命令并在超时后杀掉。
///
/// 交互式 `.zshrc`（nvm 等）依赖 TTY；管道 + stdin=/dev/null 会让 nvm 报 timeout，
/// 进而拿不到完整 PATH。PTY 与真实项目终端一致，才能解析出 pnpm 所在目录。
pub fn output_on_pty_with_timeout(
    program: &str,
    args: &[&str],
    environment_overrides: &[(&str, &OsStr)],
    timeout: Duration,
) -> Result<Vec<u8>, LookupProcessError> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| LookupProcessError::Spawn(error.to_string()))?;
    let mut builder = CommandBuilder::new(program);
    for arg in args {
        builder.arg(arg);
    }
    for (key, value) in environment_overrides {
        builder.env(*key, value);
    }
    builder.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(builder)
        .map_err(|error| LookupProcessError::Spawn(error.to_string()))?;
    let mut killer = child.clone_killer();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| LookupProcessError::Wait(error.to_string()))?;
    drop(pair.slave);

    let reader_thread = thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = reader.read_to_end(&mut buffer);
        buffer
    });

    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < timeout => {
                thread::sleep(Duration::from_millis(15));
            }
            Ok(None) => {
                let _ = killer.kill();
                let _ = child.wait();
                let _ = reader_thread.join();
                return Err(LookupProcessError::Timeout);
            }
            Err(error) => {
                let _ = killer.kill();
                let _ = child.wait();
                let _ = reader_thread.join();
                return Err(LookupProcessError::Wait(error.to_string()));
            }
        }
    }

    Ok(reader_thread.join().unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn output_with_timeout_kills_hanging_process() {
        let mut command = Command::new("sleep");
        command.arg("20");
        let started = Instant::now();
        let error = output_with_timeout(command, Duration::from_millis(250)).expect_err("timeout");
        assert!(matches!(error, LookupProcessError::Timeout));
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "超时后应立刻返回，实际 {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn output_with_timeout_returns_successful_output() {
        let mut command = Command::new("/bin/echo");
        command.arg("redwhisk-lookup");
        let output = output_with_timeout(command, Duration::from_secs(2)).expect("echo");
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8_lossy(&output.stdout).trim(),
            "redwhisk-lookup"
        );
    }

    #[test]
    fn extract_marked_path_ignores_prompt_noise() {
        let output = b"\x1b[1m%\x1b[0m\r\n__REDWHISK_LOOKUP_PATH__=/opt/bin:/usr/bin\r\nmore";
        assert_eq!(
            extract_marked_path(output, "__REDWHISK_LOOKUP_PATH__=").as_deref(),
            Some(std::ffi::OsStr::new("/opt/bin:/usr/bin"))
        );
    }
}
