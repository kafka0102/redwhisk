use std::fs;

use super::tui_hook_commands::{enable_feature_in_data_dir, install_in_data_dir};
use crate::features::agent_session::TuiHookAgentKind;

const COMMAND: &str = "/tmp/redwhisk-test-bin";

fn roots() -> (tempfile::TempDir, tempfile::TempDir) {
    let data = tempfile::tempdir().expect("data");
    let home = tempfile::tempdir().expect("home");
    let codex = home.path().join(".codex");
    fs::create_dir_all(&codex).expect("codex");
    fs::write(codex.join("config.toml"), "[features]\nhooks = false\n").expect("config");
    (data, home)
}

#[test]
fn install_records_preference_and_does_not_rewrite_disabled_hooks_feature() {
    let (data, home) = roots();
    let config = home.path().join(".codex/config.toml");
    let original = fs::read_to_string(&config).expect("config");

    let status = install_in_data_dir(
        data.path(),
        home.path(),
        COMMAND,
        TuiHookAgentKind::Codex,
        true,
    )
    .expect("install");

    assert!(status.codex_registered);
    assert!(status.registration_allowed);
    assert!(!status.codex_hooks_feature_enabled);
    assert_eq!(fs::read_to_string(&config).expect("config"), original);
    let hooks = fs::read_to_string(home.path().join(".codex/hooks.json")).expect("hooks");
    assert!(hooks.contains("hook --source codex"));
    assert!(!hooks.contains("已信任"));
}

#[test]
fn install_refuses_when_channel_unavailable_and_keeps_preference_false() {
    let (data, home) = roots();

    let error = install_in_data_dir(
        data.path(),
        home.path(),
        COMMAND,
        TuiHookAgentKind::Codex,
        false,
    )
    .expect_err("channel");

    assert_eq!(error.reason.as_deref(), Some("channelUnavailable"));
    assert!(!home.path().join(".codex/hooks.json").exists());
}

#[test]
fn enable_feature_is_separate_from_install() {
    let (data, home) = roots();

    let status =
        enable_feature_in_data_dir(data.path(), home.path(), COMMAND, true).expect("enable");

    assert!(status.codex_hooks_feature_enabled);
    assert!(!status.codex_registered);
    assert!(!home.path().join(".codex/hooks.json").exists());
}
