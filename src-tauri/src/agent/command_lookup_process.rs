use std::io::Read;
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub const DEFAULT_LOOKUP_TIMEOUT: Duration = Duration::from_secs(2);

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
}
