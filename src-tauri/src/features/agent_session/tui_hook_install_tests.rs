use std::fs;
use std::path::Path;

use super::tui_hook_install::{
    install_codex_hooks, install_grok_hooks, parse_codex_hooks_feature, uninstall_codex_hooks,
    uninstall_grok_hooks,
};

const COMMAND: &str = "/Applications/RedWhisk.app/Contents/MacOS/redwhisk";
const OPEN_ISLAND: &str = "/usr/local/bin/open-island hook";

fn codex_hooks_with_open_island() -> serde_json::Value {
    serde_json::json!({
        "hooks": {
            "UserPromptSubmit": [{
                "hooks": [{ "type": "command", "command": format!("{OPEN_ISLAND} --source codex"), "timeout": 45 }]
            }],
            "Stop": [{
                "hooks": [{ "type": "command", "command": format!("{OPEN_ISLAND} --source codex"), "timeout": 45 }]
            }],
            "SessionStart": [{
                "hooks": [{ "type": "command", "command": OPEN_ISLAND, "timeout": 10 }]
            }]
        }
    })
}

fn hook_commands(doc: &serde_json::Value, event: &str) -> Vec<String> {
    doc["hooks"][event]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|group| group["hooks"].as_array().into_iter().flatten())
        .filter_map(|hook| hook["command"].as_str().map(str::to_string))
        .collect()
}

fn group_has_matcher(doc: &serde_json::Value, event: &str, command_needle: &str) -> bool {
    doc["hooks"][event]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|group| {
            group["hooks"].as_array().into_iter().flatten().any(|hook| {
                hook["command"]
                    .as_str()
                    .unwrap_or("")
                    .contains(command_needle)
            })
        })
        .any(|group| group.get("matcher").is_some())
}

fn hook_timeout(doc: &serde_json::Value, event: &str, command_needle: &str) -> Option<u64> {
    doc["hooks"][event]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|group| group["hooks"].as_array().into_iter().flatten())
        .find(|hook| {
            hook["command"]
                .as_str()
                .unwrap_or("")
                .contains(command_needle)
        })
        .and_then(|hook| hook.get("timeout"))
        .and_then(|timeout| timeout.as_u64())
}

fn read_json(path: &Path) -> serde_json::Value {
    serde_json::from_str(&fs::read_to_string(path).expect("read")).expect("json")
}

#[test]
fn codex_install_appends_three_groups_and_keeps_open_island() {
    let dir = tempfile::tempdir().expect("temp");
    let hooks = dir.path().join("hooks.json");
    let config = dir.path().join("config.toml");
    fs::write(&hooks, codex_hooks_with_open_island().to_string()).expect("hooks");
    let original_config = "model = \"gpt-5\"\n[features]\nhooks = true\n";
    fs::write(&config, original_config).expect("config");

    install_codex_hooks(&hooks, &config, COMMAND, false).expect("install");

    let doc = read_json(&hooks);
    for event in ["UserPromptSubmit", "Stop", "Interrupt"] {
        let commands = hook_commands(&doc, event);
        assert!(
            commands
                .iter()
                .any(|command| command.contains(COMMAND) && command.contains("--source codex")),
            "{event} missing redwhisk command: {commands:?}"
        );
    }
    assert!(hook_commands(&doc, "UserPromptSubmit")
        .iter()
        .any(|command| command.contains("open-island")));
    assert!(hook_commands(&doc, "Stop")
        .iter()
        .any(|command| command.contains("open-island")));
    assert!(hook_commands(&doc, "SessionStart")
        .iter()
        .any(|command| command == OPEN_ISLAND));
    assert!(doc["hooks"].get("PreToolUse").is_none());
    assert_eq!(hook_timeout(&doc, "UserPromptSubmit", COMMAND), Some(5));
    assert_eq!(hook_timeout(&doc, "Stop", COMMAND), Some(5));
    assert!(hook_timeout(&doc, "Interrupt", COMMAND).is_none());
    assert!(!group_has_matcher(&doc, "UserPromptSubmit", COMMAND));
    assert!(!group_has_matcher(&doc, "Stop", COMMAND));
    assert!(!group_has_matcher(&doc, "Interrupt", COMMAND));
    assert_eq!(
        fs::read_to_string(&config).expect("config"),
        original_config
    );
    assert!(!fs::read_to_string(&hooks)
        .expect("hooks")
        .contains("codex_hooks"));
    assert!(!dir.path().join(".claude").exists());
}

#[test]
fn codex_uninstall_removes_only_redwhisk_groups_even_if_timeout_changed() {
    let dir = tempfile::tempdir().expect("temp");
    let hooks = dir.path().join("hooks.json");
    let config = dir.path().join("config.toml");
    fs::write(&hooks, codex_hooks_with_open_island().to_string()).expect("hooks");
    fs::write(&config, "[features]\nhooks = true\n").expect("config");
    install_codex_hooks(&hooks, &config, COMMAND, false).expect("install");

    let mut doc = read_json(&hooks);
    doc["hooks"]["Stop"]
        .as_array_mut()
        .expect("stop")
        .iter_mut()
        .flat_map(|group| group["hooks"].as_array_mut().into_iter().flatten())
        .filter(|hook| hook["command"].as_str().unwrap_or("").contains(COMMAND))
        .for_each(|hook| {
            hook["timeout"] = serde_json::json!(99);
        });
    fs::write(&hooks, doc.to_string()).expect("rewrite");

    uninstall_codex_hooks(&hooks, COMMAND).expect("uninstall");

    let doc = read_json(&hooks);
    for event in ["UserPromptSubmit", "Stop", "Interrupt"] {
        let commands = hook_commands(&doc, event);
        assert!(
            commands.iter().all(|command| !command.contains(COMMAND)),
            "{event} still has redwhisk: {commands:?}"
        );
    }
    assert!(hook_commands(&doc, "UserPromptSubmit")
        .iter()
        .any(|command| command.contains("open-island")));
    assert!(hook_commands(&doc, "Stop")
        .iter()
        .any(|command| command.contains("open-island")));
    assert_eq!(
        hook_commands(&doc, "SessionStart"),
        vec![OPEN_ISLAND.to_string()]
    );
}

#[test]
fn codex_hooks_already_enabled_does_not_rewrite_config_even_when_confirm_is_set() {
    let dir = tempfile::tempdir().expect("temp");
    let hooks = dir.path().join("hooks.json");
    let config = dir.path().join("config.toml");
    let original = "model = \"gpt-5\"\n";
    fs::write(&config, original).expect("config");

    install_codex_hooks(&hooks, &config, COMMAND, true).expect("install");

    assert_eq!(fs::read_to_string(&config).expect("config"), original);
    assert!(!fs::read_to_string(&config)
        .expect("config")
        .contains("codex_hooks"));
}

#[test]
fn codex_hooks_false_writes_feature_only_after_confirm() {
    let dir = tempfile::tempdir().expect("temp");
    let hooks = dir.path().join("hooks.json");
    let config = dir.path().join("config.toml");
    let disabled = "model = \"gpt-5\"\n[features]\nhooks = false\n";
    fs::write(&config, disabled).expect("config");
    install_codex_hooks(&hooks, &config, COMMAND, false).expect("install without confirm");
    assert_eq!(fs::read_to_string(&config).expect("config"), disabled);

    install_codex_hooks(&hooks, &config, COMMAND, true).expect("install with confirm");
    let updated = fs::read_to_string(&config).expect("config");
    assert!(updated.contains("hooks = true") || updated.contains("hooks=true"));
    assert!(!updated.contains("codex_hooks"));
}

#[test]
fn grok_install_writes_only_redwhisk_json_and_leaves_open_island_bytes() {
    let dir = tempfile::tempdir().expect("temp");
    let open_island = b"{\"hooks\":{\"Stop\":[]}}\n";
    fs::write(dir.path().join("open-island.json"), open_island).expect("open island");

    install_grok_hooks(dir.path(), COMMAND).expect("install");

    assert_eq!(
        fs::read(dir.path().join("open-island.json")).expect("bytes"),
        open_island
    );
    let doc = read_json(&dir.path().join("redwhisk.json"));
    for event in [
        "UserPromptSubmit",
        "Stop",
        "StopFailure",
        "StopCancelled",
        "Notification",
    ] {
        let commands = hook_commands(&doc, event);
        assert!(
            commands
                .iter()
                .any(|command| command.contains(COMMAND) && command.contains("--source grok")),
            "{event}: {commands:?}"
        );
        assert_eq!(hook_timeout(&doc, event, COMMAND), Some(5));
    }
    assert!(group_has_matcher(&doc, "Notification", COMMAND));
    assert!(!group_has_matcher(&doc, "UserPromptSubmit", COMMAND));
    assert!(doc["hooks"].get("PreToolUse").is_none());
    assert!(doc["hooks"].get("SessionStart").is_none());
}

#[test]
fn grok_uninstall_deletes_file_when_only_redwhisk_commands_remain() {
    let dir = tempfile::tempdir().expect("temp");
    let open_island = b"{\"keep\":true}\n";
    fs::write(dir.path().join("open-island.json"), open_island).expect("open island");
    install_grok_hooks(dir.path(), COMMAND).expect("install");

    uninstall_grok_hooks(dir.path(), COMMAND).expect("uninstall");

    assert!(!dir.path().join("redwhisk.json").exists());
    assert_eq!(
        fs::read(dir.path().join("open-island.json")).expect("bytes"),
        open_island
    );
}

#[test]
fn grok_uninstall_keeps_foreign_commands_and_deletes_file_only_when_empty() {
    let dir = tempfile::tempdir().expect("temp");
    install_grok_hooks(dir.path(), COMMAND).expect("install");
    let path = dir.path().join("redwhisk.json");
    let mut doc = read_json(&path);
    doc["hooks"]["Stop"]
        .as_array_mut()
        .expect("stop")
        .push(serde_json::json!({
            "hooks": [{ "type": "command", "command": "/tmp/user-hook --source grok", "timeout": 9 }]
        }));
    fs::write(&path, doc.to_string()).expect("rewrite");

    uninstall_grok_hooks(dir.path(), COMMAND).expect("uninstall");

    assert!(path.exists());
    let doc = read_json(&path);
    let commands = hook_commands(&doc, "Stop");
    assert_eq!(commands, vec!["/tmp/user-hook --source grok".to_string()]);
    for event in [
        "UserPromptSubmit",
        "StopFailure",
        "StopCancelled",
        "Notification",
    ] {
        assert!(
            hook_commands(&doc, event)
                .iter()
                .all(|command| !command.contains(COMMAND)),
            "{event}"
        );
    }
}

#[test]
fn features_list_marks_stable_hooks_enabled_and_explicit_false() {
    let listed = "\
hooks                                    stable             true
plugin_hooks                             removed            false
";
    let stable = parse_codex_hooks_feature(listed).expect("hooks row");
    assert!(stable.is_stable_and_enabled());
    assert!(!stable.effective_value_is_false());

    let disabled = parse_codex_hooks_feature("hooks  under development  false\n").expect("row");
    assert!(!disabled.is_stable_and_enabled());
    assert!(disabled.effective_value_is_false());
    assert!(parse_codex_hooks_feature("apps stable true\n").is_none());
}
