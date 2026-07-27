//! OpenCode json 路径启动 argv 拼装（纯函数，可单测）。

use crate::types::agent_session::AgentMessageAttachment;

/// 构造 `opencode run --format json` 参数。
///
/// 顺序：`run --format json [--auto] [-s id] [-m model] <prompt>`。
/// **禁止** `--command`。
pub fn build_opencode_run_args(
    prompt: &str,
    resume_session_id: Option<&str>,
    model: Option<&str>,
    use_auto: bool,
) -> Vec<String> {
    let mut args = vec![
        "run".to_string(),
        "--format".to_string(),
        "json".to_string(),
    ];
    if use_auto {
        args.push("--auto".to_string());
    }
    if let Some(session_id) = resume_session_id {
        args.push("-s".into());
        args.push(session_id.to_string());
    }
    if let Some(model) = model {
        args.push("-m".into());
        args.push(model.to_string());
    }
    args.push(prompt.to_string());
    args
}

pub fn should_use_auto(mode_id: Option<&str>, dangerous: bool) -> bool {
    dangerous || mode_id.is_some_and(|m| m == "full-access")
}

/// OpenCode 仅接受纯文本 prompt：把附件路径附在正文后。
pub fn append_attachment_paths(text: &str, attachments: &[AgentMessageAttachment]) -> String {
    if attachments.is_empty() {
        return text.to_string();
    }
    let mut lines = vec![text.to_string(), String::new(), "Attachments:".to_string()];
    for attachment in attachments {
        lines.push(format!("- {}: {}", attachment.display_name, attachment.path));
    }
    lines.push("请先读取这些附件文件。".to_string());
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_args_base_shape_is_run_format_json_message() {
        let args = build_opencode_run_args("hello", None, None, false);
        assert_eq!(args[..3], ["run", "--format", "json"]);
        assert_eq!(args.last().map(String::as_str), Some("hello"));
        assert!(!args.iter().any(|a| a == "--command"));
        assert!(!args.iter().any(|a| a == "--auto"));
        assert!(!args.iter().any(|a| a == "-s"));
        assert!(!args.iter().any(|a| a == "-m"));
    }

    #[test]
    fn build_args_with_resume_model_and_auto() {
        let args =
            build_opencode_run_args("continue", Some("ses_abc"), Some("openai/gpt-5"), true);
        assert!(args.contains(&"--auto".into()));
        assert!(args.contains(&"-s".into()));
        assert!(args.contains(&"ses_abc".into()));
        assert!(args.contains(&"-m".into()));
        assert!(args.contains(&"openai/gpt-5".into()));
        assert_eq!(args.last().map(String::as_str), Some("continue"));
        assert!(!args.iter().any(|a| a == "--command"));
    }

    #[test]
    fn should_use_auto_for_dangerous_or_full_access() {
        assert!(should_use_auto(None, true));
        assert!(should_use_auto(Some("full-access"), false));
        assert!(!should_use_auto(Some("auto"), false));
        assert!(!should_use_auto(None, false));
    }

    #[test]
    fn append_attachment_paths_keeps_plain_text() {
        assert_eq!(append_attachment_paths("hi", &[]), "hi");
    }
}
