//! 结构化 provider 子进程 spawn 公共工具。
//!
//! 「用户终端环境」（交互式 `PATH`）的唯一来源是 `command_detector`
//! （见 `docs/architecture-design/agent-development-rules.md` 的「交互式 PATH
//! 三条不变量」）。结构化 provider（codex / claude / opencode / grok）共用本模块
//! 构造子进程命令，避免每个 adapter 各写一份 spawn 环境拼装。

use std::env;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::agent::command_detector::{
    resolve_interactive_shell_path, run_command_lookup_with_path, CommandLookupResult,
};

/// 按空白拆分命令行（首个 token 为 program，其余为预设参数）。
///
/// 空命令行返回 `("", [])`，由调用方决定兜底 program。
pub(crate) fn split_command_line(command: &str) -> (&str, Vec<&str>) {
    let mut parts = command.split_whitespace();
    let program = parts.next().unwrap_or("");
    (program, parts.collect())
}

/// 从 provider 命令快照取可执行首段。
///
/// 结构化命令快照可能形如 `grok agent stdio` / `opencode run --format json`，
/// 但 spawn 只需要可执行首段（结构化参数由 adapter 重建）。空快照返回空串，
/// 由调用方兜底 provider 默认 binary。
pub(crate) fn program_from_command_snapshot(command_snapshot: &str) -> &str {
    command_snapshot.split_whitespace().next().unwrap_or("")
}

/// 构造已注入交互式 `PATH` 的 provider 子进程命令。
///
/// `program` 为可执行首段（可含已拼装前缀）；`args` 为 adapter 重建的参数。
/// 当 `program` 是 shell alias / function 时回退到交互式 shell 执行整条命令行。
pub(crate) fn build_provider_command(program: &str, args: &[String]) -> Command {
    let resolved = resolve_spawn_program(program);
    if resolved.requires_shell {
        return shell_command(program, args);
    }
    let mut command = Command::new(&resolved.program);
    command.args(args);
    apply_spawn_environment(
        &mut command,
        resolved.lookup_path.as_deref(),
        &resolved.lookup_environment,
        &resolved.path_entries,
    );
    command
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

fn build_shell_command_line(program: &str, args: &[String]) -> String {
    let mut line = program.trim().to_string();
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
fn shell_command(program: &str, args: &[String]) -> Command {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut command = Command::new(shell);
    let line = build_shell_command_line(program, args);
    command.args(["-lic", &line]);
    command
}

#[cfg(not(unix))]
fn shell_command(program: &str, args: &[String]) -> Command {
    let mut command = Command::new("cmd");
    let line = build_shell_command_line(program, args);
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
    // GUI 启动时进程 PATH 不含 .zshrc 里的 nvm 目录；lookup 失败时才注入
    // 交互式 PATH，才能找到 provider 可执行文件（如 `claude` / `codex` / `grok`）
    // 以及其 shebang 依赖的 `node`。
    let fallback_path = if lookup_path.is_some() {
        None
    } else {
        resolve_interactive_shell_path().or_else(|| env::var_os("PATH"))
    };
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_command_line_preserves_program_and_args() {
        let (program, args) = split_command_line("opencode --foo");
        assert_eq!(program, "opencode");
        assert_eq!(args, vec!["--foo"]);
    }

    #[test]
    fn split_command_line_handles_empty() {
        let (program, args) = split_command_line("   ");
        assert_eq!(program, "");
        assert!(args.is_empty());
    }

    #[test]
    fn program_from_command_snapshot_strips_structured_args() {
        assert_eq!(program_from_command_snapshot("grok agent stdio"), "grok");
        assert_eq!(
            program_from_command_snapshot("opencode run --format json"),
            "opencode"
        );
        assert_eq!(
            program_from_command_snapshot("  /usr/local/bin/grok  "),
            "/usr/local/bin/grok"
        );
        assert_eq!(program_from_command_snapshot(""), "");
    }

    #[test]
    fn build_shell_command_line_quotes_args_with_spaces() {
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

    #[test]
    fn resolve_spawn_program_keeps_path_commands() {
        assert_eq!(
            resolve_spawn_program("/opt/grok/bin/grok").program,
            "/opt/grok/bin/grok"
        );
        assert_eq!(
            resolve_spawn_program("/opt/grok/bin/grok").path_entries,
            vec![PathBuf::from("/opt/grok/bin")]
        );
        assert_eq!(resolve_spawn_program("./grok").program, "./grok");
    }

    #[test]
    fn resolve_spawn_program_uses_shell_for_alias_lookup() {
        let resolved = resolve_spawn_program_from_lookup(
            "grok-alias",
            Some(CommandLookupResult {
                command: "alias grok-alias='grok agent stdio'".to_string(),
                path: None,
                environment: Vec::new(),
            }),
        );
        assert_eq!(resolved.program, "grok-alias");
        assert!(resolved.requires_shell);
    }

    #[test]
    fn build_spawn_path_prepends_program_parent_to_existing_path() {
        let path = build_spawn_path(
            Some(OsStr::new("/usr/bin:/bin")),
            &[PathBuf::from("/opt/codex/bin")],
        )
        .expect("spawn path");

        assert_eq!(
            env::split_paths(&path).collect::<Vec<_>>(),
            vec![
                PathBuf::from("/opt/codex/bin"),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/bin"),
            ]
        );
    }

    #[test]
    fn build_spawn_path_preserves_lookup_shell_path_without_program_parent() {
        let path = build_spawn_path(Some(OsStr::new("/opt/node/bin:/usr/bin:/bin")), &[])
            .expect("spawn path");

        assert_eq!(
            env::split_paths(&path).collect::<Vec<_>>(),
            vec![
                PathBuf::from("/opt/node/bin"),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/bin"),
            ]
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
            &[PathBuf::from("/opt/codex/bin")],
        );

        let envs: Vec<_> = command
            .get_envs()
            .map(|(key, value)| (key.to_os_string(), value.map(|entry| entry.to_os_string())))
            .collect();
        assert!(envs.iter().any(|(key, value)| {
            key == &OsString::from("GVM_ROOT")
                && value.as_ref() == Some(&OsString::from("/tmp/redwhisk-gvm"))
        }));
        assert!(!envs.iter().any(|(key, _)| key == &OsString::from("PWD")));
    }
}
