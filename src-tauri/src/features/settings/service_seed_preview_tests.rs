use super::*;
use crate::agent::command_detector::AgentCommandDetector;
use crate::db::migrations::MigrationRunner;
use crate::types::agent_profile::{
    AgentScope, AgentType, PreviewAgentCommandArgsInput, SaveAgentProfileInput,
};
use rusqlite::Connection;

/// 播种测试专用 detector：可按命令名注入成功/失败结果；未配置的命令默认视为未装。
///
/// seed_builtin_agents 的顺序与是否播种由探测结果驱动，本 stub 让测试完全可控。
#[derive(Default, Clone)]
struct SeedTestDetector {
    detect_results: std::collections::HashMap<String, Result<String, String>>,
}

impl SeedTestDetector {
    fn new() -> Self {
        Self::default()
    }

    fn with_detect_result(command: &str, result: Result<&str, &str>) -> Self {
        let mut detector = Self::new();
        detector.detect_results.insert(
            command.to_string(),
            result.map(String::from).map_err(String::from),
        );
        detector
    }

    fn with_detect_results(entries: &[(&str, Result<&str, &str>)]) -> Self {
        let mut detector = Self::new();
        for (command, result) in entries {
            detector.detect_results.insert(
                (*command).to_string(),
                result.map(String::from).map_err(String::from),
            );
        }
        detector
    }
}

impl AgentCommandDetector for SeedTestDetector {
    fn detect_command(&self, command_name: &str) -> Result<String, String> {
        // 未显式配置结果的命令一律视为未装，保证 seed_builtin_agents 测试可控。
        self.detect_results
            .get(command_name)
            .cloned()
            .unwrap_or_else(|| Err(format!("{command_name} not installed")))
    }

    fn test_command(&self, command: &str) -> Result<String, String> {
        Ok(command.to_string())
    }
}

#[test]
fn seed_builtin_agents_inserts_default_profile_when_detected_and_no_record() {
    // 空库 + 探测到 codex 已装 → 应插入一条 codex 默认 profile。
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(
        &connection,
        SeedTestDetector::with_detect_result("codex", Ok("codex")),
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
    let profile = &profiles[0];
    assert_eq!(profile.agent_type, AgentType::Codex);
    assert_eq!(profile.name, "Codex");
    assert_eq!(profile.command, "codex");
    assert_eq!(profile.scope, AgentScope::Global);
    assert_eq!(profile.mode, "full-access");
    assert!(profile.dangerous);
    assert_eq!(profile.display_mode, "json");
    assert!(profile.enabled);
}

#[test]
fn seed_builtin_agents_skips_when_active_record_exists() {
    // 已有 del=0 的 codex 记录 → 不应再插。
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(
        &connection,
        SeedTestDetector::with_detect_result("codex", Ok("codex")),
    );

    service
        .save_agent_profile(SaveAgentProfileInput {
            id: None,
            name: "My Codex".to_string(),
            agent_type: AgentType::Codex,
            command: "codex".to_string(),
            scope: AgentScope::Global,
            project_id: None,
            mode: "default".to_string(),
            dangerous: false,
            default_skill: "".to_string(),
            prompt_template: "".to_string(),
            display_mode: "json".to_string(),
            enabled: false,
        })
        .expect("save existing");

    service.seed_builtin_agents().expect("seed");

    let profiles = service
        .list_agent_profiles(ListAgentProfilesInput {
            scope: AgentScope::Global,
            project_id: None,
        })
        .expect("list")
        .profiles;
    assert_eq!(profiles.len(), 1, "不应重复播种");
    assert_eq!(profiles[0].name, "My Codex");
}

#[test]
fn seed_builtin_agents_skips_when_soft_deleted_record_exists() {
    // 软删 codex 后仍判存在（含 del=1），不重复播种（ADR-0019 幂等语义）。
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(
        &connection,
        SeedTestDetector::with_detect_result("codex", Ok("codex")),
    );

    let saved = service
        .save_agent_profile(SaveAgentProfileInput {
            id: None,
            name: "Codex".to_string(),
            agent_type: AgentType::Codex,
            command: "codex".to_string(),
            scope: AgentScope::Global,
            project_id: None,
            mode: "full-access".to_string(),
            dangerous: true,
            default_skill: "".to_string(),
            prompt_template: "".to_string(),
            display_mode: "json".to_string(),
            enabled: true,
        })
        .expect("save");
    service
        .delete_agent_profile(DeleteAgentProfileInput { id: saved.id })
        .expect("delete");

    service.seed_builtin_agents().expect("seed");

    // list_profiles_by_scope 过滤 del=0，软删后查不到记录，但 exists 判定应阻止播种。
    let profiles = service
        .list_agent_profiles(ListAgentProfilesInput {
            scope: AgentScope::Global,
            project_id: None,
        })
        .expect("list")
        .profiles;
    assert!(profiles.is_empty(), "软删后不应重新播种");
}

#[test]
fn seed_builtin_agents_skips_when_detection_fails() {
    // 探测失败（未装）静默跳过，不插入任何 profile。
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(
        &connection,
        SeedTestDetector::with_detect_result("codex", Err("command not found")),
    );

    service.seed_builtin_agents().expect("seed");

    let profiles = service
        .list_agent_profiles(ListAgentProfilesInput {
            scope: AgentScope::Global,
            project_id: None,
        })
        .expect("list")
        .profiles;
    assert!(profiles.is_empty(), "探测失败应跳过");
}

#[test]
fn seed_builtin_agents_processes_codex_claude_opencode_grok_in_order() {
    // 全部已装：应按固定顺序播种 4 条；list 按 id 升序返回，顺序与播种顺序一致。
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(
        &connection,
        SeedTestDetector::with_detect_results(&[
            ("codex", Ok("codex")),
            ("claude", Ok("claude")),
            ("opencode", Ok("opencode")),
            ("grok", Ok("grok")),
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
    assert_eq!(
        profiles
            .iter()
            .map(|p| p.agent_type.clone())
            .collect::<Vec<_>>(),
        vec![AgentType::Codex, AgentType::Claude, AgentType::OpenCode, AgentType::Grok,]
    );
    let claude = profiles
        .iter()
        .find(|p| p.agent_type == AgentType::Claude)
        .expect("claude profile");
    assert_eq!(claude.name, "Claude Code");
    assert_eq!(claude.display_mode, "json");
    let opencode = profiles
        .iter()
        .find(|p| p.agent_type == AgentType::OpenCode)
        .expect("opencode profile");
    assert_eq!(opencode.name, "OpenCode");
    assert_eq!(opencode.display_mode, "tui");
    let grok = profiles
        .iter()
        .find(|p| p.agent_type == AgentType::Grok)
        .expect("grok profile");
    assert_eq!(grok.name, "Grok");
    assert_eq!(grok.display_mode, "tui");
}

#[test]
fn seed_builtin_agents_partial_detection_only_seeds_detected() {
    // 只装了 codex 与 grok：只应播种这两条，claude/opencode 跳过。
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(
        &connection,
        SeedTestDetector::with_detect_results(&[
            ("codex", Ok("codex")),
            ("claude", Err("not found")),
            ("opencode", Err("not found")),
            ("grok", Ok("grok")),
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
    assert_eq!(
        profiles
            .iter()
            .map(|p| p.agent_type.clone())
            .collect::<Vec<_>>(),
        vec![AgentType::Codex, AgentType::Grok]
    );
}

#[test]
fn preview_agent_command_args_returns_bypass_args_for_codex() {
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(&connection, SeedTestDetector::new());

    let args = service
        .preview_agent_command_args(PreviewAgentCommandArgsInput {
            agent_type: AgentType::Codex,
            command: "codex".to_string(),
            mode: "full-access".to_string(),
            dangerous: true,
        })
        .expect("preview");
    assert_eq!(
        args,
        vec!["--dangerously-bypass-approvals-and-sandbox".to_string()]
    );
}

#[test]
fn preview_agent_command_args_returns_bypass_args_for_claude() {
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(&connection, SeedTestDetector::new());

    let args = service
        .preview_agent_command_args(PreviewAgentCommandArgsInput {
            agent_type: AgentType::Claude,
            command: "claude".to_string(),
            mode: "full-access".to_string(),
            dangerous: true,
        })
        .expect("preview");
    assert_eq!(
        args,
        vec!["--permission-mode".to_string(), "bypassPermissions".to_string(),]
    );
}

#[test]
fn preview_agent_command_args_returns_empty_for_opencode() {
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(&connection, SeedTestDetector::new());

    let args = service
        .preview_agent_command_args(PreviewAgentCommandArgsInput {
            agent_type: AgentType::OpenCode,
            command: "opencode".to_string(),
            mode: "full-access".to_string(),
            dangerous: true,
        })
        .expect("preview");
    assert!(args.is_empty(), "opencode 占位 descriptor 参数应为空");
}

#[test]
fn preview_agent_command_args_returns_empty_for_grok() {
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(&connection, SeedTestDetector::new());

    let args = service
        .preview_agent_command_args(PreviewAgentCommandArgsInput {
            agent_type: AgentType::Grok,
            command: "grok".to_string(),
            mode: "full-access".to_string(),
            dangerous: true,
        })
        .expect("preview");
    assert!(args.is_empty(), "grok 占位 descriptor 参数应为空");
}

#[test]
fn preview_agent_command_args_returns_empty_when_not_dangerous() {
    // dangerous=false：不加 bypass 参数；任何 agentType 都应返回空。
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(&connection, SeedTestDetector::new());

    let args = service
        .preview_agent_command_args(PreviewAgentCommandArgsInput {
            agent_type: AgentType::Codex,
            command: "codex".to_string(),
            mode: "full-access".to_string(),
            dangerous: false,
        })
        .expect("preview");
    assert!(args.is_empty(), "dangerous=false 不应有 bypass 参数");
}

#[test]
fn preview_agent_command_args_preserves_user_provided_command_args() {
    // 用户在 command 中自带的参数应保留（除 bypass 外的 CLI 参数原样透出）。
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(&connection, SeedTestDetector::new());

    let args = service
        .preview_agent_command_args(PreviewAgentCommandArgsInput {
            agent_type: AgentType::Claude,
            command: "claude --model opus".to_string(),
            mode: "full-access".to_string(),
            dangerous: true,
        })
        .expect("preview");
    assert_eq!(
        args,
        vec![
            "--model".to_string(),
            "opus".to_string(),
            "--permission-mode".to_string(),
            "bypassPermissions".to_string(),
        ]
    );
}

#[test]
fn preview_agent_command_args_rejects_empty_command() {
    let connection = migrated_in_memory_connection();
    let service = test_settings_service(&connection, SeedTestDetector::new());

    let error = service
        .preview_agent_command_args(PreviewAgentCommandArgsInput {
            agent_type: AgentType::Codex,
            command: "   ".to_string(),
            mode: "full-access".to_string(),
            dangerous: true,
        })
        .expect_err("empty command should fail");
    assert_eq!(error.code, CommandErrorCode::AgentProfileValidationFailed);
}

fn migrated_in_memory_connection() -> Connection {
    // lib 测试 binary 在本机对文件库写 agent_profiles 会触发 SQLite IOERR_BEGIN_ATOMIC；
    // :memory: 规避该环境问题。参考 db/agent_profile_repository_tests.rs。
    let connection = Connection::open_in_memory().expect("in-memory db");
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .expect("foreign_keys");
    MigrationRunner::default()
        .run(&connection)
        .expect("migrations");
    connection
}

fn test_settings_service<'a>(
    connection: &'a Connection,
    detector: SeedTestDetector,
) -> SettingsService<'a, SeedTestDetector> {
    SettingsService::new(
        AgentProfileRepository::new(connection),
        ProjectLabelRepository::new(connection),
        SavedAgentSkillRepository::new(connection),
        ProjectRepository::new(connection),
        detector,
    )
}
