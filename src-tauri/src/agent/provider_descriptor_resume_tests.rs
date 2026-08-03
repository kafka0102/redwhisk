//! TUI resume 命令构造单测（从 provider_descriptor_tests 拆出以控行数）。

use super::*;

// ===== build_tui_resume_command =====

#[test]
fn codex_tui_resume_uses_resume_subcommand_and_keeps_snapshot_flags() {
    assert_eq!(
        CodexDescriptor.build_tui_resume_command(
            "codex --dangerously-bypass-approvals-and-sandbox",
            "thread-abc"
        ),
        "codex resume thread-abc --dangerously-bypass-approvals-and-sandbox"
    );
    assert_eq!(
        CodexDescriptor.build_tui_resume_command("codex", "thread-xyz"),
        "codex resume thread-xyz"
    );
    assert_eq!(
        CodexDescriptor.build_tui_resume_command("", "thread-empty-snap"),
        "codex resume thread-empty-snap"
    );
}

#[test]
fn claude_tui_resume_injects_resume_flag_and_keeps_permission_mode() {
    assert_eq!(
        ClaudeDescriptor.build_tui_resume_command(
            "claude --permission-mode bypassPermissions",
            "sess-1"
        ),
        "claude --resume sess-1 --permission-mode bypassPermissions"
    );
    assert_eq!(
        ClaudeDescriptor.build_tui_resume_command("claude", "sess-2"),
        "claude --resume sess-2"
    );
}

#[test]
fn opencode_tui_resume_appends_session_flag() {
    assert_eq!(
        OpenCodeDescriptor.build_tui_resume_command("opencode --auto", "ses_abc"),
        "opencode --auto -s ses_abc"
    );
    assert_eq!(
        OpenCodeDescriptor.build_tui_resume_command("opencode", "ses_xyz"),
        "opencode -s ses_xyz"
    );
    assert_eq!(
        OpenCodeDescriptor.build_tui_resume_command("", "ses_fallback"),
        "opencode -s ses_fallback"
    );
}

#[test]
fn grok_tui_resume_injects_resume_flag_and_keeps_always_approve() {
    assert_eq!(
        GrokDescriptor.build_tui_resume_command("grok --always-approve", "g-1"),
        "grok --resume g-1 --always-approve"
    );
    assert_eq!(
        GrokDescriptor.build_tui_resume_command("grok", "g-2"),
        "grok --resume g-2"
    );
}

