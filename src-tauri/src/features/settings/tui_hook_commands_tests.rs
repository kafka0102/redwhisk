use std::fs;

use super::tui_hook_commands::{
    codex_feature_from_list, detect_in_data_dir, enable_feature_in_data_dir, install_in_data_dir,
    uninstall_in_data_dir,
};

use crate::features::agent_session::TuiHookAgentKind;

fn feature_off() -> Option<crate::features::agent_session::CodexHooksFeature> {
    codex_feature_from_list("hooks stable false\n")
}

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

    install_in_data_dir(
        data.path(),
        home.path(),
        COMMAND,
        TuiHookAgentKind::Codex,
        true,
        feature_off(),
    )
    .expect("install");

    let detected =
        detect_in_data_dir(data.path(), home.path(), COMMAND, true, feature_off()).expect("detect");
    assert!(detected.codex_registered);
    assert!(detected.registration_allowed);
    assert!(!detected.codex_hooks_feature_enabled);
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
        feature_off(),
    )
    .expect_err("channel");

    assert_eq!(error.reason.as_deref(), Some("channelUnavailable"));
    assert!(!home.path().join(".codex/hooks.json").exists());
}

#[test]
fn detect_reads_installed_hook_without_spawning() {
    let (data, home) = roots();
    install_in_data_dir(
        data.path(),
        home.path(),
        COMMAND,
        TuiHookAgentKind::Grok,
        true,
        feature_off(),
    )
    .expect("install grok");

    let status =
        detect_in_data_dir(data.path(), home.path(), COMMAND, true, feature_off()).expect("detect");

    assert!(status.grok_registered);
    assert!(!status.codex_registered);
    assert!(status.registration_allowed);
}

#[test]
fn uninstall_removes_only_the_requested_agent() {
    let (data, home) = roots();
    install_in_data_dir(
        data.path(),
        home.path(),
        COMMAND,
        TuiHookAgentKind::Codex,
        true,
        feature_off(),
    )
    .expect("install codex");
    install_in_data_dir(
        data.path(),
        home.path(),
        COMMAND,
        TuiHookAgentKind::Grok,
        true,
        feature_off(),
    )
    .expect("install grok");

    uninstall_in_data_dir(
        data.path(),
        home.path(),
        COMMAND,
        TuiHookAgentKind::Codex,
        true,
        feature_off(),
    )
    .expect("uninstall");

    let status =
        detect_in_data_dir(data.path(), home.path(), COMMAND, true, feature_off()).expect("detect");
    assert!(!status.codex_registered);
    assert!(status.grok_registered);
    assert!(status.registration_allowed);
    let codex_hooks = fs::read_to_string(home.path().join(".codex/hooks.json")).expect("hooks");
    assert!(!codex_hooks.contains("hook --source codex"));
    assert!(home.path().join(".grok/hooks/redwhisk.json").exists());
}

#[test]
fn enable_feature_is_separate_from_install() {
    let (data, home) = roots();

    enable_feature_in_data_dir(
        data.path(),
        home.path(),
        COMMAND,
        true,
        codex_feature_from_list("hooks stable true\n"),
    )
    .expect("enable");

    let detected = detect_in_data_dir(
        data.path(),
        home.path(),
        COMMAND,
        true,
        codex_feature_from_list("hooks stable true\n"),
    )
    .expect("detect after enable");
    assert!(detected.codex_hooks_feature_enabled);
    assert!(!detected.codex_registered);
    assert!(!home.path().join(".codex/hooks.json").exists());
}
