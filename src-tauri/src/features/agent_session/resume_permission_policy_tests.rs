//! 续接 / 切换展示形式后重建结构化 provider 进程时，必须沿用 Profile 的权限策略。
//!
//! 回归背景：结构化路径的 argv 每次 spawn 现算（不像 TUI 把 `--always-approve`
//! 冻结在 `command_snapshot` 里），漏传 mode / dangerous 会让 Grok 退回「逐条命令
//! 问审批」，在 UI 上表现为莫名其妙的权限卡（Grok 侧 `session/request_permission`）。

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
                 display_mode = 'json', command_snapshot = 'grok'
             WHERE id = ?1",
            rusqlite::params![session_id, GROK_PROFILE_ID],
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

/// json 会话续接（`resume_agent_session` 的 structured 分支）沿用 profile 权限策略。
#[test]
fn structured_resume_keeps_profile_permission_policy() {
    let temp = tempfile::tempdir().expect("temp dir");
    let connection = setup_session_list_database();
    seed_full_access_grok_profile(&connection);
    seed_grok_json_session(&connection, 801, 81);
    let service = test_agent_session_service(&connection);
    let session = find_session(&connection, 801);
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

    let captured = factory
        .captured
        .lock()
        .expect("lock")
        .take()
        .expect("captured request");
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

/// 展示形式切回 json 时重拉结构化进程同样沿用 profile 权限策略。
#[test]
fn display_mode_switch_relaunch_keeps_profile_permission_policy() {
    let temp = tempfile::tempdir().expect("temp dir");
    let connection = setup_session_list_database();
    seed_full_access_grok_profile(&connection);
    seed_grok_json_session(&connection, 802, 82);
    let service = test_agent_session_service(&connection);
    let session = find_session(&connection, 802);
    let profile = AgentProfileRepository::new(&connection)
        .find_profile_by_id(GROK_PROFILE_ID)
        .expect("query profile")
        .expect("profile exists");
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

    let captured = factory
        .captured
        .lock()
        .expect("lock")
        .take()
        .expect("captured request");
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
