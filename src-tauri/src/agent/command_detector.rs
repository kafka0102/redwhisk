use std::env;
use std::process::Command;

pub trait AgentCommandDetector {
    fn detect_codex_command(&self) -> Result<String, String>;
    fn test_command(&self, command: &str) -> Result<String, String>;
}

pub struct ShellAgentCommandDetector;

impl ShellAgentCommandDetector {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ShellAgentCommandDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentCommandDetector for ShellAgentCommandDetector {
    fn detect_codex_command(&self) -> Result<String, String> {
        run_command_lookup("codex")
    }

    fn test_command(&self, command: &str) -> Result<String, String> {
        run_command_lookup(command)
    }
}

fn run_command_lookup(command: &str) -> Result<String, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("Agent command 不能为空。".to_string());
    }

    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let quoted_command = shell_quote(trimmed);
    let output = Command::new(&shell)
        .arg("-lc")
        .arg(format!("command -v {}", quoted_command))
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("未找到可执行命令：{}。", trimmed)
        } else {
            stderr
        });
    }

    let resolved_command = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if resolved_command.is_empty() {
        return Err(format!("未找到可执行命令：{}。", trimmed));
    }

    Ok(resolved_command)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}
