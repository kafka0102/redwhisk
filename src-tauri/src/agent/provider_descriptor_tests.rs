use super::*;
use std::fs;

fn codex_data_dir(temp: &tempfile::TempDir) -> std::path::PathBuf {
    // 约定：data_dir 的 parent 即 home；temp.path() 当 home，data_dir = home/data。
    temp.path().join("data")
}

fn write_codex_config(home: &Path, model: Option<&str>, effort: Option<&str>) {
    let codex_dir = home.join(".codex");
    fs::create_dir_all(&codex_dir).expect("codex dir");
    let mut content = String::new();
    if let Some(model) = model {
        content.push_str(&format!("model = \"{model}\"\n"));
    }
    if let Some(effort) = effort {
        content.push_str(&format!("model_reasoning_effort = \"{effort}\"\n"));
    }
    fs::write(codex_dir.join("config.toml"), content).expect("write config");
}

#[test]
fn descriptor_for_returns_matching_descriptor() {
    assert_eq!(
        descriptor_for(&AgentType::Codex).agent_type(),
        AgentType::Codex
    );
    assert_eq!(
        descriptor_for(&AgentType::Claude).agent_type(),
        AgentType::Claude
    );
    assert_eq!(
        descriptor_for(&AgentType::OpenCode).agent_type(),
        AgentType::OpenCode
    );
    assert_eq!(
        descriptor_for(&AgentType::Grok).agent_type(),
        AgentType::Grok
    );
}

#[test]
fn codex_resolve_runtime_config_reads_from_data_dir_parent() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_config(temp.path(), Some("gpt-5"), Some("high"));
    let data_dir = codex_data_dir(&temp);

    let config = CodexDescriptor.resolve_runtime_config(&data_dir, "codex", None, None);
    assert_eq!(config.model.as_deref(), Some("gpt-5"));
    assert_eq!(config.effort.as_deref(), Some("high"));
}

#[test]
fn codex_resolve_runtime_config_prefers_requested_over_config() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_config(temp.path(), Some("gpt-5"), Some("high"));
    let data_dir = codex_data_dir(&temp);

    let config =
        CodexDescriptor.resolve_runtime_config(&data_dir, "codex", Some("gpt-5.5"), Some("xhigh"));
    assert_eq!(config.model.as_deref(), Some("gpt-5.5"));
    assert_eq!(config.effort.as_deref(), Some("xhigh"));
}

#[test]
fn claude_resolve_runtime_config_ignores_effort_and_data_dir() {
    let temp = tempfile::tempdir().expect("temp");
    let data_dir = codex_data_dir(&temp);

    let config =
        ClaudeDescriptor.resolve_runtime_config(&data_dir, "claude", Some("sonnet"), Some("high"));
    assert_eq!(config.model.as_deref(), Some("sonnet"));
    assert!(config.effort.is_none());
}

#[test]
fn claude_resolve_runtime_config_returns_none_when_no_request() {
    let temp = tempfile::tempdir().expect("temp");
    let data_dir = codex_data_dir(&temp);

    let config = ClaudeDescriptor.resolve_runtime_config(&data_dir, "claude", None, None);
    assert!(config.model.is_none());
    assert!(config.effort.is_none());
}

#[test]
fn codex_build_command_snapshot_with_bypass_appends_flag() {
    assert_eq!(
        CodexDescriptor.build_command_snapshot_with_bypass("codex"),
        "codex --dangerously-bypass-approvals-and-sandbox"
    );
}

#[test]
fn codex_build_command_snapshot_with_bypass_keeps_existing_flag() {
    assert_eq!(
        CodexDescriptor
            .build_command_snapshot_with_bypass("codex --dangerously-bypass-approvals-and-sandbox"),
        "codex --dangerously-bypass-approvals-and-sandbox"
    );
}

#[test]
fn claude_build_command_snapshot_with_bypass_appends_permission_mode() {
    assert_eq!(
        ClaudeDescriptor.build_command_snapshot_with_bypass("claude"),
        "claude --permission-mode bypassPermissions"
    );
}

#[test]
fn claude_build_command_snapshot_with_bypass_keeps_existing_permission_mode() {
    assert_eq!(
        ClaudeDescriptor.build_command_snapshot_with_bypass("claude --permission-mode auto"),
        "claude --permission-mode auto"
    );
}

#[test]
fn codex_build_launch_command_snapshot_trims_only() {
    assert_eq!(
        CodexDescriptor.build_launch_command_snapshot(" codex-asxs "),
        "codex-asxs"
    );
}

#[test]
fn claude_build_launch_command_snapshot_appends_bypass() {
    assert_eq!(
        ClaudeDescriptor.build_launch_command_snapshot("claude"),
        "claude --permission-mode bypassPermissions"
    );
}

#[test]
fn fallback_command_when_snapshot_empty_returns_default_with_bypass() {
    assert_eq!(
        CodexDescriptor.fallback_command_when_snapshot_empty(),
        "codex --dangerously-bypass-approvals-and-sandbox"
    );
    assert_eq!(
        ClaudeDescriptor.fallback_command_when_snapshot_empty(),
        "claude --permission-mode bypassPermissions"
    );
}

#[test]
fn codex_list_models_marks_selected_from_config() {
    let temp = tempfile::tempdir().expect("temp");
    write_codex_config(temp.path(), Some("gpt-5"), None);

    let models = CodexDescriptor.list_models(temp.path(), "codex");
    let default = models
        .iter()
        .find(|m| m.is_default == Some(true))
        .expect("有一个默认模型");
    assert_eq!(default.model_id, "gpt-5");
}

#[test]
fn codex_is_model_list_read_only_is_always_false() {
    let temp = tempfile::tempdir().expect("temp");
    assert!(!CodexDescriptor.is_model_list_read_only(temp.path()));
}

#[test]
fn claude_list_models_empty_when_no_settings() {
    let temp = tempfile::tempdir().expect("temp");
    assert!(ClaudeDescriptor
        .list_models(temp.path(), "claude")
        .is_empty());
}

#[test]
fn claude_list_models_official_marks_current_default() {
    let temp = tempfile::tempdir().expect("temp");
    let claude_dir = temp.path().join(".claude");
    fs::create_dir_all(&claude_dir).expect("claude dir");
    fs::write(
        claude_dir.join("settings.json"),
        r#"{"model": "sonnet", "env": {}}"#,
    )
    .expect("write settings");

    let models = ClaudeDescriptor.list_models(temp.path(), "claude");
    let ids: Vec<&str> = models.iter().map(|m| m.model_id.as_str()).collect();
    assert_eq!(ids, vec!["opus", "sonnet", "haiku"]);
    let default = models
        .iter()
        .find(|m| m.is_default == Some(true))
        .expect("sonnet 默认");
    assert_eq!(default.model_id, "sonnet");
}

#[test]
fn claude_is_model_list_read_only_detects_third_party() {
    let temp = tempfile::tempdir().expect("temp");
    let claude_dir = temp.path().join(".claude");
    fs::create_dir_all(&claude_dir).expect("claude dir");
    fs::write(
        claude_dir.join("settings.json"),
        r#"{"model": "sonnet[1m]", "env": {"ANTHROPIC_BASE_URL": "http://x:9009"}}"#,
    )
    .expect("write settings");

    assert!(ClaudeDescriptor.is_model_list_read_only(temp.path()));
}

#[test]
fn claude_is_model_list_read_only_false_for_official() {
    let temp = tempfile::tempdir().expect("temp");
    let claude_dir = temp.path().join(".claude");
    fs::create_dir_all(&claude_dir).expect("claude dir");
    fs::write(
        claude_dir.join("settings.json"),
        r#"{"model": "opus", "env": {}}"#,
    )
    .expect("write settings");

    assert!(!ClaudeDescriptor.is_model_list_read_only(temp.path()));
}

// ===== build_tui_command_snapshot =====

#[test]
fn codex_tui_command_is_interactive_without_app_server() {
    let command = CodexDescriptor.build_tui_command_snapshot("codex", "full-access", true);
    assert!(
        !command.contains("app-server"),
        "TUI 不得带 app-server：{command}"
    );
    assert!(
        command.split_whitespace().next() == Some("codex") || command.starts_with("codex "),
        "应保持交互式 codex 命令：{command}"
    );
}

#[test]
fn codex_tui_full_access_or_dangerous_appends_bypass() {
    assert_eq!(
        CodexDescriptor.build_tui_command_snapshot("codex", "full-access", false),
        "codex --dangerously-bypass-approvals-and-sandbox"
    );
    assert_eq!(
        CodexDescriptor.build_tui_command_snapshot("codex", "full-auto", false),
        "codex --dangerously-bypass-approvals-and-sandbox"
    );
    // 未知 mode + dangerous → FullAccess 旁路
    assert_eq!(
        CodexDescriptor.build_tui_command_snapshot("codex", "unknown-mode", true),
        "codex --dangerously-bypass-approvals-and-sandbox"
    );
}

#[test]
fn codex_tui_auto_mode_maps_to_approval_and_sandbox() {
    assert_eq!(
        CodexDescriptor.build_tui_command_snapshot("codex", "auto", false),
        "codex --ask-for-approval on-request --sandbox workspace-write"
    );
    // 已知 mode 优先于 dangerous
    assert_eq!(
        CodexDescriptor.build_tui_command_snapshot("codex", "auto", true),
        "codex --ask-for-approval on-request --sandbox workspace-write"
    );
}

#[test]
fn codex_tui_read_only_mode_maps_to_sandbox() {
    assert_eq!(
        CodexDescriptor.build_tui_command_snapshot("codex", "read-only", false),
        "codex --ask-for-approval on-request --sandbox read-only"
    );
    assert_eq!(
        CodexDescriptor.build_tui_command_snapshot("codex", "read_only", false),
        "codex --ask-for-approval on-request --sandbox read-only"
    );
}

#[test]
fn codex_tui_preserves_user_args_and_does_not_duplicate_flags() {
    assert_eq!(
        CodexDescriptor.build_tui_command_snapshot(
            "codex --dangerously-bypass-approvals-and-sandbox",
            "full-access",
            true
        ),
        "codex --dangerously-bypass-approvals-and-sandbox"
    );
    assert_eq!(
        CodexDescriptor.build_tui_command_snapshot(
            "  /usr/local/bin/codex  ",
            "full-access",
            false
        ),
        "/usr/local/bin/codex --dangerously-bypass-approvals-and-sandbox"
    );
}

#[test]
fn claude_tui_command_is_interactive_without_stream_json() {
    let command = ClaudeDescriptor.build_tui_command_snapshot("claude", "full-access", true);
    assert!(
        !command.contains("stream-json"),
        "TUI 不得带 stream-json：{command}"
    );
    assert!(
        !command
            .split_whitespace()
            .any(|p| p == "-p" || p == "--print"),
        "TUI 不得带 -p/--print：{command}"
    );
    assert!(
        !command.contains("--output-format"),
        "TUI 不得带 --output-format：{command}"
    );
}

#[test]
fn claude_tui_dangerous_or_full_access_uses_bypass_permissions() {
    assert_eq!(
        ClaudeDescriptor.build_tui_command_snapshot("claude", "full-access", false),
        "claude --permission-mode bypassPermissions"
    );
    assert_eq!(
        ClaudeDescriptor.build_tui_command_snapshot("claude", "default", true),
        "claude --permission-mode bypassPermissions"
    );
}

#[test]
fn claude_tui_mode_maps_to_permission_mode() {
    assert_eq!(
        ClaudeDescriptor.build_tui_command_snapshot("claude", "plan", false),
        "claude --permission-mode plan"
    );
    assert_eq!(
        ClaudeDescriptor.build_tui_command_snapshot("claude", "acceptEdits", false),
        "claude --permission-mode acceptEdits"
    );
    assert_eq!(
        ClaudeDescriptor.build_tui_command_snapshot("claude", "auto", false),
        "claude --permission-mode auto"
    );
}

#[test]
fn claude_tui_keeps_existing_permission_mode() {
    assert_eq!(
        ClaudeDescriptor.build_tui_command_snapshot(
            "claude --permission-mode plan",
            "full-access",
            true
        ),
        "claude --permission-mode plan"
    );
}

#[test]
fn opencode_tui_full_access_or_dangerous_appends_auto() {
    assert_eq!(
        OpenCodeDescriptor.build_tui_command_snapshot("opencode", "full-access", false),
        "opencode --auto"
    );
    assert_eq!(
        OpenCodeDescriptor.build_tui_command_snapshot("opencode", "auto", true),
        "opencode --auto"
    );
    assert_eq!(
        OpenCodeDescriptor.build_tui_command_snapshot("  opencode  ", "full-access", true),
        "opencode --auto"
    );
}

#[test]
fn opencode_tui_safe_mode_trims_only_without_auto() {
    assert_eq!(
        OpenCodeDescriptor.build_tui_command_snapshot("  opencode  ", "auto", false),
        "opencode"
    );
}

#[test]
fn opencode_tui_does_not_inject_run_or_format() {
    let command = OpenCodeDescriptor.build_tui_command_snapshot("opencode", "full-access", true);
    assert!(!command.split_whitespace().any(|part| part == "run"));
    assert!(!command.contains("--format"));
}

#[test]
fn opencode_tui_preserves_user_args_and_does_not_duplicate_auto() {
    assert_eq!(
        OpenCodeDescriptor.build_tui_command_snapshot("opencode --auto", "full-access", true),
        "opencode --auto"
    );
    assert_eq!(
        OpenCodeDescriptor.build_tui_command_snapshot("opencode --model foo", "full-access", false),
        "opencode --model foo --auto"
    );
}

#[test]
fn opencode_bypass_snapshot_appends_auto() {
    assert_eq!(
        OpenCodeDescriptor.build_command_snapshot_with_bypass("opencode"),
        "opencode --auto"
    );
    assert_eq!(
        OpenCodeDescriptor.build_command_snapshot_with_bypass("opencode --auto"),
        "opencode --auto"
    );
}

#[test]
fn codex_ui_capabilities_match_product_table() {
    let caps = CodexDescriptor.ui_capabilities();
    assert_eq!(caps.model_type_label, "Codex");
    assert!(caps.can_show_model);
    assert!(caps.supports_model_switching);
    assert!(caps.supports_reasoning_effort);
    assert!(caps.supports_modes);
    assert!(caps.supports_tui_resume);
}

#[test]
fn claude_ui_capabilities_disable_modes_and_effort() {
    let caps = ClaudeDescriptor.ui_capabilities();
    assert_eq!(caps.model_type_label, "Claude");
    assert!(caps.can_show_model);
    assert!(caps.supports_model_switching);
    assert!(!caps.supports_reasoning_effort);
    assert!(!caps.supports_modes);
    assert!(caps.supports_tui_resume);
}

#[test]
fn opencode_ui_capabilities_show_model_without_switching() {
    let opencode = OpenCodeDescriptor.ui_capabilities();
    assert_eq!(opencode.model_type_label, "OpenCode");
    assert!(opencode.can_show_model);
    assert!(!opencode.supports_model_switching);
    assert!(!opencode.supports_reasoning_effort);
    assert!(!opencode.supports_modes);
    assert!(opencode.supports_tui_resume);
}

#[test]
fn opencode_launch_snapshot_includes_run_format_json() {
    assert_eq!(
        OpenCodeDescriptor.build_launch_command_snapshot("opencode"),
        "opencode run --format json"
    );
    assert_eq!(
        OpenCodeDescriptor.build_launch_command_snapshot("  opencode  "),
        "opencode run --format json"
    );
}

#[test]
fn opencode_launch_snapshot_does_not_duplicate_run_or_format() {
    assert_eq!(
        OpenCodeDescriptor.build_launch_command_snapshot("opencode run --format json"),
        "opencode run --format json"
    );
    assert_eq!(
        OpenCodeDescriptor.build_launch_command_snapshot("opencode run"),
        "opencode run --format json"
    );
}

#[test]
fn opencode_launch_snapshot_does_not_inject_command_flag() {
    let command = OpenCodeDescriptor.build_launch_command_snapshot("opencode");
    assert!(!command.split_whitespace().any(|part| part == "--command"));
    assert!(command.contains("run"));
    assert!(command.contains("--format"));
    assert!(command.contains("json"));
}
