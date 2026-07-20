use super::*;

#[test]
fn start_structured_tui_spawns_pty_persists_snapshot_and_lists_display_mode() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let script = temp_dir.path().join("fake-tui.sh");
    write_sleep_script(&script);

    let database = open_db(temp_dir.path());
    seed_project_issue_profile(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        "tui",
    );

    let service = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();

    let result = AgentSessionService::start_structured_agent_session_in_data_dir(
        temp_dir.path(),
        StartStructuredAgentSessionInput {
            project_id: 1,
            title: Some("临时会话".to_string()),
            agent_type: None,
            agent_profile_id: Some(101),
            mode: None,
            model: None,
            effort: None,
            resume_from_codex_session_id: None,
        },
        &registry,
        &broadcaster,
        &pty,
    )
    .expect("start temporary tui session");

    assert!(result.session_id > 0);
    assert_eq!(result.thread_id, "");
    assert!(
        pty.contains(result.session_id),
        "temporary tui path must register PTY"
    );

    let record = AgentSessionRepository::new(&database.connection)
        .find_by_id(result.session_id)
        .expect("find")
        .expect("session");
    assert_eq!(record.display_mode, "tui");
    assert_eq!(record.status, AgentSessionStatus::Running);
    assert!(record.issue_id.is_none());
    assert!(
        !record.command_snapshot.contains("app-server"),
        "tui command must not inject app-server: {}",
        record.command_snapshot
    );

    let list = service.list_agent_sessions(1).expect("list");
    let item = list
        .sessions
        .iter()
        .find(|session| session.session_id == result.session_id)
        .expect("listed");
    assert_eq!(item.display_mode, "tui");

    AgentSessionService::write_agent_session_terminal(
        WriteAgentSessionTerminalInput {
            project_id: 1,
            session_id: result.session_id,
            data: "x".to_string(),
        },
        &pty,
    )
    .expect("write");

    let _ = pty.kill(result.session_id);
}

#[test]
fn start_structured_json_does_not_register_pty() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);

    let database = open_db(temp_dir.path());
    seed_project_issue_profile(
        &database.connection,
        &repo_dir.to_string_lossy(),
        "codex",
        "json",
    );

    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();

    let result = AgentSessionService::start_structured_agent_session_in_data_dir(
        temp_dir.path(),
        StartStructuredAgentSessionInput {
            project_id: 1,
            title: Some("临时 json".to_string()),
            agent_type: None,
            agent_profile_id: Some(101),
            mode: None,
            model: None,
            effort: None,
            resume_from_codex_session_id: None,
        },
        &registry,
        &broadcaster,
        &pty,
    );

    let _ = result;
    assert!(
        !pty.contains(1) && !pty.contains(2),
        "temporary json path must not register PTY sessions"
    );
}
