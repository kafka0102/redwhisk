use super::tui_hook_env::{tui_hook_spawn_env, REDWHISK_AGENT_KIND, REDWHISK_SESSION_ID};

#[test]
fn codex_and_grok_tui_env_carry_session_id_and_kind() {
    let codex = tui_hook_spawn_env("codex", 41);
    assert_eq!(
        codex.get(REDWHISK_SESSION_ID).map(String::as_str),
        Some("41")
    );
    assert_eq!(
        codex.get(REDWHISK_AGENT_KIND).map(String::as_str),
        Some("codex")
    );

    let grok = tui_hook_spawn_env("grok", 7);
    assert_eq!(grok.get(REDWHISK_SESSION_ID).map(String::as_str), Some("7"));
    assert_eq!(
        grok.get(REDWHISK_AGENT_KIND).map(String::as_str),
        Some("grok")
    );
}

#[test]
fn other_agents_and_project_terminal_do_not_get_the_pair() {
    assert!(tui_hook_spawn_env("claude", 1).is_empty());
    assert!(tui_hook_spawn_env("opencode", 1).is_empty());
    assert!(tui_hook_spawn_env("deepseek", 1).is_empty());
    let project_terminal_env = tui_hook_spawn_env("", 0);
    assert!(project_terminal_env.is_empty());
    assert!(!project_terminal_env.contains_key(REDWHISK_SESSION_ID));
    assert!(!project_terminal_env.contains_key(REDWHISK_AGENT_KIND));
}
