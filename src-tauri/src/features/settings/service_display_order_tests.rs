use super::*;
use crate::db::migrations::MigrationRunner;
use crate::db::project_repository::ProjectRepository;
use crate::types::agent_profile::{
    AgentScope, AgentType, DeleteAgentProfileInput, ListAgentProfilesInput, SaveAgentProfileInput,
};
use rusqlite::{params, Connection};

use super::seed_preview_tests::{
    migrated_in_memory_connection, test_settings_service, SeedTestDetector,
};

fn save_named(
    service: &SettingsService<'_, SeedTestDetector>,
    name: &str,
    scope: AgentScope,
    project_id: Option<i64>,
    enabled: bool,
) -> i64 {
    service
        .save_agent_profile(SaveAgentProfileInput {
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
            enabled,
        })
        .expect("save profile")
        .id
}

fn listed_names(
    service: &SettingsService<'_, SeedTestDetector>,
    scope: AgentScope,
    project_id: Option<i64>,
) -> Vec<String> {
    service
        .list_agent_profiles(ListAgentProfilesInput { scope, project_id })
        .expect("list profiles")
        .profiles
        .into_iter()
        .map(|profile| profile.name)
        .collect()
}

fn insert_project(connection: &Connection) -> i64 {
    ProjectRepository::new(connection)
        .insert("RedWhisk", "/tmp/redwhisk")
        .expect("insert project")
        .id
}

/// 升级前的行：列已存在但 display_order 仍是 NULL。
fn insert_unordered_profile(
    connection: &Connection,
    name: &str,
    scope: &str,
    project_id: Option<i64>,
    enabled: i64,
) -> i64 {
    connection
        .execute(
            "INSERT INTO agent_profiles (
                name, agent_type, command, scope, project_id, mode, dangerous,
                default_skill, prompt_template, del, display_mode, enabled, display_order
             ) VALUES (?1, 'codex', 'codex', ?2, ?3, 'full-access', 0, '', '', 0, 'json', ?4, NULL)",
            params![name, scope, project_id, enabled],
        )
        .expect("insert unordered profile");
    connection.last_insert_rowid()
}

#[test]
fn list_returns_project_and_global_profiles_by_shared_display_order_not_id() {
    let connection = migrated_in_memory_connection();
    let project_id = insert_project(&connection);
    let service = test_settings_service(&connection, SeedTestDetector::new());

    let global_first = save_named(&service, "global-first", AgentScope::Global, None, true);
    let project_middle = save_named(
        &service,
        "project-middle",
        AgentScope::Project,
        Some(project_id),
        false,
    );
    let global_last = save_named(&service, "global-last", AgentScope::Global, None, true);

    // 故意把 id 更大的全局行写成更小的显示顺序，列表不能再按 id。
    connection
        .execute(
            "UPDATE agent_profiles SET display_order = CASE id
                WHEN ?1 THEN 30
                WHEN ?2 THEN 10
                WHEN ?3 THEN 20
             END",
            params![global_first, project_middle, global_last],
        )
        .expect("rewrite display order");

    assert_eq!(
        listed_names(&service, AgentScope::Global, None),
        vec!["global-last", "global-first"]
    );
    assert_eq!(
        listed_names(&service, AgentScope::Project, Some(project_id)),
        vec!["project-middle"]
    );
}

#[test]
fn list_backfills_unordered_profiles_enabled_first_then_id_and_keeps_that_order() {
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(&connection, SeedTestDetector::new());

    insert_unordered_profile(&connection, "enabled-low-id", "global", None, 1);
    insert_unordered_profile(&connection, "disabled-low-id", "global", None, 0);
    insert_unordered_profile(&connection, "enabled-high-id", "global", None, 1);
    insert_unordered_profile(&connection, "disabled-high-id", "global", None, 0);

    assert_eq!(
        listed_names(&service, AgentScope::Global, None),
        vec![
            "enabled-low-id",
            "enabled-high-id",
            "disabled-low-id",
            "disabled-high-id",
        ]
    );
    assert_eq!(
        listed_names(&service, AgentScope::Global, None),
        vec![
            "enabled-low-id",
            "enabled-high-id",
            "disabled-low-id",
            "disabled-high-id",
        ]
    );

    let still_null: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM agent_profiles WHERE del = 0 AND display_order IS NULL",
            [],
            |row| row.get(0),
        )
        .expect("count null orders");
    assert_eq!(still_null, 0);
}

#[test]
fn manually_created_profile_appends_after_current_maximum_even_when_tail_is_disabled() {
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(&connection, SeedTestDetector::new());

    save_named(&service, "enabled-head", AgentScope::Global, None, true);
    save_named(&service, "disabled-tail", AgentScope::Global, None, false);
    save_named(&service, "created-last", AgentScope::Global, None, true);

    assert_eq!(
        listed_names(&service, AgentScope::Global, None),
        vec!["enabled-head", "disabled-tail", "created-last"]
    );
}

#[test]
fn same_seed_round_appends_builtin_profiles_in_existing_seed_order() {
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(
        &connection,
        SeedTestDetector::with_detect_results(&[
            ("codex", Ok("codex")),
            ("claude", Ok("claude")),
            ("opencode", Ok("opencode")),
            ("grok", Ok("grok")),
            ("dsh", Ok("dsh")),
        ]),
    );

    save_named(&service, "disabled-tail", AgentScope::Global, None, false);
    service.seed_builtin_agents().expect("seed");

    // 表尾已是 codex，既有播种规则跳过该类型；其余仍按播种顺序接在后面。
    assert_eq!(
        listed_names(&service, AgentScope::Global, None),
        vec![
            "disabled-tail",
            "Claude Code",
            "OpenCode",
            "Grok",
            "DeepSeek",
        ]
    );
}

#[test]
fn editing_fields_or_enabled_does_not_move_the_profile() {
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(&connection, SeedTestDetector::new());

    let head = save_named(&service, "head", AgentScope::Global, None, true);
    let middle = save_named(&service, "middle", AgentScope::Global, None, true);
    save_named(&service, "tail", AgentScope::Global, None, false);

    service
        .save_agent_profile(SaveAgentProfileInput {
            id: Some(middle),
            name: "middle-renamed".to_string(),
            agent_type: AgentType::Claude,
            command: "claude".to_string(),
            scope: AgentScope::Global,
            project_id: None,
            mode: "default".to_string(),
            dangerous: true,
            default_skill: "skill".to_string(),
            prompt_template: "prompt".to_string(),
            display_mode: "json".to_string(),
            enabled: false,
        })
        .expect("edit profile");

    assert_eq!(
        listed_names(&service, AgentScope::Global, None),
        vec!["head", "middle-renamed", "tail"]
    );
    let _ = head;
}

#[test]
fn restoring_a_soft_deleted_profile_appends_it_to_the_tail() {
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(&connection, SeedTestDetector::new());

    let removed = save_named(&service, "removed", AgentScope::Global, None, true);
    save_named(&service, "kept", AgentScope::Global, None, false);

    service
        .delete_agent_profile(DeleteAgentProfileInput { id: removed })
        .expect("soft delete");
    assert_eq!(
        listed_names(&service, AgentScope::Global, None),
        vec!["kept"]
    );

    service
        .save_agent_profile(SaveAgentProfileInput {
            id: Some(removed),
            name: "removed".to_string(),
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
        .expect("restore profile");

    assert_eq!(
        listed_names(&service, AgentScope::Global, None),
        vec!["kept", "removed"]
    );
}

#[test]
fn list_backfills_legacy_rows_inserted_before_display_order_column() {
    let connection = Connection::open_in_memory().expect("in-memory db");
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .expect("foreign keys");
    MigrationRunner::runner_skipping(&["0054_agent_profiles_display_order"])
        .run(&connection)
        .expect("migrations before display order");

    connection
        .execute(
            "INSERT INTO agent_profiles (
                name, agent_type, command, scope, project_id, mode, dangerous,
                default_skill, prompt_template, del, display_mode, enabled
             ) VALUES ('enabled-low-id', 'opencode', 'opencode', 'global', NULL, 'full-access', 0, '', '', 0, 'json', 1)",
            [],
        )
        .expect("insert enabled low");
    connection
        .execute(
            "INSERT INTO agent_profiles (
                name, agent_type, command, scope, project_id, mode, dangerous,
                default_skill, prompt_template, del, display_mode, enabled
             ) VALUES ('disabled-low-id', 'codex', 'codex', 'global', NULL, 'full-access', 0, '', '', 0, 'json', 0)",
            [],
        )
        .expect("insert disabled");
    connection
        .execute(
            "INSERT INTO agent_profiles (
                name, agent_type, command, scope, project_id, mode, dangerous,
                default_skill, prompt_template, del, display_mode, enabled
             ) VALUES ('enabled-high-id', 'claude', 'claude', 'global', NULL, 'full-access', 0, '', '', 0, 'json', 1)",
            [],
        )
        .expect("insert enabled high");

    MigrationRunner::default()
        .run(&connection)
        .expect("apply display order migration");
    let service = test_settings_service(&connection, SeedTestDetector::new());

    assert_eq!(
        listed_names(&service, AgentScope::Global, None),
        vec!["enabled-low-id", "enabled-high-id", "disabled-low-id"]
    );
}
