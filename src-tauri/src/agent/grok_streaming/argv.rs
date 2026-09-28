//! Grok 结构化（`grok agent stdio`）启动 argv 拼装（纯函数，可单测）。

use crate::types::agent_session::AgentMessageAttachment;

pub const GROK_AGENT_SUBCOMMAND: &str = "agent";
pub const GROK_STDIO_SUBCOMMAND: &str = "stdio";
pub const GROK_ALWAYS_APPROVE_ARG: &str = "--always-approve";
pub const GROK_MODEL_FLAG: &str = "-m";

/// 构造结构化启动参数：`agent [--always-approve] [-m <model>] stdio`。
///
/// `--always-approve` / `-m` 是 `grok agent` 层参数，**必须**出现在 `stdio`
/// 子命令之前——放到子命令之后 grok 会报 `unexpected argument`。
pub fn build_grok_agent_args(
    mode_id: Option<&str>,
    dangerous: bool,
    model: Option<&str>,
) -> Vec<String> {
    let mut args = vec![GROK_AGENT_SUBCOMMAND.to_string()];
    if should_always_approve(mode_id, dangerous) {
        args.push(GROK_ALWAYS_APPROVE_ARG.to_string());
    }
    if let Some(model) = model.map(str::trim).filter(|model| !model.is_empty()) {
        args.push(GROK_MODEL_FLAG.to_string());
        args.push(model.to_string());
    }
    args.push(GROK_STDIO_SUBCOMMAND.to_string());
    args
}

/// `dangerous` 或 `mode=full-access` 时注入 `--always-approve`。
///
/// 与 Grok TUI（`build_grok_tui_command_snapshot`）和 OpenCode json
/// (`--auto`) 的既有策略一致。
pub fn should_always_approve(mode_id: Option<&str>, dangerous: bool) -> bool {
    dangerous || mode_id.is_some_and(|mode| mode == "full-access")
}

/// Grok ACP 仅接受文本 prompt：把附件路径附在正文后。
pub fn append_attachment_paths(text: &str, attachments: &[AgentMessageAttachment]) -> String {
    if attachments.is_empty() {
        return text.to_string();
    }
    let mut lines = vec![text.to_string(), String::new(), "Attachments:".to_string()];
    for attachment in attachments {
        lines.push(format!(
            "- {}: {}",
            attachment.display_name, attachment.path
        ));
    }
    lines.push("请先读取这些附件文件。".to_string());
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_minimal_agent_stdio_args() {
        assert_eq!(build_grok_agent_args(None, false, None), ["agent", "stdio"]);
    }

    #[test]
    fn injects_always_approve_before_stdio_on_dangerous_or_full_access() {
        assert_eq!(
            build_grok_agent_args(None, true, None),
            ["agent", "--always-approve", "stdio"]
        );
        assert_eq!(
            build_grok_agent_args(Some("full-access"), false, None),
            ["agent", "--always-approve", "stdio"]
        );
    }

    #[test]
    fn does_not_inject_always_approve_for_safe_modes() {
        assert_eq!(
            build_grok_agent_args(Some("auto"), false, None),
            ["agent", "stdio"]
        );
        assert!(!should_always_approve(Some("acceptEdits"), false));
    }

    #[test]
    fn injects_model_flag_before_stdio() {
        let args = build_grok_agent_args(Some("full-access"), false, Some("grok-4.7-build"));
        assert_eq!(
            args,
            ["agent", "--always-approve", "-m", "grok-4.7-build", "stdio"]
        );
        assert_eq!(args.last().map(String::as_str), Some("stdio"));
    }

    #[test]
    fn trims_and_skips_blank_model() {
        assert_eq!(
            build_grok_agent_args(None, false, Some("  ")),
            ["agent", "stdio"]
        );
        assert_eq!(
            build_grok_agent_args(None, false, Some(" grok-4 ")),
            ["agent", "-m", "grok-4", "stdio"]
        );
    }

    #[test]
    fn append_attachment_paths_keeps_plain_text() {
        assert_eq!(append_attachment_paths("hi", &[]), "hi");
    }
}
