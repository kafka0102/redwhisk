use super::seed_preview_tests::{
    migrated_in_memory_connection, test_settings_service, SeedTestDetector,
};
use super::*;
use crate::types::agent_profile::{AgentScope, AgentType, SaveAgentProfileInput};

#[test]
fn seed_builtin_agents_does_not_probe_dsh_or_insert_deepseek() {
    let connection = migrated_in_memory_connection();
    let detector = SeedTestDetector::with_detect_result("dsh", Ok("/usr/local/bin/dsh"));
    let detect_calls = detector.calls_handle();
    let service = test_settings_service(&connection, detector);

    service.seed_builtin_agents().expect("seed");

    let profiles = service
        .list_agent_profiles(ListAgentProfilesInput {
            scope: AgentScope::Global,
            project_id: None,
        })
        .expect("list")
        .profiles;
    assert!(profiles.is_empty());
    assert!(
        !detect_calls
            .lock()
            .expect("detect calls")
            .contains(&"dsh".to_string()),
        "hidden DeepSeek must not probe dsh"
    );
}

#[test]
fn seed_builtin_agents_keeps_existing_deepseek_without_reseeding() {
    let connection = migrated_in_memory_connection();
    let detector = SeedTestDetector::with_detect_result("dsh", Ok("dsh"));
    let detect_calls = detector.calls_handle();
    let service = test_settings_service(&connection, detector);
    let saved = service
        .save_agent_profile(SaveAgentProfileInput {
            id: None,
            name: "DeepSeek".to_string(),
            agent_type: AgentType::DeepSeek,
            command: "dsh".to_string(),
            scope: AgentScope::Global,
            project_id: None,
            mode: "full-access".to_string(),
            dangerous: true,
            default_skill: String::new(),
            prompt_template: String::new(),
            display_mode: "json".to_string(),
            enabled: true,
        })
        .expect("save");

    service.seed_builtin_agents().expect("seed");

    let profiles = service
        .list_agent_profiles(ListAgentProfilesInput {
            scope: AgentScope::Global,
            project_id: None,
        })
        .expect("list")
        .profiles;
    assert_eq!(profiles.len(), 1);
    assert_eq!(profiles[0].id, saved.id);
    assert_eq!(profiles[0].agent_type, AgentType::DeepSeek);
    assert!(
        !detect_calls
            .lock()
            .expect("detect calls")
            .contains(&"dsh".to_string()),
        "existing DeepSeek must not trigger dsh probing"
    );
}

#[test]
fn seed_builtin_agents_with_codex_and_dsh_only_inserts_codex() {
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(
        &connection,
        SeedTestDetector::with_detect_results(&[
            ("codex", Ok("/usr/local/bin/codex")),
            ("dsh", Ok("/usr/local/bin/dsh")),
        ]),
    );

    service.seed_builtin_agents().expect("seed");

    let profiles = service
        .list_agent_profiles(ListAgentProfilesInput {
            scope: AgentScope::Global,
            project_id: None,
        })
        .expect("list")
        .profiles;
    assert_eq!(profiles.len(), 1);
    assert_eq!(profiles[0].agent_type, AgentType::Codex);
}

#[test]
fn save_deepseek_profile_locks_display_mode_to_json() {
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(&connection, SeedTestDetector::new());
    let error = service
        .save_agent_profile(SaveAgentProfileInput {
            id: None,
            name: "DeepSeek".to_string(),
            agent_type: AgentType::DeepSeek,
            command: "dsh".to_string(),
            scope: AgentScope::Global,
            project_id: None,
            mode: "full-access".to_string(),
            dangerous: false,
            default_skill: String::new(),
            prompt_template: String::new(),
            display_mode: "tui".to_string(),
            enabled: true,
        })
        .expect_err("tui is locked");
    assert_eq!(error.code, CommandErrorCode::AgentProfileValidationFailed);
    assert_eq!(error.reason.as_deref(), Some("displayModeLocked"));
}
