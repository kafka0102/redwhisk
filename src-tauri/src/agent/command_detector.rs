use std::env;
use std::ffi::OsStr;
use std::process::Command;

const DEFAULT_LOOKUP_SHELLS: [&str; 3] = ["/bin/zsh", "/bin/bash", "/bin/sh"];

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

pub(crate) fn run_command_lookup(command: &str) -> Result<String, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("Agent command 不能为空。".to_string());
    }

    let preferred_shell = env::var("SHELL").ok();
    let shells = shell_lookup_candidates(preferred_shell.as_deref());
    run_command_lookup_with_shells_and_env(trimmed, &shells, &[])
}

fn shell_lookup_candidates(preferred_shell: Option<&str>) -> Vec<String> {
    let mut shells = Vec::with_capacity(DEFAULT_LOOKUP_SHELLS.len() + 1);
    if let Some(shell) = preferred_shell {
        let trimmed = shell.trim();
        if !trimmed.is_empty() {
            shells.push(trimmed.to_string());
        }
    }

    for shell in DEFAULT_LOOKUP_SHELLS {
        if shells.iter().any(|candidate| candidate == shell) {
            continue;
        }
        shells.push(shell.to_string());
    }

    shells
}

fn run_command_lookup_with_shells_and_env(
    command: &str,
    shells: &[String],
    environment_overrides: &[(&str, &OsStr)],
) -> Result<String, String> {
    let mut last_error = None;

    for shell in shells {
        let login_result =
            run_shell_command_lookup(shell, &["-lc"], command, environment_overrides);
        if let Ok(resolved_command) = login_result {
            return Ok(resolved_command);
        }

        let interactive_result =
            run_shell_command_lookup(shell, &["-lic"], command, environment_overrides);
        match interactive_result {
            Ok(resolved_command) => return Ok(resolved_command),
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| format!("未找到可执行命令：{}。", command)))
}

fn run_shell_command_lookup(
    shell: &str,
    shell_args: &[&str],
    command: &str,
    environment_overrides: &[(&str, &OsStr)],
) -> Result<String, String> {
    let quoted_command = shell_quote(command);
    let mut process = Command::new(shell);
    process
        .args(shell_args)
        .arg(format!("command -v {}", quoted_command));
    for (key, value) in environment_overrides {
        process.env(key, value);
    }

    let output = process.output().map_err(|error| error.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("未找到可执行命令：{}。", command)
        } else {
            stderr
        });
    }

    let resolved_command = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if resolved_command.is_empty() {
        return Err(format!("未找到可执行命令：{}。", command));
    }

    Ok(resolved_command)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn shell_lookup_candidates_fall_back_to_zsh_bash_and_sh() {
        assert_eq!(
            shell_lookup_candidates(None),
            vec![
                "/bin/zsh".to_string(),
                "/bin/bash".to_string(),
                "/bin/sh".to_string(),
            ]
        );
    }

    #[test]
    fn shell_lookup_candidates_keep_preferred_shell_first_without_duplicates() {
        assert_eq!(
            shell_lookup_candidates(Some("/bin/zsh")),
            vec![
                "/bin/zsh".to_string(),
                "/bin/bash".to_string(),
                "/bin/sh".to_string(),
            ]
        );
    }

    #[test]
    fn interactive_shell_lookup_loads_zshrc_path() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let bin_dir = temp_dir.path().join("bin");
        let command_path = bin_dir.join("redwhisk-test-agent");
        fs::create_dir_all(&bin_dir).expect("bin dir");
        fs::write(&command_path, "#!/bin/sh\nexit 0\n").expect("test command");
        fs::set_permissions(&command_path, fs::Permissions::from_mode(0o755))
            .expect("executable command");
        fs::write(
            temp_dir.path().join(".zshrc"),
            format!("export PATH=\"{}:$PATH\"\n", bin_dir.display()),
        )
        .expect("zshrc");

        let home = temp_dir.path().as_os_str();
        let baseline_path = OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin");
        let missing_result = run_shell_command_lookup(
            "/bin/zsh",
            &["-lc"],
            "redwhisk-test-agent",
            &[("HOME", home), ("PATH", baseline_path)],
        );
        let interactive_result = run_shell_command_lookup(
            "/bin/zsh",
            &["-lic"],
            "redwhisk-test-agent",
            &[("HOME", home), ("PATH", baseline_path)],
        );

        assert!(missing_result.is_err());
        assert_eq!(
            interactive_result.expect("interactive shell command"),
            command_path.display().to_string()
        );
    }

    #[test]
    fn command_lookup_falls_back_to_zsh_when_preferred_shell_is_unavailable() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let bin_dir = temp_dir.path().join("bin");
        let command_path = bin_dir.join("redwhisk-test-agent");
        fs::create_dir_all(&bin_dir).expect("bin dir");
        fs::write(&command_path, "#!/bin/sh\nexit 0\n").expect("test command");
        fs::set_permissions(&command_path, fs::Permissions::from_mode(0o755))
            .expect("executable command");
        fs::write(
            temp_dir.path().join(".zshrc"),
            format!("export PATH=\"{}:$PATH\"\n", bin_dir.display()),
        )
        .expect("zshrc");

        let home = temp_dir.path().as_os_str();
        let baseline_path = OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin");
        let shells = vec![
            "/path/that/does/not/exist/redwhisk-shell".to_string(),
            "/bin/zsh".to_string(),
        ];

        let resolved_command = run_command_lookup_with_shells_and_env(
            "redwhisk-test-agent",
            &shells,
            &[("HOME", home), ("PATH", baseline_path)],
        )
        .expect("fallback shell command");

        assert_eq!(resolved_command, command_path.display().to_string());
    }
}
