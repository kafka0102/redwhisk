use super::*;

#[test]
fn migration_defaults_existing_sessions_to_json_display_mode() {
    let connection = Connection::open_in_memory().expect("open");
    // run all but 0048
    let runner = MigrationRunner::runner_skipping(&["0048_agent_sessions_display_mode"]);
    runner.run(&connection).expect("migrate to 0047");
    connection
        .execute(
            "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
             VALUES (1, 'P', '/tmp/p', 1, 1)",
            [],
        )
        .expect("project");
    connection
        .execute(
            "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
             VALUES (1, 'C', 'codex', 'codex', 'project', 1, 'auto', 0, '', '', 0)",
            [],
        )
        .expect("profile");
    connection
        .execute(
            "INSERT INTO agent_sessions (
               id, project_id, number, agent_profile_id, status, attention,
               working_dir, command_snapshot, prompt_snapshot, log_path,
               last_active_at, started_at, del
             ) VALUES (
               1, 1, 1, 1, 'closed', 'none',
               '/tmp', 'codex', '', '/tmp/a.log',
               1, 1, 0
             )",
            [],
        )
        .expect("session without display_mode");

    MigrationRunner::default()
        .run(&connection)
        .expect("apply 0048");

    let mode: String = connection
        .query_row(
            "SELECT display_mode FROM agent_sessions WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .expect("read mode");
    assert_eq!(mode, "json");
}

#[test]
fn insert_and_list_round_trip_display_mode_tui() {
    let mut connection = Connection::open_in_memory().expect("open");
    MigrationRunner::default()
        .run(&connection)
        .expect("migrate");
    connection
        .execute(
            "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
             VALUES (1, 'P', '/tmp/p', 1, 1)",
            [],
        )
        .expect("project");
    connection
        .execute(
            "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
             VALUES (100, 'C', 'codex', 'codex', 'project', 1, 'auto', 0, '', '', 0)",
            [],
        )
        .expect("profile");
    let issue_id = IssueRepository::new(&connection)
        .insert(1, "t", "", "[]")
        .expect("issue")
        .id;

    let session = connection
        .transaction()
        .and_then(|tx| {
            let session = AgentSessionRepository::insert_in_transaction(
                &tx,
                1,
                issue_id,
                100,
                None,
                "/tmp/repo",
                "codex --dangerously-bypass-approvals-and-sandbox",
                "do work",
                &WorkspaceMode::CurrentBranch,
                None,
                None,
                None,
                None,
                crate::types::agent_session::WorktreeOwner::External,
                None,
                None,
                "/tmp/s.log",
                "tui",
                1000,
            )?;
            tx.commit()?;
            Ok(session)
        })
        .expect("insert");

    assert_eq!(session.display_mode, "tui");
    let listed = AgentSessionRepository::new(&connection)
        .list_by_project_id(1)
        .expect("list");
    assert_eq!(listed[0].display_mode, "tui");
}

#[test]
fn start_runtime_tui_spawns_pty_persists_snapshot_and_lists_display_mode() {
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

    let result = service
        .start_agent_session_with_runtime(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id: 1,
                issue_id: 11,
                agent_profile_id: 101,
                prompt_snapshot: "hello from issue".to_string(),
                workflow_skill_name: None,
                workspace_mode: Some(WorkspaceMode::CurrentBranch),
                target_branch: None,
                worktree_setup_command: None,
            },
            &pty,
            &registry,
            &broadcaster,
        )
        .expect("start tui session");

    assert!(result.session_id > 0);
    assert!(pty.contains(result.session_id), "tui path must register PTY");

    let record = AgentSessionRepository::new(&database.connection)
        .find_by_id(result.session_id)
        .expect("find")
        .expect("session");
    assert_eq!(record.display_mode, "tui");
    assert_eq!(record.status, AgentSessionStatus::Running);
    assert!(
        !record.command_snapshot.contains("app-server"),
        "tui command must not inject app-server: {}",
        record.command_snapshot
    );

    let list = service.list_agent_sessions(1).expect("list");
    let item = list
        .sessions
        .iter()
        .find(|s| s.session_id == result.session_id)
        .expect("listed");
    assert_eq!(item.display_mode, "tui");

    // terminal write should succeed while PTY alive
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
fn start_runtime_json_does_not_register_pty() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);

    let database = open_db(temp_dir.path());
    // json profile with non-runnable command; structured start will fail after DB path,
    // but we only assert branching doesn't touch PTY when prepare succeeds and structured
    // attempts start. Use a profile that fails structured factory fast.
    seed_project_issue_profile(
        &database.connection,
        &repo_dir.to_string_lossy(),
        "codex",
        "json",
    );

    let service = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();

    let result = service.start_agent_session_with_runtime(
        temp_dir.path(),
        StartAgentSessionInput {
            project_id: 1,
            issue_id: 11,
            agent_profile_id: 101,
            prompt_snapshot: "hello".to_string(),
            workflow_skill_name: None,
            workspace_mode: Some(WorkspaceMode::CurrentBranch),
            target_branch: None,
            worktree_setup_command: None,
        },
        &pty,
        &registry,
        &broadcaster,
    );

    // structured path may fail without real codex; regardless PTY must stay empty
    let _ = result;
    assert!(
        !pty.contains(1) && !pty.contains(2),
        "json path must not register PTY sessions"
    );
}

#[test]
fn reconcile_marks_tui_running_without_pty_stopped() {
    let connection = Connection::open_in_memory().expect("open");
    MigrationRunner::default()
        .run(&connection)
        .expect("migrate");
    connection
        .execute(
            "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
             VALUES (1, 'P', '/tmp/p', 1, 1)",
            [],
        )
        .expect("project");
    connection
        .execute(
            "INSERT INTO agent_profiles (id, name, agent_type, command, scope, project_id, mode, dangerous, default_skill, prompt_template, del)
             VALUES (101, 'C', 'codex', 'codex', 'project', 1, 'auto', 0, '', '', 0)",
            [],
        )
        .expect("profile");
    connection
        .execute(
            "INSERT INTO agent_sessions (
               id, project_id, number, agent_profile_id, status, attention,
               working_dir, command_snapshot, prompt_snapshot, log_path,
               last_active_at, started_at, display_mode, del
             ) VALUES (
               40, 1, 1, 101, 'running', 'none',
               '/tmp', 'sleep', '', '/tmp/tui.log',
               1, 1, 'tui', 0
             )",
            [],
        )
        .expect("session");

    let service = service(&connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    service
        .reconcile_unrecoverable_running_sessions(1, &pty, &registry)
        .expect("reconcile");

    let status: String = connection
        .query_row(
            "SELECT status FROM agent_sessions WHERE id = 40",
            [],
            |row| row.get(0),
        )
        .expect("status");
    assert_eq!(status, "stopped");
}





#[test]
fn start_tui_with_stdin_prompt_returns_after_register() {
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

    let result = service
        .start_agent_session_with_runtime(
            temp_dir.path(),
            StartAgentSessionInput {
                project_id: 1,
                issue_id: 11,
                agent_profile_id: 101,
                // 非 codex 可执行名 → stdin 注入；覆盖 claude TUI 首条 prompt 路径。
                prompt_snapshot: "hello from issue via stdin".to_string(),
                workflow_skill_name: None,
                workspace_mode: Some(WorkspaceMode::CurrentBranch),
                target_branch: None,
                worktree_setup_command: None,
            },
            &pty,
            &registry,
            &broadcaster,
        )
        .expect("start tui session with stdin prompt");

    assert!(result.session_id > 0);
    assert!(
        pty.contains(result.session_id),
        "PTY must be registered before start returns"
    );
    let _ = pty.kill(result.session_id);
}
