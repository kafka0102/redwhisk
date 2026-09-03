use super::*;
use crate::db::migrations::MigrationRunner;
use rusqlite::Connection;

fn migrated_connection() -> Connection {
    // 用内存库（:memory:）跑迁移：lib 测试 binary 在本机对文件库写 agent_profiles
    // 会触发 SQLite batch atomic write 失败（IOERR_BEGIN_ATOMIC, 6922）；内存库无磁盘
    // 文件，规避该环境问题。集成测试（tests/）用文件库且不受影响，已覆盖文件路径。
    let connection = Connection::open_in_memory().expect("in-memory db");
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .expect("foreign_keys");
    MigrationRunner::default()
        .run(&connection)
        .expect("migrations");
    connection
}

fn save_global_profile(
    repository: &AgentProfileRepository<'_>,
    name: &str,
    agent_type: AgentType,
    command: &str,
    display_mode: &str,
    enabled: bool,
) -> AgentProfileRow {
    repository
        .save_profile(
            None,
            name,
            agent_type,
            command,
            &AgentScope::Global,
            None,
            "full-auto",
            true,
            "",
            "",
            display_mode,
            enabled,
        )
        .expect("save profile")
}

#[test]
fn save_and_read_round_trips_display_mode_and_enabled() {
    let connection = migrated_connection();
    let repository = AgentProfileRepository::new(&connection);

    let saved = save_global_profile(
        &repository,
        "Codex Default",
        AgentType::Codex,
        "codex",
        "json",
        true,
    );

    assert_eq!(saved.display_mode, "json");
    assert!(saved.enabled);

    let listed = repository
        .list_profiles_by_scope(&AgentScope::Global, None)
        .expect("list profiles");
    assert_eq!(listed, vec![saved.clone()]);

    let found = repository
        .find_profile_by_id(saved.id)
        .expect("find by id")
        .expect("profile exists");
    assert_eq!(found.display_mode, "json");
    assert!(found.enabled);
}

#[test]
fn save_and_read_round_trips_disabled_and_tui_display_mode() {
    let connection = migrated_connection();
    let repository = AgentProfileRepository::new(&connection);

    let saved = save_global_profile(
        &repository,
        "OpenCode Default",
        AgentType::OpenCode,
        "opencode",
        "tui",
        false,
    );

    assert_eq!(saved.agent_type, AgentType::OpenCode);
    assert_eq!(saved.display_mode, "tui");
    assert!(!saved.enabled);
}

#[test]
fn save_profile_updates_display_mode_and_enabled_on_existing_row() {
    let connection = migrated_connection();
    let repository = AgentProfileRepository::new(&connection);

    let saved = save_global_profile(
        &repository,
        "Codex",
        AgentType::Codex,
        "codex",
        "json",
        true,
    );

    let updated = repository
        .save_profile(
            Some(saved.id),
            "Codex",
            AgentType::Codex,
            "codex",
            &AgentScope::Global,
            None,
            "full-auto",
            true,
            "",
            "",
            "tui",
            false,
        )
        .expect("update profile");

    assert_eq!(updated.display_mode, "tui");
    assert!(!updated.enabled);
}

#[test]
fn agent_type_round_trips_for_opencode_and_grok() {
    let connection = migrated_connection();
    let repository = AgentProfileRepository::new(&connection);

    let opencode = save_global_profile(
        &repository,
        "OpenCode",
        AgentType::OpenCode,
        "opencode",
        "tui",
        true,
    );
    let grok = save_global_profile(&repository, "Grok", AgentType::Grok, "grok", "tui", true);

    assert_eq!(opencode.agent_type, AgentType::OpenCode);
    assert_eq!(grok.agent_type, AgentType::Grok);

    let found_opencode = repository
        .find_profile_by_id(opencode.id)
        .expect("find")
        .expect("opencode profile");
    let found_grok = repository
        .find_profile_by_id(grok.id)
        .expect("find")
        .expect("grok profile");
    assert_eq!(found_opencode.agent_type, AgentType::OpenCode);
    assert_eq!(found_grok.agent_type, AgentType::Grok);
}

#[test]
fn save_profile_rejects_invalid_agent_type_via_check_constraint() {
    let connection = migrated_connection();
    // 直接 SQL 绕过 repository，验证 CHECK 约束拒绝非法 agent_type。
    let result = connection.execute(
            "INSERT INTO agent_profiles (name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del, display_mode, enabled)
             VALUES ('bad', 'gemini', 'gemini', 'global', NULL, 'full-auto', 1, '', '', 0, 'json', 1)",
            [],
        );
    assert!(result.is_err(), "agent_type CHECK 应拒绝 gemini");
}

#[test]
fn save_profile_rejects_invalid_display_mode_via_check_constraint() {
    let connection = migrated_connection();
    let result = connection.execute(
            "INSERT INTO agent_profiles (name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del, display_mode, enabled)
             VALUES ('bad', 'codex', 'codex', 'global', NULL, 'full-auto', 1, '', '', 0, 'rich', 1)",
            [],
        );
    assert!(result.is_err(), "display_mode CHECK 应拒绝 rich");
}

#[test]
fn save_profile_rejects_invalid_enabled_via_check_constraint() {
    let connection = migrated_connection();
    let result = connection.execute(
            "INSERT INTO agent_profiles (name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del, display_mode, enabled)
             VALUES ('bad', 'codex', 'codex', 'global', NULL, 'full-auto', 1, '', '', 0, 'json', 2)",
            [],
        );
    assert!(result.is_err(), "enabled CHECK 应拒绝 2");
}

#[test]
fn exists_profile_by_agent_type_returns_false_when_no_records() {
    let connection = migrated_connection();
    let repository = AgentProfileRepository::new(&connection);

    assert!(!repository
        .exists_profile_by_agent_type(AgentType::Codex)
        .expect("exists codex"));
}

#[test]
fn exists_profile_by_agent_type_returns_true_for_active_record() {
    let connection = migrated_connection();
    let repository = AgentProfileRepository::new(&connection);

    save_global_profile(
        &repository,
        "Codex",
        AgentType::Codex,
        "codex",
        "json",
        true,
    );

    assert!(repository
        .exists_profile_by_agent_type(AgentType::Codex)
        .expect("exists codex"));
    assert!(!repository
        .exists_profile_by_agent_type(AgentType::Claude)
        .expect("exists claude"));
}

#[test]
fn exists_profile_by_agent_type_returns_true_for_soft_deleted_record() {
    let connection = migrated_connection();
    let repository = AgentProfileRepository::new(&connection);

    let saved = save_global_profile(
        &repository,
        "Codex",
        AgentType::Codex,
        "codex",
        "json",
        true,
    );
    repository
        .soft_delete_profile(saved.id)
        .expect("soft delete");

    // 软删后仍判存在（含 del=1），播种幂等依赖此语义。
    assert!(repository
        .exists_profile_by_agent_type(AgentType::Codex)
        .expect("exists codex"));
}

#[test]
fn existing_rows_default_to_json_display_mode_and_enabled_after_migration() {
    let connection = migrated_connection();
    // 直接 SQL 插入时不写 display_mode / enabled，验证迁移默认值。
    connection
            .execute(
                "INSERT INTO agent_profiles (name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
                 VALUES ('Legacy', 'codex', 'codex', 'global', NULL, 'full-auto', 1, '', '', 0)",
                [],
            )
            .expect("insert legacy row");
    let repository = AgentProfileRepository::new(&connection);
    let listed = repository
        .list_profiles_by_scope(&AgentScope::Global, None)
        .expect("list");
    let row = listed
        .iter()
        .find(|row| row.name == "Legacy")
        .expect("legacy row");
    assert_eq!(row.display_mode, "json");
    assert!(row.enabled);
}
