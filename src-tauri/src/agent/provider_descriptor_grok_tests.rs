//! Grok descriptor 单测。从 `provider_descriptor_tests.rs` 拆出以控制单文件行数。

use super::*;
use std::fs;

#[test]
fn grok_tui_appends_always_approve_on_dangerous_or_full_access() {
    assert_eq!(
        descriptor_for(&AgentType::Grok).build_tui_command_snapshot("grok", "auto", true),
        "grok --always-approve"
    );
    assert_eq!(
        descriptor_for(&AgentType::Grok).build_tui_command_snapshot("grok", "full-access", false),
        "grok --always-approve"
    );
}

#[test]
fn grok_tui_trims_without_always_approve_when_safe() {
    assert_eq!(
        descriptor_for(&AgentType::Grok).build_tui_command_snapshot("  grok  ", "auto", false),
        "grok"
    );
}

#[test]
fn grok_tui_does_not_duplicate_always_approve() {
    assert_eq!(
        descriptor_for(&AgentType::Grok).build_tui_command_snapshot(
            "grok --always-approve",
            "full-access",
            true
        ),
        "grok --always-approve"
    );
}

#[test]
fn grok_ui_capabilities_show_model_without_switching() {
    let grok = descriptor_for(&AgentType::Grok).ui_capabilities();
    assert_eq!(grok.model_type_label, "Grok");
    assert!(grok.can_show_model);
    assert!(!grok.supports_model_switching);
    assert!(!grok.supports_reasoning_effort);
    assert!(!grok.supports_modes);
    assert!(grok.supports_tui_resume);
}

#[test]
fn grok_list_models_reads_default_from_config() {
    let temp = tempfile::tempdir().expect("temp");
    let grok_dir = temp.path().join(".grok");
    fs::create_dir_all(&grok_dir).expect("grok dir");
    fs::write(
        grok_dir.join("config.toml"),
        "[models]\ndefault = \"grok-build\"\n",
    )
    .expect("write config");

    let models = descriptor_for(&AgentType::Grok).list_models(temp.path(), "grok");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].model_id, "grok-build");
    assert_eq!(models[0].is_default, Some(true));
}

#[test]
fn grok_list_models_empty_when_no_config() {
    let temp = tempfile::tempdir().expect("temp");
    assert!(descriptor_for(&AgentType::Grok)
        .list_models(temp.path(), "grok")
        .is_empty());
}

#[test]
fn grok_is_model_list_read_only() {
    let temp = tempfile::tempdir().expect("temp");
    assert!(descriptor_for(&AgentType::Grok).is_model_list_read_only(temp.path()));
}
