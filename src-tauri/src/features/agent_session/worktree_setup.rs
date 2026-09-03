use std::env;
use std::ffi::OsStr;
use std::path::Path;
use std::process::{Command, Output};

use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

#[cfg(unix)]
const DEFAULT_SETUP_SHELLS: [&str; 3] = ["/bin/zsh", "/bin/bash", "/bin/sh"];

pub(super) fn run_worktree_setup_command(
    workspace_path: &str,
    setup_command: Option<&str>,
) -> Result<(), CommandError> {
    let setup_command = setup_command
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(setup_command) = setup_command else {
        return Ok(());
    };

    let workspace = Path::new(workspace_path);
    if !workspace.is_dir() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionStartFailed,
            "Worktree 初始化目录不可访问。",
        )
        .with_reason("worktreeInitDirInaccessible")
        .with_detail(ErrorDetail::new("WorkingDir").with_value("path", workspace_path)));
    }

    if let Err(failure) = run_setup_command(workspace, setup_command) {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionStartFailed,
            "Worktree 初始化命令执行失败。",
        )
        .with_reason("worktreeInitCommandFailed")
        .with_detail(ErrorDetail::new("WorkingDir").with_value("path", workspace_path))
        .with_detail(ErrorDetail::new("Command").with_value("command", setup_command))
        .with_detail(ErrorDetail::new("Shell").with_value("shell", failure.shell))
        .with_detail(ErrorDetail::new("ExitStatus").with_value("code", failure.exit_code))
        .with_detail(ErrorDetail::new("Output").with_value("stderr", failure.stderr)));
    }

    Ok(())
}

#[derive(Debug)]
struct SetupCommandFailure {
    shell: String,
    exit_code: i32,
    stderr: String,
}

#[cfg(unix)]
fn run_setup_command(workspace: &Path, setup_command: &str) -> Result<(), SetupCommandFailure> {
    let preferred_shell = env::var("SHELL").ok();
    run_setup_command_with_shells_and_env(
        workspace,
        setup_command,
        &setup_shell_candidates(preferred_shell.as_deref()),
        &[],
    )
}

#[cfg(unix)]
fn run_setup_command_with_shells_and_env(
    workspace: &Path,
    setup_command: &str,
    shells: &[String],
    environment_overrides: &[(&str, &OsStr)],
) -> Result<(), SetupCommandFailure> {
    let mut last_failure = None;

    for shell in shells {
        for shell_args in [["-lc"], ["-lic"]] {
            match Command::new(&shell)
                .args(shell_args)
                .arg(setup_command)
                .current_dir(workspace)
                .envs(environment_overrides.iter().copied())
                .output()
            {
                Ok(output) if output.status.success() => return Ok(()),
                Ok(output) => {
                    let failure = setup_command_failure(&shell, output);
                    if !should_retry_setup_command(&failure) {
                        return Err(failure);
                    }
                    last_failure = Some(failure);
                }
                Err(error) => {
                    last_failure = Some(SetupCommandFailure {
                        shell: shell.clone(),
                        exit_code: -1,
                        stderr: error.to_string(),
                    });
                }
            }
        }
    }

    Err(last_failure.unwrap_or_else(|| SetupCommandFailure {
        shell: String::new(),
        exit_code: -1,
        stderr: "no shell candidates available".to_string(),
    }))
}

#[cfg(unix)]
fn setup_shell_candidates(preferred_shell: Option<&str>) -> Vec<String> {
    let mut shells = Vec::with_capacity(DEFAULT_SETUP_SHELLS.len() + 1);
    if let Some(shell) = preferred_shell {
        let trimmed = shell.trim();
        if !trimmed.is_empty() {
            shells.push(trimmed.to_string());
        }
    }

    for shell in DEFAULT_SETUP_SHELLS {
        if shells.iter().any(|candidate| candidate == shell) {
            continue;
        }
        shells.push(shell.to_string());
    }

    shells
}

#[cfg(not(unix))]
fn run_setup_command(workspace: &Path, setup_command: &str) -> Result<(), SetupCommandFailure> {
    match Command::new("cmd")
        .args(["/C", setup_command])
        .current_dir(workspace)
        .output()
    {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(setup_command_failure("cmd", output)),
        Err(error) => Err(SetupCommandFailure {
            shell: "cmd".to_string(),
            exit_code: -1,
            stderr: error.to_string(),
        }),
    }
}

fn setup_command_failure(shell: &str, output: Output) -> SetupCommandFailure {
    SetupCommandFailure {
        shell: shell.to_string(),
        exit_code: output.status.code().map_or(-1, i32::from),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    }
}

fn should_retry_setup_command(failure: &SetupCommandFailure) -> bool {
    failure.exit_code == -1 || failure.exit_code == 126 || failure.exit_code == 127
}

#[cfg(all(test, unix))]
mod worktree_setup_command_tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn setup_shell_candidates_keep_preferred_shell_first_without_duplicates() {
        assert_eq!(
            setup_shell_candidates(Some("/bin/zsh")),
            vec![
                "/bin/zsh".to_string(),
                "/bin/bash".to_string(),
                "/bin/sh".to_string(),
            ]
        );
    }

    #[test]
    fn setup_shell_candidates_include_default_shells_without_preferred_shell() {
        assert_eq!(
            setup_shell_candidates(None),
            vec![
                "/bin/zsh".to_string(),
                "/bin/bash".to_string(),
                "/bin/sh".to_string(),
            ]
        );
    }

    #[test]
    fn run_setup_command_loads_interactive_shell_path() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let home_dir = temp_dir.path().join("home");
        let bin_dir = temp_dir.path().join("bin");
        let workspace_dir = temp_dir.path().join("workspace");
        let setup_command_path = bin_dir.join("redwhisk-test-setup");
        fs::create_dir_all(&home_dir).expect("home dir");
        fs::create_dir_all(&bin_dir).expect("bin dir");
        fs::create_dir_all(&workspace_dir).expect("workspace dir");
        fs::write(
            &setup_command_path,
            "#!/bin/sh\nprintf shell-setup > setup-marker.txt\n",
        )
        .expect("setup command");
        fs::set_permissions(&setup_command_path, fs::Permissions::from_mode(0o755))
            .expect("setup command executable");
        fs::write(
            home_dir.join(".zshrc"),
            format!("export PATH=\"{}:$PATH\"\n", bin_dir.display()),
        )
        .expect("zshrc");

        run_setup_command_with_shells_and_env(
            &workspace_dir,
            "redwhisk-test-setup",
            &["/bin/zsh".to_string()],
            &[
                ("HOME", home_dir.as_os_str()),
                ("ZDOTDIR", home_dir.as_os_str()),
                ("PATH", OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin")),
            ],
        )
        .expect("setup command");

        assert_eq!(
            fs::read_to_string(workspace_dir.join("setup-marker.txt")).expect("setup marker"),
            "shell-setup"
        );
    }
}
