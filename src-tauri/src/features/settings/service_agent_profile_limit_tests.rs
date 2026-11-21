use super::seed_preview_tests::{
    migrated_in_memory_connection, test_settings_service, SeedTestDetector,
};
use super::*;
use crate::db::project_repository::ProjectRepository;

fn save_profile(
    service: &SettingsService<'_, SeedTestDetector>,
    name: &str,
    scope: AgentScope,
    project_id: Option<i64>,
) -> Result<AgentProfileRecord, CommandError> {
    service.save_agent_profile(SaveAgentProfileInput {
        id: None,
        name: name.to_string(),
        agent_type: AgentType::Codex,
        command: "codex".to_string(),
        scope,
        project_id,
        mode: "full-access".to_string(),
        dangerous: false,
        default_skill: String::new(),
        prompt_template: String::new(),
        display_mode: "json".to_string(),
        enabled: true,
    })
}

#[test]
fn project_allows_thirty_global_and_thirty_project_profiles() {
    let connection = migrated_in_memory_connection();
    let project_id = ProjectRepository::new(&connection)
        .insert("RedWhisk", "/tmp/redwhisk")
        .expect("insert project")
        .id;
    let service = test_settings_service(&connection, SeedTestDetector::new());

    for index in 0..30 {
        save_profile(
            &service,
            &format!("global-{index}"),
            AgentScope::Global,
            None,
        )
        .expect("save global profile within limit");
        save_profile(
            &service,
            &format!("project-{index}"),
            AgentScope::Project,
            Some(project_id),
        )
        .expect("save project profile within limit");
    }

    let global_error = save_profile(&service, "global-over-limit", AgentScope::Global, None)
        .expect_err("31st global profile must be rejected");
    assert_eq!(
        global_error.code,
        CommandErrorCode::AgentProfileValidationFailed
    );
    assert_eq!(
        global_error.reason.as_deref(),
        Some("agentProfileLimitExceeded")
    );

    let project_error = save_profile(
        &service,
        "project-over-limit",
        AgentScope::Project,
        Some(project_id),
    )
    .expect_err("31st project profile must be rejected");
    assert_eq!(
        project_error.code,
        CommandErrorCode::AgentProfileValidationFailed
    );
    assert_eq!(
        project_error.reason.as_deref(),
        Some("agentProfileLimitExceeded")
    );

    for (scope, project_id, expected_len) in [
        (AgentScope::Global, None, 30),
        (AgentScope::Project, Some(project_id), 30),
    ] {
        let profiles = service
            .list_agent_profiles(ListAgentProfilesInput { scope, project_id })
            .expect("list profiles")
            .profiles;
        assert_eq!(profiles.len(), expected_len);
    }
}

#[test]
fn editing_a_profile_in_a_full_scope_does_not_count_as_an_extra_profile() {
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(&connection, SeedTestDetector::new());

    let first = save_profile(&service, "global-0", AgentScope::Global, None)
        .expect("save first global profile");
    for index in 1..30 {
        save_profile(
            &service,
            &format!("global-{index}"),
            AgentScope::Global,
            None,
        )
        .expect("save global profile within limit");
    }

    let updated = service
        .save_agent_profile(SaveAgentProfileInput {
            id: Some(first.id),
            name: "global-renamed".to_string(),
            agent_type: AgentType::Codex,
            command: "codex".to_string(),
            scope: AgentScope::Global,
            project_id: None,
            mode: "full-access".to_string(),
            dangerous: false,
            default_skill: String::new(),
            prompt_template: String::new(),
            display_mode: "json".to_string(),
            enabled: true,
        })
        .expect("edit profile at limit");

    assert_eq!(updated.name, "global-renamed");
}

#[test]
fn project_profile_limit_is_isolated_per_project() {
    let connection = migrated_in_memory_connection();
    let first_project_id = ProjectRepository::new(&connection)
        .insert("First", "/tmp/first")
        .expect("insert first project")
        .id;
    let second_project_id = ProjectRepository::new(&connection)
        .insert("Second", "/tmp/second")
        .expect("insert second project")
        .id;
    let service = test_settings_service(&connection, SeedTestDetector::new());

    for index in 0..30 {
        save_profile(
            &service,
            &format!("first-{index}"),
            AgentScope::Project,
            Some(first_project_id),
        )
        .expect("save first project profile within limit");
    }

    let error = save_profile(
        &service,
        "first-over-limit",
        AgentScope::Project,
        Some(first_project_id),
    )
    .expect_err("31st profile in the first project must be rejected");
    assert_eq!(error.reason.as_deref(), Some("agentProfileLimitExceeded"));

    save_profile(
        &service,
        "second-project-profile",
        AgentScope::Project,
        Some(second_project_id),
    )
    .expect("a different project has its own limit");
}

#[test]
fn builtin_seeding_does_not_exceed_the_global_limit() {
    let connection = migrated_in_memory_connection();
    {
        let repository = AgentProfileRepository::new(&connection);
        for index in 0..30 {
            repository
                .save_profile(
                    None,
                    &format!("claude-{index}"),
                    AgentType::Claude,
                    "claude",
                    &AgentScope::Global,
                    None,
                    "full-access",
                    false,
                    "",
                    "",
                    "json",
                    true,
                )
                .expect("save global profile at seed capacity");
        }
    }
    let service = test_settings_service(
        &connection,
        SeedTestDetector::with_detect_result("codex", Ok("codex")),
    );

    service.seed_builtin_agents().expect("seed builtins");

    let profiles = service
        .list_agent_profiles(ListAgentProfilesInput {
            scope: AgentScope::Global,
            project_id: None,
        })
        .expect("list profiles")
        .profiles;
    assert_eq!(profiles.len(), 30);
    assert!(!profiles
        .iter()
        .any(|profile| profile.agent_type == AgentType::Codex));
}
