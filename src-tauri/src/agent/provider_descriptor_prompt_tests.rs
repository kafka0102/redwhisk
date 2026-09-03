use super::*;

#[test]
fn tui_initial_prompt_delivery_prefers_cli_args() {
    assert_eq!(
        CodexDescriptor.tui_initial_prompt_delivery(),
        TuiInitialPromptDelivery::TrailingArgument
    );
    assert_eq!(
        ClaudeDescriptor.tui_initial_prompt_delivery(),
        TuiInitialPromptDelivery::TrailingArgument
    );
    assert_eq!(
        OpenCodeDescriptor.tui_initial_prompt_delivery(),
        TuiInitialPromptDelivery::PromptFlag
    );
    assert_eq!(
        GrokDescriptor.tui_initial_prompt_delivery(),
        TuiInitialPromptDelivery::TrailingArgument
    );
}

#[test]
fn plan_tui_initial_prompt_routes_by_provider() {
    let claude = plan_tui_initial_prompt(
        &AgentType::Claude,
        "claude --permission-mode bypassPermissions",
        "hello world",
    );
    assert_eq!(
        claude.spawn_command,
        "claude --permission-mode bypassPermissions"
    );
    assert_eq!(claude.trailing_prompt.as_deref(), Some("hello world"));
    assert!(!claude.inject_stdin_after_register);

    let codex = plan_tui_initial_prompt(
        &AgentType::Codex,
        "codex --dangerously-bypass-approvals-and-sandbox",
        "go",
    );
    assert_eq!(codex.trailing_prompt.as_deref(), Some("go"));
    assert!(!codex.inject_stdin_after_register);

    let grok = plan_tui_initial_prompt(&AgentType::Grok, "grok --always-approve", "fix it");
    assert_eq!(grok.trailing_prompt.as_deref(), Some("fix it"));
    assert!(!grok.inject_stdin_after_register);

    let opencode = plan_tui_initial_prompt(&AgentType::OpenCode, "opencode --auto", "ship it");
    assert_eq!(opencode.spawn_command, "opencode --auto --prompt 'ship it'");
    assert!(opencode.trailing_prompt.is_none());
    assert!(!opencode.inject_stdin_after_register);

    let quoted = plan_tui_initial_prompt(&AgentType::OpenCode, "opencode", "it's fine");
    assert_eq!(quoted.spawn_command, "opencode --prompt 'it'\"'\"'s fine'");
}
