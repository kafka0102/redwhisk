use std::env;
use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::process::Command;
use std::sync::{Mutex, Once, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use super::command_lookup_process::{
    extract_marked_path, output_on_pty_with_timeout, output_with_timeout, DEFAULT_LOOKUP_TIMEOUT,
    INTERACTIVE_PATH_TIMEOUT,
};

const DEFAULT_LOOKUP_SHELLS: [&str; 3] = ["/bin/zsh", "/bin/bash", "/bin/sh"];
const LOOKUP_PATH_MARKER: &str = "__REDWHISK_LOOKUP_PATH__=";
const LOOKUP_ENV_MARKER: &str = "__REDWHISK_LOOKUP_ENV__";
const PATH_PROBE_COMMAND: &str = "printf '\n__REDWHISK_LOOKUP_PATH__=%s\n' \"$PATH\"";

/// 「login+interactive shell」解析出的完整 `$PATH`；解析失败或尚未解析时为 `None`。
static INTERACTIVE_SHELL_PATH: OnceLock<OsString> = OnceLock::new();

/// 交互式 PATH 探测的单飞锁。
///
/// 应用启动会同时恢复多个项目终端，若每个 spawn 各自拉起一个交互式 shell，实测
/// 单次 `.zshrc`（nvm / compinit / pyenv / rbenv）加载会从数秒涨到 40s 以上，集体
/// 越过 `INTERACTIVE_PATH_TIMEOUT`。这里串行化探测，其余 spawn 复用同一结果。
static INTERACTIVE_PROBE_LOCK: Mutex<()> = Mutex::new(());

/// 交互式探测的尝试轮数（共享 `INTERACTIVE_PATH_TIMEOUT` 总预算）。
///
/// 失败后重试可以救回「快速失败」（PTY 分配失败、shell 早退等）的一次抖动；
/// 若首轮就吃满预算（真超时），剩余预算为 0 会直接跳到回退，避免成倍阻塞。
const INTERACTIVE_PROBE_ATTEMPTS: usize = 2;

#[cfg(test)]
thread_local! {
    /// 测试专用：当前线程固定的交互式 PATH 解析结果，优先于进程级缓存。
    ///
    /// 生产环境进程 env（`HOME` / `ZDOTDIR` / `SHELL` / `PATH`）在生命周期内不变，
    /// 进程级缓存成立；测试会改这些 env，同一测试二进制内多个 spawn 测试并发跑时
    /// 会命中别人的缓存并拿到错误 PATH，因此按线程固定结果。
    static TEST_INTERACTIVE_SHELL_PATH: std::cell::RefCell<Option<Option<OsString>>> =
        const { std::cell::RefCell::new(None) };
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandLookupResult {
    pub command: String,
    pub path: Option<OsString>,
    pub environment: Vec<(OsString, OsString)>,
}

pub trait AgentCommandDetector {
    /// 探测任意命令名是否在本机可用，返回解析后的命令路径或原始名。
    ///
    /// 见 ADR-0020：app 启动时按 `[codex, claude, opencode, grok]` 顺序逐个调用本方法，
    /// 探测成功且库中无对应记录则播种默认 profile。
    fn detect_command(&self, command_name: &str) -> Result<String, String>;

    /// 探测 codex 命令（向后兼容入口）；默认委托 `detect_command("codex")`。
    fn detect_codex_command(&self) -> Result<String, String> {
        self.detect_command("codex")
    }

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
    fn detect_command(&self, command_name: &str) -> Result<String, String> {
        run_command_lookup(command_name)
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
/// 交互式探测必须走 PTY：管道 + `-lic` 没有 TTY 时，nvm 等 hook 会 timeout，
/// 2s 超时后注入失败，项目终端 `-lc` 启动命令就会 `command not found: pnpm`。
///
/// 探测在并发 spawn 下单飞串行（见 `INTERACTIVE_PROBE_LOCK`），失败按
/// `INTERACTIVE_PROBE_ATTEMPTS` 重试（各次共享 `INTERACTIVE_PATH_TIMEOUT` 总预算，
/// 该预算按重载机器实测给足）；只有交互式探测结果才写入进程级缓存。
/// 全部失败才回退 login `-lc` 的 PATH，且该回退不写缓存——它是降级值（缺
/// `.zshrc` 的 nvm/node/pnpm 目录），缓存会让整个进程后续 spawn 全部失效。
/// 连回退都失败则返回 `None`，调用方回退到继承的 PATH。
pub(crate) fn resolve_interactive_shell_path() -> Option<OsString> {
    #[cfg(test)]
    if let Some(overridden) = TEST_INTERACTIVE_SHELL_PATH.with(|slot| slot.borrow().clone()) {
        return overridden;
    }

    if let Some(path) = INTERACTIVE_SHELL_PATH.get() {
        return Some(path.clone());
    }

    // 单飞 + 双重检查：并发 spawn 只拉起一个交互式 shell。
    let _guard = INTERACTIVE_PROBE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(path) = INTERACTIVE_SHELL_PATH.get() {
        return Some(path.clone());
    }

    let preferred_shell = env::var("SHELL").ok();
    let shells = shell_lookup_candidates(preferred_shell.as_deref());
    let resolution = resolve_interactive_path_with(
        |deadline| probe_interactive_path(&shells, &[], deadline),
        || probe_login_path(&shells, &[]),
    );
    // 只有交互式探测的结果才进缓存。login 回退 PATH 缺 `.zshrc` 写入的 nvm / node /
    // pnpm / codex 目录，一旦缓存，进程内后续所有 spawn 都会命中这份降级 PATH。
    if resolution.cacheable {
        if let Some(path) = resolution.path.as_ref() {
            let _ = INTERACTIVE_SHELL_PATH.set(path.clone());
        }
    }
    resolution.path
}

/// 测试专用：把当前线程的交互式 PATH 解析结果固定为 `path`（`None` 表示解析失败），
/// drop 时恢复原值。
#[cfg(test)]
pub(crate) struct TestInteractiveShellPathGuard {
    previous: Option<Option<OsString>>,
}

#[cfg(test)]
impl Drop for TestInteractiveShellPathGuard {
    fn drop(&mut self) {
        TEST_INTERACTIVE_SHELL_PATH.with(|slot| *slot.borrow_mut() = self.previous.take());
    }
}

#[cfg(test)]
pub(crate) fn pin_test_interactive_shell_path(
    path: Option<OsString>,
) -> TestInteractiveShellPathGuard {
    let previous = TEST_INTERACTIVE_SHELL_PATH.with(|slot| slot.replace(Some(path)));
    TestInteractiveShellPathGuard { previous }
}

/// 测试专用：按当前进程 env 解析交互式 PATH，但不写进程级缓存、不读测试覆盖值。
#[cfg(test)]
pub(crate) fn resolve_interactive_shell_path_without_cache() -> Option<OsString> {
    let preferred_shell = env::var("SHELL").ok();
    let shells = shell_lookup_candidates(preferred_shell.as_deref());
    resolve_interactive_shell_path_with_shells_and_env(&shells, &[])
}

/// 一次交互式 PATH 解析的结果。
struct InteractivePathResolution {
    /// 本次 spawn 可注入的 PATH；连 login 回退都失败时为 `None`。
    path: Option<OsString>,
    /// 结果来自交互式 PTY 探测、可写入进程级缓存。login 回退为 `false`。
    cacheable: bool,
}

/// 交互式 PATH 解析策略：先用 `-lic` 走 PTY（加载 `.zshrc`）并允许重试，全部失败
/// 才回退 login `-lc`，且回退结果不带缓存资格。
fn resolve_interactive_path_with(
    mut probe_interactive: impl FnMut(Instant) -> Option<OsString>,
    probe_login_fallback: impl FnOnce() -> Option<OsString>,
) -> InteractivePathResolution {
    let deadline = Instant::now() + INTERACTIVE_PATH_TIMEOUT;
    for _ in 0..INTERACTIVE_PROBE_ATTEMPTS {
        if Instant::now() >= deadline {
            break;
        }
        if let Some(path) = probe_interactive(deadline) {
            return InteractivePathResolution {
                path: Some(path),
                cacheable: true,
            };
        }
    }

    InteractivePathResolution {
        path: probe_login_fallback(),
        cacheable: false,
    }
}

/// 读取已解析的交互式 `PATH`；未解析时立即返回 `None`，不触发 shell 探测。
///
/// 供「不能等待数秒 shell 探测」的热路径使用，配合 [`warm_interactive_shell_path`] 预热。
pub(crate) fn resolved_interactive_shell_path() -> Option<OsString> {
    INTERACTIVE_SHELL_PATH.get().cloned()
}

/// 后台预热交互式 `PATH`，进程内只启动一次。
///
/// 解析要拉起 login+interactive shell 并加载 `.zshrc`（nvm / compinit 等），实测可达
/// 数秒；预热把这段成本放到后台线程，让首次打开项目等热路径直接命中缓存。
pub(crate) fn warm_interactive_shell_path() {
    static WARMING: Once = Once::new();
    WARMING.call_once(|| {
        thread::spawn(|| {
            let _ = resolve_interactive_shell_path();
        });
    });
}

fn resolve_interactive_shell_path_with_shells_and_env(
    shells: &[String],
    environment_overrides: &[(&str, &OsStr)],
) -> Option<OsString> {
    resolve_interactive_path_with(
        |deadline| probe_interactive_path(shells, environment_overrides, deadline),
        || probe_login_path(shells, environment_overrides),
    )
    .path
}

/// 用 `-lic` 走 PTY 解析交互式 `$PATH`（加载 `.zshrc` 等交互式配置）。
fn probe_interactive_path(
    shells: &[String],
    environment_overrides: &[(&str, &OsStr)],
    deadline: Instant,
) -> Option<OsString> {
    for shell in shells {
        // 每换一个 shell 重新计算剩余预算，避免前一个 shell 吃满后仍继续等待。
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return None;
        }
        if let Some(path) = probe_path_on_pty(
            shell,
            &["-lic", PATH_PROBE_COMMAND],
            environment_overrides,
            remaining,
        ) {
            return Some(path);
        }
    }
    None
}

/// `-lc` 非交互 login shell 的 `$PATH`：不含 `.zshrc` 目录，只作持久失败时的回退。
fn probe_login_path(
    shells: &[String],
    environment_overrides: &[(&str, &OsStr)],
) -> Option<OsString> {
    shells.iter().find_map(|shell| {
        probe_path_piped(shell, &["-lc", PATH_PROBE_COMMAND], environment_overrides)
    })
}

fn probe_path_on_pty(
    shell: &str,
    args: &[&str],
    environment_overrides: &[(&str, &OsStr)],
    timeout: Duration,
) -> Option<OsString> {
    let output = output_on_pty_with_timeout(shell, args, environment_overrides, timeout).ok()?;
    extract_marked_path(&output, LOOKUP_PATH_MARKER)
}

fn probe_path_piped(
    shell: &str,
    args: &[&str],
    environment_overrides: &[(&str, &OsStr)],
) -> Option<OsString> {
    let mut process = Command::new(shell);
    process.args(args);
    for (key, value) in environment_overrides {
        process.env(key, value);
    }

    let output = output_with_timeout(process, DEFAULT_LOOKUP_TIMEOUT).ok()?;
    extract_marked_path(&output.stdout, LOOKUP_PATH_MARKER)
        .or_else(|| extract_marked_path(&output.stderr, LOOKUP_PATH_MARKER))
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
            (Err(_), Err(error)) => {
                last_error = Some(error);
                // 管道 `-lic` 只有 2s 超时：真实 `.zshrc`（nvm/compinit 等）常要
                // 5s+，无 TTY 时还会卡住。login 也找不到只存在于 `.zshrc` 的命令
                // （如 npm 全局 `codex`）。此时用 PTY 解析出的交互式 PATH 搜可执行文件。
                if let Some(path) = interactive_path_for_lookup(shells, environment_overrides) {
                    if let Some(resolved_command) = find_executable_in_path(command, &path) {
                        return Ok(CommandLookupResult {
                            command: resolved_command,
                            path: Some(path),
                            environment: Vec::new(),
                        });
                    }
                }
            }
        }
    }

    Err(last_error.unwrap_or_else(|| format!("未找到可执行命令：{}。", command)))
}

fn interactive_path_for_lookup(
    shells: &[String],
    environment_overrides: &[(&str, &OsStr)],
) -> Option<OsString> {
    if environment_overrides.is_empty() {
        resolve_interactive_shell_path()
    } else {
        resolve_interactive_shell_path_with_shells_and_env(shells, environment_overrides)
    }
}

fn find_executable_in_path(command: &str, path: &OsStr) -> Option<String> {
    if command.is_empty() || Path::new(command).components().count() > 1 {
        return None;
    }

    env::split_paths(path).find_map(|dir| {
        if dir.as_os_str().is_empty() {
            return None;
        }
        let candidate = dir.join(command);
        candidate
            .is_file()
            .then(|| candidate.to_string_lossy().into_owned())
    })
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

    let output = output_with_timeout(process, DEFAULT_LOOKUP_TIMEOUT)
        .map_err(|error| error.to_lookup_message(command))?;

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
    use std::time::{Duration, Instant};

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
    fn resolve_interactive_shell_path_uses_tty_when_non_tty_rc_blocks() {
        // 复现 GUI 终端找不到 pnpm：.zshrc 只在 TTY 下写入 PATH，非 TTY 则卡住。
        // 管道 -lic 会走卡住分支并超时；PTY 解析应拿到目录。
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let bin_dir = temp_dir.path().join("bin");
        fs::create_dir_all(&bin_dir).expect("bin dir");
        fs::write(
            temp_dir.path().join(".zshrc"),
            format!(
                "if [[ -t 0 ]]; then export PATH=\"{}:$PATH\"; else sleep 20; fi\n",
                bin_dir.display()
            ),
        )
        .expect("zshrc");

        let started = Instant::now();
        let path = resolve_interactive_shell_path_with_shells_and_env(
            &["/bin/zsh".to_string()],
            &[
                ("HOME", temp_dir.path().as_os_str()),
                ("ZDOTDIR", temp_dir.path().as_os_str()),
                ("PATH", OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin")),
            ],
        )
        .expect("resolved interactive path via TTY");

        assert!(
            started.elapsed() < Duration::from_secs(6),
            "非 TTY 卡住时必须走 PTY 解析，实际 {:?}",
            started.elapsed()
        );
        assert!(
            env::split_paths(&path).any(|entry| entry == bin_dir),
            "PTY 解析出的 PATH 应包含 .zshrc 写入的目录，实际：{path:?}"
        );
    }

    #[test]
    fn command_lookup_finds_zshrc_binary_when_non_tty_rc_blocks() {
        // 复现 GUI 执行 Issue：codex 只在 .zshrc/nvm PATH 里，管道 -lic 超时，
        // login -lc 也找不到。应走 PTY PATH 搜索拿到绝对路径。
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
                "if [[ -t 0 ]]; then export PATH=\"{}:$PATH\"; else sleep 20; fi\n",
                bin_dir.display()
            ),
        )
        .expect("zshrc");

        let started = Instant::now();
        let lookup = run_command_lookup_with_path_with_shells_and_env(
            "redwhisk-test-agent",
            &["/bin/zsh".to_string()],
            &[
                ("HOME", temp_dir.path().as_os_str()),
                ("ZDOTDIR", temp_dir.path().as_os_str()),
                ("PATH", OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin")),
            ],
        )
        .expect("pty path fallback should find command");

        assert!(
            started.elapsed() < Duration::from_secs(8),
            "管道 -lic 超时后必须走 PTY PATH 搜索，实际 {:?}",
            started.elapsed()
        );
        assert_eq!(lookup.command, command_path.display().to_string());
        let lookup_path = lookup.path.expect("lookup path");
        assert!(
            env::split_paths(&lookup_path).any(|entry| entry == bin_dir),
            "回退 PATH 应包含 .zshrc 写入的目录，实际：{lookup_path:?}"
        );
    }

    #[test]
    fn find_executable_in_path_returns_first_match() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let first = temp_dir.path().join("first");
        let second = temp_dir.path().join("second");
        fs::create_dir_all(&first).expect("first dir");
        fs::create_dir_all(&second).expect("second dir");
        let first_command = first.join("redwhisk-which");
        let second_command = second.join("redwhisk-which");
        fs::write(&first_command, "#!/bin/sh\nexit 0\n").expect("first command");
        fs::write(&second_command, "#!/bin/sh\nexit 0\n").expect("second command");
        fs::set_permissions(&first_command, fs::Permissions::from_mode(0o755)).expect("chmod");
        fs::set_permissions(&second_command, fs::Permissions::from_mode(0o755)).expect("chmod");

        let path = env::join_paths([&first, &second]).expect("join paths");
        assert_eq!(
            find_executable_in_path("redwhisk-which", &path).as_deref(),
            Some(first_command.to_str().expect("utf8 path"))
        );
        assert_eq!(find_executable_in_path("missing-bin", &path), None);
        assert_eq!(
            find_executable_in_path("/tmp/redwhisk-which", &path),
            None,
            "带路径的命令名不应再扫 PATH"
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

    #[test]
    fn command_lookup_falls_back_when_interactive_shell_rc_blocks() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let bin_dir = temp_dir.path().join("bin");
        let command_path = bin_dir.join("redwhisk-test-agent");
        fs::create_dir_all(&bin_dir).expect("bin dir");
        fs::write(&command_path, "#!/bin/sh\nexit 0\n").expect("test command");
        fs::set_permissions(&command_path, fs::Permissions::from_mode(0o755))
            .expect("executable command");
        fs::write(
            temp_dir.path().join(".zshenv"),
            format!("export PATH=\"{}:$PATH\"\n", bin_dir.display()),
        )
        .expect("zshenv");
        fs::write(temp_dir.path().join(".zshrc"), "sleep 20\n").expect("hanging zshrc");

        let home = temp_dir.path().as_os_str();
        let baseline_path = OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin");
        let started = Instant::now();
        let lookup = run_command_lookup_with_path_with_shells_and_env(
            "redwhisk-test-agent",
            &["/bin/zsh".to_string()],
            &[("HOME", home), ("ZDOTDIR", home), ("PATH", baseline_path)],
        )
        .expect("login fallback");

        assert_eq!(lookup.command, command_path.display().to_string());
        assert!(
            started.elapsed() < Duration::from_secs(6),
            "交互式 rc 卡住时必须超时回退，实际 {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn resolve_interactive_shell_path_retries_transient_probe_failure() {
        // 线上事故复现：GUI 启动恢复多个项目终端时，交互式 PTY 探测在负载下首次失败
        // （这里用「首次 PTY 探测不输出 marker」等价表达）。旧实现立刻把 login `-lc`
        // PATH 当成交互式 PATH 返回并缓存，之后所有 spawn 都拿到没有 nvm/node 的
        // PATH，报 `env: node: No such file or directory`（终端启动命令）与
        // `codex: No such file or directory`（Agent 会话）。
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let bin_dir = temp_dir.path().join("bin");
        fs::create_dir_all(&bin_dir).expect("bin dir");
        fs::write(
            temp_dir.path().join(".zshrc"),
            format!(
                "if [[ -t 0 ]]; then\n  if [[ -f \"$HOME/.probe-attempted\" ]]; then\n    export PATH=\"{bin}:$PATH\"\n  else\n    : > \"$HOME/.probe-attempted\"\n    exit 0\n  fi\nfi\n",
                bin = bin_dir.display()
            ),
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
        .expect("transient failure should be retried");

        assert!(
            env::split_paths(&path).any(|entry| entry == bin_dir),
            "首次交互式探测失败时应重试，而不是回退 login PATH，实际：{path:?}"
        );
    }

    #[test]
    fn interactive_path_fallback_is_not_cacheable() {
        // 持久失败时才允许回退 login PATH，但它不是交互式 PATH，绝不能写进缓存：
        // 一旦缓存，整个进程后续 spawn 都缺 .zshrc 写入的目录（nvm/node/pnpm）。
        let resolution = resolve_interactive_path_with(
            |_deadline| None,
            || Some(OsString::from("/usr/local/bin:/usr/bin:/bin")),
        );

        assert_eq!(
            resolution.path.as_deref(),
            Some(OsStr::new("/usr/local/bin:/usr/bin:/bin")),
            "交互式探测持久失败时应保留 login 回退 PATH 供本次 spawn 使用"
        );
        assert!(
            !resolution.cacheable,
            "login 回退 PATH 不得写入交互式 PATH 缓存"
        );
    }

    #[test]
    fn interactive_path_resolution_marks_pty_result_cacheable() {
        let resolution = resolve_interactive_path_with(
            |_deadline| Some(OsString::from("/nvm/bin:/usr/bin:/bin")),
            || panic!("交互式探测成功时不应再跑 login 回退"),
        );

        assert_eq!(
            resolution.path.as_deref(),
            Some(OsStr::new("/nvm/bin:/usr/bin:/bin"))
        );
        assert!(resolution.cacheable, "交互式探测结果应写进缓存");
    }
}
