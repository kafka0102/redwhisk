//! 续接 / 切换展示形式后重建结构化 provider 进程时，必须恢复启动期参数。
//!
//! 结构化路径的 argv 每次 spawn 现算（不像 TUI 把 `--always-approve` / `-m` 冻结在
//! `command_snapshot` 里），漏传就会静默退回 provider 默认值：
//! - mode / dangerous：Grok 退回「逐条命令问审批」，UI 上表现为莫名其妙的权限卡；
//! - model：换一个模型继续跑（Grok 别名自带 base_url / api_key，换掉别名等于换路由）。

use std::fs;
use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

use super::tests::{
    insert_session_list_row, setup_session_list_database, test_agent_session_service,
    RecordingProviderFactory,
};
use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::session_registry::AgentSessionRegistry;
use crate::db::agent_profile_repository::AgentProfileRepository;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::features::agent_session::display_mode_switch_relaunch::relaunch_structured;
use crate::types::agent_session::AgentSessionStatus;

const GROK_PROFILE_ID: i64 = 301;
/// 落库的启动期模型：发给 LLM 的 wire 参数。
const GROK_STARTUP_MODEL: &str = "grok-4.7";
/// 启动时真正传给 provider 的模型入参：`[model.<别名>]` 的别名。
const GROK_MODEL_ARG: &str = "my-model";

/// 写 `~/.grok/config.toml`（home = `data_dir` 的父目录）：别名 my-model → wire grok-4.7。
fn seed_grok_alias_config(home_dir: &Path) {
    let grok_dir = home_dir.join(".grok");
    fs::create_dir_all(&grok_dir).expect("grok dir");
    fs::write(
        grok_dir.join("config.toml"),
        "[model.my-model]\nmodel = \"grok-4.7\"\n\n[models]\ndefault = \"my-model\"\n",
    )
    .expect("write grok config");
}

/// 插一条 full-access / dangerous 的 Grok Profile（结构化 json 展示形式）。
fn seed_full_access_grok_profile(connection: &Connection) {
    connection
        .execute(
            "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
             VALUES (?1, 'Grok', 'grok', 'grok', 'global', NULL, 'full-access', 1, '', '', 0)",
            [GROK_PROFILE_ID],
        )
        .expect("insert grok profile");
}

fn seed_grok_json_session(connection: &Connection, session_id: i64, issue_id: i64) {
    insert_session_list_row(
        connection,
        session_id,
        Some(issue_id),
        Some("issue"),
        Some("running"),
        AgentSessionStatus::Stopped,
        100,
        Some(200),
    );
    connection
        .execute(
            "UPDATE agent_sessions
             SET agent_profile_id = ?2, provider_session_id = 'thread-grok',
                 display_mode = 'json', command_snapshot = 'grok', startup_model = ?3
             WHERE id = ?1",
            rusqlite::params![session_id, GROK_PROFILE_ID, GROK_STARTUP_MODEL],
        )
        .expect("update session");
}

fn find_session(
    connection: &Connection,
    session_id: i64,
) -> crate::types::agent_session::AgentSessionRecord {
    AgentSessionRepository::new(connection)
        .find_by_id(session_id)
        .expect("query session")
        .expect("session exists")
}

fn prepare_service(
    connection: &Connection,
    session_id: i64,
    issue_id: i64,
) -> crate::types::agent_session::AgentSessionRecord {
    seed_full_access_grok_profile(connection);
    seed_grok_json_session(connection, session_id, issue_id);
    find_session(connection, session_id)
}

fn captured_request(
    factory: &RecordingProviderFactory,
) -> crate::agent::provider_factory::AgentSessionStartRequest {
    factory
        .captured
        .lock()
        .expect("lock")
        .take()
        .expect("captured request")
}

/// json 会话续接（`resume_agent_session` 的 structured 分支）沿用 profile 权限策略。
#[test]
fn structured_resume_keeps_profile_permission_policy() {
    let temp = tempfile::tempdir().expect("temp dir");
    let connection = setup_session_list_database();
    let session = prepare_service(&connection, 801, 81);
    let service = test_agent_session_service(&connection);
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();
    let factory = RecordingProviderFactory {
        captured: Mutex::new(None),
    };

    service
        .resume_structured_agent_session(
            temp.path(),
            &session,
            1,
            None,
            false,
            &registry,
            &broadcaster,
            &factory,
        )
        .expect("resume structured session");

    let captured = captured_request(&factory);
    assert_eq!(captured.resume_thread_id.as_deref(), Some("thread-grok"));
    assert_eq!(
        captured.mode_id.as_deref(),
        Some("full-access"),
        "续接丢失 profile.mode"
    );
    assert!(
        captured.dangerous,
        "续接丢失 profile.dangerous，provider 会退回逐条问审批"
    );
}

/// json 会话续接沿用启动期模型，且 Grok 要还原回别名而不是 wire 名。
#[test]
fn structured_resume_keeps_startup_model() {
    let temp = tempfile::tempdir().expect("temp dir");
    seed_grok_alias_config(temp.path());
    let data_dir = temp.path().join("redwhisk-data");
    fs::create_dir_all(&data_dir).expect("data dir");
    let connection = setup_session_list_database();
    let session = prepare_service(&connection, 803, 83);
    let service = test_agent_session_service(&connection);
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();
    let factory = RecordingProviderFactory {
        captured: Mutex::new(None),
    };

    service
        .resume_structured_agent_session(
            &data_dir,
            &session,
            1,
            None,
            false,
            &registry,
            &broadcaster,
            &factory,
        )
        .expect("resume structured session");

    assert_eq!(
        captured_request(&factory).model.as_deref(),
        Some(GROK_MODEL_ARG),
        "续接未恢复启动期模型，或把 wire 名当成了 CLI 模型入参"
    );
}

/// 展示形式切回 json 时重拉结构化进程同样沿用 profile 权限策略。
#[test]
fn display_mode_switch_relaunch_keeps_profile_permission_policy() {
    let temp = tempfile::tempdir().expect("temp dir");
    let connection = setup_session_list_database();
    let session = prepare_service(&connection, 802, 82);
    let service = test_agent_session_service(&connection);
    let profile = grok_profile(&connection);
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();
    let factory = RecordingProviderFactory {
        captured: Mutex::new(None),
    };

    relaunch_structured(
        &service,
        temp.path(),
        &session,
        &profile,
        "thread-grok",
        &registry,
        &broadcaster,
        &factory,
    )
    .expect("relaunch structured session");

    let captured = captured_request(&factory);
    assert_eq!(
        captured.mode_id.as_deref(),
        Some("full-access"),
        "切形态后重拉丢失 profile.mode"
    );
    assert!(
        captured.dangerous,
        "切形态后重拉丢失 profile.dangerous，provider 会退回逐条问审批"
    );
}

/// 展示形式切回 json 时重拉结构化进程同样沿用启动期模型。
#[test]
fn display_mode_switch_relaunch_keeps_startup_model() {
    let temp = tempfile::tempdir().expect("temp dir");
    seed_grok_alias_config(temp.path());
    let data_dir = temp.path().join("redwhisk-data");
    fs::create_dir_all(&data_dir).expect("data dir");
    let connection = setup_session_list_database();
    let session = prepare_service(&connection, 804, 84);
    let service = test_agent_session_service(&connection);
    let profile = grok_profile(&connection);
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();
    let factory = RecordingProviderFactory {
        captured: Mutex::new(None),
    };

    relaunch_structured(
        &service,
        &data_dir,
        &session,
        &profile,
        "thread-grok",
        &registry,
        &broadcaster,
        &factory,
    )
    .expect("relaunch structured session");

    assert_eq!(
        captured_request(&factory).model.as_deref(),
        Some(GROK_MODEL_ARG),
        "切形态后重拉未恢复启动期模型，或把 wire 名当成了 CLI 模型入参"
    );
}

fn grok_profile(connection: &Connection) -> crate::db::agent_profile_repository::AgentProfileRow {
    AgentProfileRepository::new(connection)
        .find_profile_by_id(GROK_PROFILE_ID)
        .expect("query profile")
        .expect("profile exists")
}
