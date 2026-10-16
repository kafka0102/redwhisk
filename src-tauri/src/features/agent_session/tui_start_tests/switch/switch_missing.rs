use super::harness::*;

#[test]
fn switch_to_json_succeeds_when_native_session_log_is_missing() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let script = temp_dir.path().join("fake-tui.sh");
    write_sleep_script(&script);
    let database = open_db(temp_dir.path());
    let session_id = seed_switch_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        Some("missing-thread"),
        "stopped",
        "running",
        "codex",
        "tui",
        "json",
    );
    let agent = service(&database.connection);
    let factory = RecordingFactory {
        resume_thread_ids: std::sync::Mutex::new(Vec::new()),
        sends: Arc::new(AtomicUsize::new(0)),
    };
    let result = agent
        .switch_agent_session_display_mode(
            temp_dir.path(),
            SwitchAgentSessionDisplayModeInput {
                project_id: 1,
                session_id,
            },
            &AgentSessionRegistry::new(),
            &AgentEventBroadcaster::new(),
            &PtySessionManager::new(),
            &factory,
            NativeSessionHomes {
                codex_home: Some(temp_dir.path()),
                user_home: None,
            },
        )
        .expect("switch still succeeds");
    assert_eq!(result.display_mode, "json");
    assert_eq!(result.provider_session_id, "missing-thread");
    let record = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find")
        .expect("session");
    assert!(timeline_texts(&record.log_path).is_empty());
}
