use super::harness::*;

#[test]
fn switch_from_live_tui_replaces_snapshot_relaunches_same_provider_session_and_backfills_json() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let script = temp_dir.path().join("fake-tui.sh");
    write_sleep_script(&script);
    let codex_home = temp_dir.path().join("codex-home");
    let provider_session_id = "thread-switch-1";
    write_codex_rollout(&codex_home, provider_session_id);

    let database = open_db(temp_dir.path());
    let session_id = seed_switch_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        Some(provider_session_id),
        "stopped",
        "running",
        "codex",
        "tui",
        "tui",
    );
    let agent = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();
    agent
        .resume_agent_session(
            temp_dir.path(),
            ResumeAgentSessionInput {
                project_id: 1,
                session_id,
                reopen_completed: false,
                workspace_branch: None,
            },
            &registry,
            &broadcaster,
            &pty,
        )
        .expect("live tui");
    assert!(pty.contains(session_id));

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
            &registry,
            &broadcaster,
            &pty,
            &factory,
            NativeSessionHomes {
                codex_home: Some(&codex_home),
                user_home: None,
            },
        )
        .expect("switch to json");

    assert_eq!(result.session_id, session_id);
    assert_eq!(result.display_mode, "json");
    assert_eq!(result.provider_session_id, provider_session_id);
    assert_eq!(
        factory.resume_thread_ids.lock().expect("lock").as_slice(),
        &[Some(provider_session_id.to_string())]
    );
    assert_eq!(factory.sends.load(Ordering::SeqCst), 0);
    assert!(!pty.contains(session_id));

    let record = AgentSessionRepository::new(&database.connection)
        .find_by_id(session_id)
        .expect("find")
        .expect("session");
    assert_eq!(record.display_mode, "json");
    assert_eq!(
        record.provider_session_id.as_deref(),
        Some(provider_session_id)
    );
    assert_eq!(record.status, AgentSessionStatus::Running);
    assert_eq!(profile_display_mode(&database.connection), "tui");
    let texts = timeline_texts(&record.log_path);
    assert_eq!(
        texts,
        vec![
            "fix the login".to_string(),
            "login is fixed".to_string(),
            "add a test".to_string(),
            "test added".to_string(),
        ]
    );
    assert!(texts.iter().all(|text| !text.contains("SECRET_TOOL")));
}
