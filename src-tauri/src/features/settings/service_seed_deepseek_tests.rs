use super::seed_preview_tests::{
    migrated_in_memory_connection, test_settings_service, SeedTestDetector,
};
use super::*;
use crate::types::agent_profile::{
    AgentScope, AgentType, DeleteAgentProfileInput, SaveAgentProfileInput,
};

#[test]
fn seed_builtin_agents_inserts_deepseek_json_profile_when_dsh_detected() {
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(
        &connection,
        SeedTestDetector::with_detect_result("dsh", Ok("/usr/local/bin/dsh")),
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
    assert_eq!(profiles[0].agent_type, AgentType::DeepSeek);
    assert_eq!(profiles[0].name, "DeepSeek");
    assert_eq!(profiles[0].command, "/usr/local/bin/dsh");
    assert_eq!(profiles[0].display_mode, "json");
    assert!(profiles[0].enabled);
    assert_eq!(profiles[0].scope, AgentScope::Global);
}

#[test]
fn seed_builtin_agents_does_not_reseed_soft_deleted_deepseek() {
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(
        &connection,
        SeedTestDetector::with_detect_result("dsh", Ok("dsh")),
    );
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
    service
        .delete_agent_profile(DeleteAgentProfileInput { id: saved.id })
        .expect("delete");

    service.seed_builtin_agents().expect("seed");

    let profiles = service
        .list_agent_profiles(ListAgentProfilesInput {
            scope: AgentScope::Global,
            project_id: None,
        })
        .expect("list")
        .profiles;
    assert!(profiles.is_empty(), "软删 deepseek 后不应重新播种");
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
