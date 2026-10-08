//! DeepSeek 结构化启动参数。只允许 `dsh --profile acp`。

pub const DEEPSEEK_FALLBACK_BINARY: &str = "dsh";
pub const DEEPSEEK_PROFILE_FLAG: &str = "--profile";
pub const DEEPSEEK_ACP_PROFILE: &str = "acp";

/// 运行时 argv：不带模型、SDK 或 web 子命令。
pub fn build_deepseek_acp_args() -> Vec<String> {
    vec![
        DEEPSEEK_PROFILE_FLAG.to_string(),
        DEEPSEEK_ACP_PROFILE.to_string(),
    ]
}

/// 命令快照只保留可执行文件，并固定为 ACP profile。
///
/// 空命令、`dsh`、自定义路径、误写的 `web` / `--profile sdk` 都收成
/// `<program> --profile acp`。
pub fn build_deepseek_structured_command_snapshot(raw_command: &str) -> String {
    let program = raw_command
        .split_whitespace()
        .next()
        .filter(|part| !part.is_empty() && !part.starts_with('-'))
        .unwrap_or(DEEPSEEK_FALLBACK_BINARY);
    format!("{program} {DEEPSEEK_PROFILE_FLAG} {DEEPSEEK_ACP_PROFILE}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_or_dsh_snapshot_is_acp_profile() {
        assert_eq!(
            build_deepseek_structured_command_snapshot(""),
            "dsh --profile acp"
        );
        assert_eq!(
            build_deepseek_structured_command_snapshot("   "),
            "dsh --profile acp"
        );
        assert_eq!(
            build_deepseek_structured_command_snapshot("  dsh  "),
            "dsh --profile acp"
        );
    }

    #[test]
    fn custom_binary_keeps_path_and_drops_web_or_sdk() {
        assert_eq!(
            build_deepseek_structured_command_snapshot("/opt/bin/dsh"),
            "/opt/bin/dsh --profile acp"
        );
        assert_eq!(
            build_deepseek_structured_command_snapshot("dsh web"),
            "dsh --profile acp"
        );
        assert_eq!(
            build_deepseek_structured_command_snapshot("dsh --profile sdk"),
            "dsh --profile acp"
        );
    }

    #[test]
    fn runtime_args_are_only_profile_acp() {
        assert_eq!(build_deepseek_acp_args(), ["--profile", "acp"]);
    }
}
