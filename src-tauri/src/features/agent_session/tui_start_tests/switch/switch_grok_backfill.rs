//! 修复前的 Grok TUI 没有在启动时写入 provider session id。
//! 切换展示形式时必须按 cwd 补查本机会话目录，而不是直接报缺少标识。

use super::harness::*;
use chrono::{DateTime, SecondsFormat};

#[test]
fn switch_backfills_grok_provider_session_id_from_native_store() {
    let temp_dir = tempdir().expect("temp");
    let home_dir = temp_dir.path().to_path_buf();
    let data_dir = home_dir.join(".redwhisk");
    fs::create_dir_all(&data_dir).expect("data dir");
    let repo_dir = home_dir.join("repo");
    create_git_repo(&repo_dir);
    let script = home_dir.join("fake-grok.sh");
    write_sleep_script(&script);
    let database = open_db(&data_dir);
    let session_id = seed_switch_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        None,
        "stopped",
        "running",
        "grok",
        "tui",
        "tui",
    );
    let provider_session_id = "01a14da9-a5a0-7010-8cb3-df86389192c3";
    write_grok_summary(&home_dir, &repo_dir, provider_session_id, 1_500);

    let agent = service(&database.connection);
    let factory = RecordingFactory::default();
    let result = agent
        .switch_agent_session_display_mode(
            &data_dir,
            SwitchAgentSessionDisplayModeInput {
                project_id: 1,
                session_id,
            },
            &AgentSessionRegistry::new(),
            &AgentEventBroadcaster::new(),
            &PtySessionManager::new(),
            &factory,
            NativeSessionHomes {
                codex_home: None,
                user_home: Some(&home_dir),
            },
        )
        .expect("switch backfills the grok session id");

    assert_eq!(result.display_mode, "json");
    assert_eq!(result.provider_session_id, provider_session_id);
    let record = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find")
        .expect("session");
    assert_eq!(
        record.provider_session_id.as_deref(),
        Some(provider_session_id)
    );
    assert_eq!(
        factory.resume_thread_ids.lock().expect("lock").as_slice(),
        &[Some(provider_session_id.to_string())]
    );
}

#[test]
fn switch_still_rejects_grok_tui_when_native_store_has_no_match() {
    let temp_dir = tempdir().expect("temp");
    let home_dir = temp_dir.path().to_path_buf();
    let data_dir = home_dir.join(".redwhisk");
    fs::create_dir_all(&data_dir).expect("data dir");
    let repo_dir = home_dir.join("repo");
    create_git_repo(&repo_dir);
    let script = home_dir.join("fake-grok.sh");
    write_sleep_script(&script);
    let database = open_db(&data_dir);
    let session_id = seed_switch_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        None,
        "stopped",
        "running",
        "grok",
        "tui",
        "tui",
    );
    let agent = service(&database.connection);
    let factory = RecordingFactory::default();
    let error = agent
        .switch_agent_session_display_mode(
            &data_dir,
            SwitchAgentSessionDisplayModeInput {
                project_id: 1,
                session_id,
            },
            &AgentSessionRegistry::new(),
            &AgentEventBroadcaster::new(),
            &PtySessionManager::new(),
            &factory,
            NativeSessionHomes {
                codex_home: None,
                user_home: Some(&home_dir),
            },
        )
        .expect_err("no native session");
    assert_eq!(error.reason.as_deref(), Some("missingResumeSessionId"));
    assert_eq!(
        AgentSessionRepository::new(&database.connection)
            .find_by_id(session_id)
            .expect("find")
            .expect("session")
            .display_mode,
        "tui"
    );
}

fn write_grok_summary(
    home: &std::path::Path,
    cwd: &std::path::Path,
    session_id: &str,
    created_at_ms: i64,
) {
    let encoded = percent_encode_cwd(&cwd.to_string_lossy());
    let dir = home
        .join(".grok")
        .join("sessions")
        .join(encoded)
        .join(session_id);
    fs::create_dir_all(&dir).expect("session dir");
    let created_at = DateTime::from_timestamp_millis(created_at_ms)
        .expect("timestamp")
        .to_rfc3339_opts(SecondsFormat::Micros, true);
    let cwd_text = cwd.to_string_lossy();
    fs::write(
        dir.join("summary.json"),
        format!(
            r#"{{"info":{{"id":"{session_id}","cwd":"{cwd_text}"}},"created_at":"{created_at}"}}"#
        ),
    )
    .expect("summary");
}

fn percent_encode_cwd(cwd: &str) -> String {
    let mut encoded = String::new();
    for byte in cwd.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(*byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}
