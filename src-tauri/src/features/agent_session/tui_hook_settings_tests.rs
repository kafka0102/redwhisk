use std::fs;

use super::tui_hook_install::{parse_codex_hooks_feature, CodexHooksFeature};
use super::tui_hook_settings::{
    detect_tui_hook_registration_with_feature, enable_codex_hooks_feature_file,
    install_tui_hook_registration, uninstall_tui_hook_registration, upgrade_stale_tui_hook_files,
    TuiHookAgentKind,
};

fn detect(
    home: &std::path::Path,
    feature: Option<CodexHooksFeature>,
) -> super::tui_hook_settings::TuiHookRegistrationStatus {
    detect_tui_hook_registration_with_feature(home, COMMAND, false, false, feature).expect("detect")
}

const COMMAND: &str = "/Applications/RedWhisk.app/Contents/MacOS/redwhisk";

fn home_with_codex_config(config: &str) -> tempfile::TempDir {
    let home = tempfile::tempdir().expect("temp");
    let codex = home.path().join(".codex");
    fs::create_dir_all(&codex).expect("codex dir");
    fs::write(codex.join("config.toml"), config).expect("config");
    home
}

#[test]
fn detect_reads_hook_files_without_spawning_and_reports_unregistered() {
    let home = home_with_codex_config("[features]\nhooks = false\n");

    let status = detect(
        home.path(),
        parse_codex_hooks_feature("hooks stable false\n"),
    );

    assert!(!status.codex_registered);
    assert!(!status.grok_registered);
    assert!(!status.codex_hooks_feature_enabled);
    assert!(!status.codex_registered_label_is_trusted());
}

#[test]
fn install_codex_does_not_write_config_when_hooks_feature_is_false() {
    let home = home_with_codex_config("model = \"gpt-5\"\n[features]\nhooks = false\n");
    let config_path = home.path().join(".codex/config.toml");
    let original = fs::read_to_string(&config_path).expect("config");

    install_tui_hook_registration(home.path(), TuiHookAgentKind::Codex, COMMAND).expect("install");

    assert_eq!(fs::read_to_string(&config_path).expect("config"), original);
    let status = detect(
        home.path(),
        parse_codex_hooks_feature("hooks stable false\n"),
    );
    assert!(status.codex_registered);
    assert!(!status.codex_hooks_feature_enabled);
    assert!(!status.grok_registered);
}

#[test]
fn enable_codex_hooks_feature_writes_only_after_separate_confirm() {
    let home = home_with_codex_config("[features]\nhooks = false\n");
    let config_path = home.path().join(".codex/config.toml");

    enable_codex_hooks_feature_file(&config_path).expect("enable");

    let updated = fs::read_to_string(&config_path).expect("config");
    assert!(updated.contains("hooks = true") || updated.contains("hooks=true"));
}

#[test]
fn uninstall_codex_keeps_other_product_hooks() {
    let home = home_with_codex_config("[features]\nhooks = true\n");
    let hooks = home.path().join(".codex/hooks.json");
    fs::write(
        &hooks,
        serde_json::json!({
            "hooks": {
                "Stop": [{
                    "hooks": [{ "type": "command", "command": "/usr/local/bin/open-island hook --source codex" }]
                }]
            }
        })
        .to_string(),
    )
    .expect("hooks");

    install_tui_hook_registration(home.path(), TuiHookAgentKind::Codex, COMMAND).expect("install");
    uninstall_tui_hook_registration(home.path(), TuiHookAgentKind::Codex, COMMAND)
        .expect("uninstall");

    let text = fs::read_to_string(&hooks).expect("hooks");
    assert!(text.contains("open-island"));
    assert!(!text.contains(COMMAND));
    let status = detect(
        home.path(),
        parse_codex_hooks_feature("hooks stable true\n"),
    );
    assert!(!status.codex_registered);
    assert!(status.codex_hooks_feature_enabled);
}

#[test]
fn grok_install_and_uninstall_only_touch_redwhisk_json() {
    let home = tempfile::tempdir().expect("temp");
    let hooks_dir = home.path().join(".grok/hooks");
    fs::create_dir_all(&hooks_dir).expect("dir");
    let open_island = b"{\"keep\":true}\n";
    fs::write(hooks_dir.join("open-island.json"), open_island).expect("island");

    install_tui_hook_registration(home.path(), TuiHookAgentKind::Grok, COMMAND).expect("install");
    assert!(hooks_dir.join("redwhisk.json").exists());
    assert_eq!(
        fs::read(hooks_dir.join("open-island.json")).expect("bytes"),
        open_island
    );
    let status = detect(home.path(), None);
    assert!(status.grok_registered);
    assert!(!status.codex_registered);

    uninstall_tui_hook_registration(home.path(), TuiHookAgentKind::Grok, COMMAND)
        .expect("uninstall");
    assert!(!hooks_dir.join("redwhisk.json").exists());
    assert_eq!(
        fs::read(hooks_dir.join("open-island.json")).expect("bytes"),
        open_island
    );
}

#[test]
fn stale_codex_hooks_are_outdated_until_upgrade_rewrites_events() {
    let home = home_with_codex_config("[features]\nhooks = true\n");
    let hooks = home.path().join(".codex/hooks.json");
    let config = fs::read_to_string(home.path().join(".codex/config.toml")).expect("config");
    fs::write(
        &hooks,
        serde_json::json!({
            "hooks": {
                "UserPromptSubmit": [{
                    "hooks": [{
                        "type": "command",
                        "command": format!("{COMMAND} hook --source codex"),
                        "timeout": 5
                    }]
                }],
                "Stop": [{
                    "hooks": [{
                        "type": "command",
                        "command": "/usr/local/bin/open-island hook --source codex",
                        "timeout": 45
                    }]
                }]
            }
        })
        .to_string(),
    )
    .expect("hooks");

    let before = detect(
        home.path(),
        parse_codex_hooks_feature("hooks stable true\n"),
    );
    assert!(!before.codex_registered);
    assert!(before.codex_hooks_outdated);
    assert!(!before.grok_hooks_outdated);

    upgrade_stale_tui_hook_files(home.path(), COMMAND).expect("upgrade");

    let text = fs::read_to_string(&hooks).expect("hooks");
    assert!(text.contains("PreToolUse"));
    assert!(text.contains("PostToolUse"));
    assert!(text.contains("open-island"));
    assert_eq!(
        fs::read_to_string(home.path().join(".codex/config.toml")).expect("config"),
        config
    );
    let after = detect(
        home.path(),
        parse_codex_hooks_feature("hooks stable true\n"),
    );
    assert!(after.codex_registered);
    assert!(!after.codex_hooks_outdated);

    let current = fs::read_to_string(&hooks).expect("hooks");
    upgrade_stale_tui_hook_files(home.path(), COMMAND).expect("upgrade again");
    assert_eq!(fs::read_to_string(&hooks).expect("hooks"), current);
}

#[test]
fn upgrade_does_not_create_hooks_that_were_never_installed() {
    let home = home_with_codex_config("[features]\nhooks = true\n");

    upgrade_stale_tui_hook_files(home.path(), COMMAND).expect("upgrade");

    assert!(!home.path().join(".codex/hooks.json").exists());
    assert!(!home.path().join(".grok/hooks/redwhisk.json").exists());
}

#[test]
fn install_command_refuses_when_status_channel_unavailable() {
    let home = home_with_codex_config("[features]\nhooks = true\n");

    let error = super::tui_hook_settings::apply_tui_hook_registration(
        home.path(),
        TuiHookAgentKind::Codex,
        COMMAND,
        false,
    )
    .expect_err("channel");

    assert_eq!(error.reason.as_deref(), Some("channelUnavailable"));
    assert!(!home.path().join(".codex/hooks.json").exists());
}
