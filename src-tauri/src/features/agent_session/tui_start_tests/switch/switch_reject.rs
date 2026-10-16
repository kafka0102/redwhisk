use super::harness::*;

#[test]
fn switch_rejects_deepseek_and_completed_issue_without_changing_snapshot() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let database = open_db(temp_dir.path());
    let session_id = seed_switch_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        "dsh",
        Some("deepseek-session"),
        "stopped",
        "running",
        "deepseek",
        "json",
        "json",
    );
    let agent = service(&database.connection);
    let factory = RecordingFactory {
        resume_thread_ids: std::sync::Mutex::new(Vec::new()),
        sends: Arc::new(AtomicUsize::new(0)),
    };
    let error = agent
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
                codex_home: None,
                user_home: None,
            },
        )
        .expect_err("deepseek cannot switch");
    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(
        AgentSessionRepository::new(&database.connection)
            .find_by_id(session_id)
            .expect("find")
            .expect("session")
            .display_mode,
        "json"
    );
    assert!(factory.resume_thread_ids.lock().expect("lock").is_empty());

    database
        .connection
        .execute("UPDATE issues SET status = 'completed' WHERE id = 11", [])
        .expect("complete");
    database
        .connection
        .execute(
            "UPDATE agent_profiles SET agent_type = 'codex' WHERE id = 101",
            [],
        )
        .expect("codex");
    let error = agent
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
                codex_home: None,
                user_home: None,
            },
        )
        .expect_err("completed issue");
    assert_eq!(error.code, CommandErrorCode::AgentSessionValidationFailed);
    assert_eq!(
        AgentSessionRepository::new(&database.connection)
            .find_by_id(session_id)
            .expect("find")
            .expect("session")
            .display_mode,
        "json"
    );
}
