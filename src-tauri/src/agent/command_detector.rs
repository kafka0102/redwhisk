use std::env;
use std::ffi::{OsStr, OsString};
use std::process::Command;

const DEFAULT_LOOKUP_SHELLS: [&str; 3] = ["/bin/zsh", "/bin/bash", "/bin/sh"];
const LOOKUP_PATH_MARKER: &str = "__REDWHISK_LOOKUP_PATH__=";
const LOOKUP_ENV_MARKER: &str = "__REDWHISK_LOOKUP_ENV__";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandLookupResult {
    pub command: String,
    pub path: Option<OsString>,
    pub environment: Vec<(OsString, OsString)>,
}

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
    run_command_lookup_with_path(command).map(|result| result.command)
}

pub(crate) fn run_command_lookup_with_path(command: &str) -> Result<CommandLookupResult, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("Agent command 不能为空。".to_string());
    }

    let preferred_shell = env::var("SHELL").ok();
    let shells = shell_lookup_candidates(preferred_shell.as_deref());
    run_command_lookup_with_path_with_shells_and_env(trimmed, &shells, &[])
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

/// 以 login+interactive 方式启动用户首选 shell，解析出完整的 `$PATH`。
///
/// GUI（Dock/Finder）启动的进程继承 launchd 的极简 PATH，缺少用户在交互式配置
/// （`~/.zshrc` / `~/.bashrc`）里写入的目录（典型如 nvm/fnm/volta 的 node bin、
/// rbenv shims）。PTY 子进程若用非交互 `-lc` 执行用户命令（如 `pnpm`），会因为
/// 这些目录缺失而报 `command not found`。这里通过 `-lic` 让 shell 加载完整交互式
/// 配置后回显 `$PATH`，供 PTY spawn 时注入子进程环境。
///
/// 失败（找不到可用 shell 或 shell 异常退出）返回 `None`，调用方回退到继承的 PATH，
/// 与未注入时的行为一致，不阻断启动。
pub(crate) fn resolve_interactive_shell_path() -> Option<OsString> {
    let preferred_shell = env::var("SHELL").ok();
    let shells = shell_lookup_candidates(preferred_shell.as_deref());
    resolve_interactive_shell_path_with_shells_and_env(&shells, &[])
}

fn resolve_interactive_shell_path_with_shells_and_env(
    shells: &[String],
    environment_overrides: &[(&str, &OsStr)],
) -> Option<OsString> {
    for shell in shells {
        if let Some(path) = resolve_path_with_shell(shell, environment_overrides) {
            return Some(path);
        }
    }
    None
}

fn resolve_path_with_shell(
    shell: &str,
    environment_overrides: &[(&str, &OsStr)],
) -> Option<OsString> {
    let mut process = Command::new(shell);
    process.args(["-lic", "printf %s \"$PATH\""]);
    for (key, value) in environment_overrides {
        process.env(key, value);
    }

    let output = process.output().ok()?;
    if !output.status.success() {
        return None;
    }

    let path = String::from_utf8_lossy(&output.stdout);
    let trimmed = path.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(OsString::from(trimmed))
    }
}

#[cfg(test)]
fn run_command_lookup_with_shells_and_env(
    command: &str,
    shells: &[String],
    environment_overrides: &[(&str, &OsStr)],
) -> Result<String, String> {
    run_command_lookup_with_path_with_shells_and_env(command, shells, environment_overrides)
        .map(|result| result.command)
}

fn run_command_lookup_with_path_with_shells_and_env(
    command: &str,
    shells: &[String],
    environment_overrides: &[(&str, &OsStr)],
) -> Result<CommandLookupResult, String> {
    let mut last_error = None;

    for shell in shells {
        // 先尝试 login 非交互式（-lc，加载 .zshenv/.zprofile，快），用于解析命令路径。
        let login_result =
            run_shell_command_lookup_with_path(shell, &["-lc"], command, environment_overrides);

        // 再尝试交互式（-lic，额外加载 .zshrc/.bashrc，含 nvm/rbenv 等用户配置）。
        // 优先采用 interactive 结果：它的 PATH 更完整，spawn 出的子进程才能找到
        // hook 脚本依赖的 node 等命令（用户常把 nvm 写在 .zshrc 而非 .zshenv）。
        // 若 interactive 失败但 login 成功，回退到 login 结果，保证命令仍可解析。
        let interactive_result =
            run_shell_command_lookup_with_path(shell, &["-lic"], command, environment_overrides);
        match (login_result, interactive_result) {
            (_, Ok(interactive)) => return Ok(interactive),
            (Ok(login), Err(_)) => return Ok(login),
            (Err(_), Err(error)) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| format!("未找到可执行命令：{}。", command)))
}

#[cfg(test)]
fn run_shell_command_lookup(
    shell: &str,
    shell_args: &[&str],
    command: &str,
    environment_overrides: &[(&str, &OsStr)],
) -> Result<String, String> {
    run_shell_command_lookup_with_path(shell, shell_args, command, environment_overrides)
        .map(|result| result.command)
}

fn run_shell_command_lookup_with_path(
    shell: &str,
    shell_args: &[&str],
    command: &str,
    environment_overrides: &[(&str, &OsStr)],
) -> Result<CommandLookupResult, String> {
    let quoted_command = shell_quote(command);
    let mut process = Command::new(shell);
    process.args(shell_args).arg(format!(
        "command -v {quoted_command} && printf '\\n{LOOKUP_PATH_MARKER}%s\\n{LOOKUP_ENV_MARKER}\\n' \"$PATH\" && env -0"
    ));
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

    parse_command_lookup_output(&output.stdout, command)
}

fn parse_command_lookup_output(
    stdout: &[u8],
    command: &str,
) -> Result<CommandLookupResult, String> {
    let marker = format!("{LOOKUP_ENV_MARKER}\n");
    let (metadata_bytes, environment_bytes) =
        if let Some(index) = find_byte_subsequence(stdout, marker.as_bytes()) {
            (&stdout[..index], &stdout[index + marker.len()..])
        } else {
            (stdout, &[][..])
        };

    let stdout = String::from_utf8_lossy(metadata_bytes);
    let mut resolved_command = None;
    let mut path = None;
    for line in stdout.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix(LOOKUP_PATH_MARKER) {
            if !value.is_empty() {
                path = Some(OsString::from(value));
            }
            continue;
        }
        if resolved_command.is_none() && !trimmed.is_empty() {
            resolved_command = Some(trimmed.to_string());
        }
    }

    let resolved_command = resolved_command.unwrap_or_default();
    if resolved_command.is_empty() {
        return Err(format!("未找到可执行命令：{}。", command));
    }

    Ok(CommandLookupResult {
        command: resolved_command,
        path,
        environment: parse_environment_entries(environment_bytes),
    })
}

fn find_byte_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn parse_environment_entries(environment_bytes: &[u8]) -> Vec<(OsString, OsString)> {
    environment_bytes
        .split(|byte| *byte == b'\0')
        .filter_map(|entry| {
            if entry.is_empty() {
                return None;
            }

            let entry = String::from_utf8_lossy(entry);
            let (key, value) = entry.split_once('=')?;
            Some((OsString::from(key), OsString::from(value)))
        })
        .collect()
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
            &[("HOME", home), ("ZDOTDIR", home), ("PATH", baseline_path)],
        );
        let interactive_result = run_shell_command_lookup(
            "/bin/zsh",
            &["-lic"],
            "redwhisk-test-agent",
            &[("HOME", home), ("ZDOTDIR", home), ("PATH", baseline_path)],
        );

        assert!(missing_result.is_err());
        assert_eq!(
            interactive_result.expect("interactive shell command"),
            command_path.display().to_string()
        );
    }

    #[test]
    fn interactive_shell_lookup_returns_loaded_path() {
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

        let lookup = run_shell_command_lookup_with_path(
            "/bin/zsh",
            &["-lic"],
            "redwhisk-test-agent",
            &[
                ("HOME", temp_dir.path().as_os_str()),
                ("ZDOTDIR", temp_dir.path().as_os_str()),
                ("PATH", OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin")),
            ],
        )
        .expect("interactive shell command");

        assert_eq!(lookup.command, command_path.display().to_string());
        let lookup_path = lookup.path.expect("lookup path");
        assert!(env::split_paths(&lookup_path).any(|path| path == bin_dir));
    }

    #[test]
    fn resolve_interactive_shell_path_loads_zshrc_directories() {
        // 模拟 GUI 启动：父进程只有 launchd 极简 PATH，nvm node 目录写在 .zshrc。
        // resolve_interactive_shell_path 应通过 -lic 加载 .zshrc，返回含该目录的 PATH。
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let bin_dir = temp_dir.path().join("bin");
        fs::create_dir_all(&bin_dir).expect("bin dir");
        fs::write(
            temp_dir.path().join(".zshrc"),
            format!("export PATH=\"{}:$PATH\"\n", bin_dir.display()),
        )
        .expect("zshrc");

        let path = resolve_interactive_shell_path_with_shells_and_env(
            &["/bin/zsh".to_string()],
            &[
                ("HOME", temp_dir.path().as_os_str()),
                ("ZDOTDIR", temp_dir.path().as_os_str()),
                ("PATH", OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin")),
            ],
        )
        .expect("resolved interactive path");

        assert!(
            env::split_paths(&path).any(|entry| entry == bin_dir),
            "解析出的 PATH 应包含 .zshrc 写入的目录，实际：{path:?}"
        );
    }

    #[test]
    fn resolve_interactive_shell_path_returns_none_when_shell_missing() {
        // 不可用的 shell 应优雅返回 None，由调用方回退到继承的 PATH。
        let path = resolve_interactive_shell_path_with_shells_and_env(
            &["/path/that/does/not/exist/redwhisk-shell".to_string()],
            &[],
        );
        assert!(path.is_none(), "不可用的 shell 应返回 None");
    }

    #[test]
    fn interactive_shell_lookup_returns_exported_environment() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let bin_dir = temp_dir.path().join("bin");
        let command_path = bin_dir.join("redwhisk-test-agent");
        fs::create_dir_all(&bin_dir).expect("bin dir");
        fs::write(&command_path, "#!/bin/sh\nexit 0\n").expect("test command");
        fs::set_permissions(&command_path, fs::Permissions::from_mode(0o755))
            .expect("executable command");
        fs::write(
            temp_dir.path().join(".zshrc"),
            format!(
                "export PATH=\"{}:$PATH\"\nexport GVM_ROOT=\"/tmp/redwhisk-gvm\"\n",
                bin_dir.display()
            ),
        )
        .expect("zshrc");

        let lookup = run_shell_command_lookup_with_path(
            "/bin/zsh",
            &["-lic"],
            "redwhisk-test-agent",
            &[
                ("HOME", temp_dir.path().as_os_str()),
                ("ZDOTDIR", temp_dir.path().as_os_str()),
                ("PATH", OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin")),
            ],
        )
        .expect("interactive shell command");

        assert!(lookup.environment.iter().any(|(key, value)| {
            key == OsStr::new("GVM_ROOT") && value == OsStr::new("/tmp/redwhisk-gvm")
        }));
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
            &[("HOME", home), ("ZDOTDIR", home), ("PATH", baseline_path)],
        )
        .expect("fallback shell command");

        assert_eq!(resolved_command, command_path.display().to_string());
    }

    #[test]
    fn command_lookup_prefers_interactive_path_when_login_resolves_but_misses_paths() {
        // 场景：命令在 .zshenv 的 PATH 里（login -lc 能找到），但用户还把另一个
        // 目录（模拟 nvm/node）写在 .zshrc 里。login 命中后仍应跑 interactive，
        // 采用 interactive 的完整 PATH，保证 spawn 出的子进程能找到 node 等依赖。
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let agent_dir = temp_dir.path().join("agent-bin");
        let extra_dir = temp_dir.path().join("extra-bin");
        let command_path = agent_dir.join("redwhisk-test-agent");
        fs::create_dir_all(&agent_dir).expect("agent bin dir");
        fs::create_dir_all(&extra_dir).expect("extra bin dir");
        fs::write(&command_path, "#!/bin/sh\nexit 0\n").expect("test command");
        fs::set_permissions(&command_path, fs::Permissions::from_mode(0o755))
            .expect("executable command");
        // .zshenv 只把 agent 目录加入 PATH（login -lc 能解析命令）。
        fs::write(
            temp_dir.path().join(".zshenv"),
            format!("export PATH=\"{}:$PATH\"\n", agent_dir.display()),
        )
        .expect("zshenv");
        // .zshrc 额外把 extra 目录加入 PATH（模拟 nvm node 目录）。
        fs::write(
            temp_dir.path().join(".zshrc"),
            format!("export PATH=\"{}:$PATH\"\n", extra_dir.display()),
        )
        .expect("zshrc");

        let home = temp_dir.path().as_os_str();
        let baseline_path = OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin");
        let lookup = run_command_lookup_with_path_with_shells_and_env(
            "redwhisk-test-agent",
            &["/bin/zsh".to_string()],
            &[("HOME", home), ("ZDOTDIR", home), ("PATH", baseline_path)],
        )
        .expect("command lookup");

        // 命令路径解析正确。
        assert_eq!(lookup.command, command_path.display().to_string());
        // PATH 应包含 extra 目录（来自 interactive .zshrc），login 阶段拿不到它。
        let path = lookup.path.expect("lookup path");
        let path_entries: Vec<_> = env::split_paths(&path).collect();
        assert!(
            path_entries.iter().any(|p| p == &extra_dir),
            "PATH 应包含 interactive 加载的 extra 目录，实际：{path_entries:?}"
        );
        assert!(
            lookup.environment.iter().any(|(key, value)| {
                key == OsStr::new("PATH") && env::split_paths(value).any(|entry| entry == extra_dir)
            }),
            "环境快照应包含 interactive PATH，实际：{:?}",
            lookup.environment
        );
    }
}
