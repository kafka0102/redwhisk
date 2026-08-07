//! Shell 类项目终端判定：空启动命令或等于默认 shell。

use std::path::Path;

/// 用户默认 shell：`$SHELL`，缺省 `/bin/zsh`。
pub(super) fn default_shell_command() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

/// 是否为 Shell 类项目终端的启动命令。
///
/// - trim 后为空 → Shell 类
/// - 规范化后与默认 shell 等价（绝对路径或 basename）→ Shell 类
/// - 其余为命令型
pub(super) fn is_shell_like_launch_command(launch_command: &str) -> bool {
    let trimmed = launch_command.trim();
    if trimmed.is_empty() {
        return true;
    }
    shell_commands_equivalent(trimmed, &default_shell_command())
}

fn shell_commands_equivalent(left: &str, right: &str) -> bool {
    if left == right {
        return true;
    }
    let left_base = Path::new(left)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(left);
    let right_base = Path::new(right)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(right);
    left_base == right_base
}

#[cfg(test)]
mod tests {
    use super::{is_shell_like_launch_command, shell_commands_equivalent};

    #[test]
    fn empty_or_whitespace_launch_command_is_shell_like() {
        assert!(is_shell_like_launch_command(""));
        assert!(is_shell_like_launch_command("   "));
        assert!(is_shell_like_launch_command("\t"));
    }

    #[test]
    fn default_shell_absolute_and_basename_are_shell_like() {
        let original = std::env::var_os("SHELL");
        // SAFETY: tests that mutate SHELL are serialized via terminal env lock in service tests;
        // these unit tests only set a known absolute path and restore on drop.
        std::env::set_var("SHELL", "/bin/zsh");
        assert!(is_shell_like_launch_command("/bin/zsh"));
        assert!(is_shell_like_launch_command("zsh"));
        assert!(is_shell_like_launch_command("  /bin/zsh  "));
        match original {
            Some(value) => std::env::set_var("SHELL", value),
            None => std::env::remove_var("SHELL"),
        }
    }

    #[test]
    fn business_commands_are_not_shell_like() {
        let original = std::env::var_os("SHELL");
        std::env::set_var("SHELL", "/bin/zsh");
        assert!(!is_shell_like_launch_command("pnpm dev"));
        assert!(!is_shell_like_launch_command("npm start"));
        assert!(!is_shell_like_launch_command("/usr/bin/python3"));
        match original {
            Some(value) => std::env::set_var("SHELL", value),
            None => std::env::remove_var("SHELL"),
        }
    }

    #[test]
    fn basename_equivalence_ignores_parent_path() {
        assert!(shell_commands_equivalent("/bin/zsh", "zsh"));
        assert!(shell_commands_equivalent("/usr/local/bin/zsh", "/bin/zsh"));
        assert!(!shell_commands_equivalent("/bin/bash", "/bin/zsh"));
    }
}
