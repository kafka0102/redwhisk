//! Grok TUI 启动的集成测试（从 `issue.rs` 拆出，控制单文件行数）。

use super::*;

/// 播种 grok TUI profile + project + issue（mode/dangerous 参数化，供正/负向用例共用）。
fn seed_grok_tui_profile(
    connection: &Connection,
    repo_path: &str,
    command: &str,
    mode: &str,
    dangerous: i64,
) {
    connection
        .execute(
            "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
             VALUES (1, 'Demo', ?1, 1, 1)",
            params![repo_path],
        )
        .expect("project");
    connection
        .execute(
            "INSERT INTO agent_profiles (
               id, name, agent_type, command, scope, project_id, mode, dangerous,
               default_skill, prompt_template, del, display_mode, enabled
             ) VALUES (
               101, 'Grok', 'grok', ?1, 'project', 1, ?2, ?3,
               '', '', 0, 'tui', 1
             )",
            params![command, mode, dangerous],
        )
        .expect("grok profile");
    connection
        .execute(
            "INSERT INTO issues (
               id, project_id, number, title, description, status, created_at, updated_at, del
             ) VALUES (11, 1, 1, 'Issue One', 'desc', 'backlog', 1, 1, 0)",
            [],
        )
        .expect("issue");
}

#[test]
fn start_runtime_tui_grok_appends_always_approve_and_runs() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let script = temp_dir.path().join("fake-grok.sh");
    write_sleep_script(&script);

    let database = open_db(temp_dir.path());
    // grok profile：displayMode=tui、dangerous=1、mode=full-access → 命令须带 --always-approve。
    seed_grok_tui_profile(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        "full-access",
        1,
    );

    let service = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();

    let result = service
        .start_agent_session_with_runtime(
            temp_dir.path(),
            StartAgentSessionInput {
                model: None,
                project_id: 1,
                issue_id: 11,
                agent_profile_id: 101,
                prompt_snapshot: "hello from grok issue".to_string(),
                workflow_skill_name: None,
                workspace_mode: Some(WorkspaceMode::CurrentBranch),
                target_branch: None,
                worktree_setup_command: None,
            },
            &pty,
            &registry,
            &broadcaster,
        )
        .expect("start grok tui session");

    assert!(result.session_id > 0);
    assert!(
        pty.contains(result.session_id),
        "grok tui must register PTY"
    );

    let record = AgentSessionRepository::new(&database.connection)
        .find_by_id(result.session_id)
        .expect("find")
        .expect("session");
    assert_eq!(record.display_mode, "tui");
    assert_eq!(record.status, AgentSessionStatus::Running);
    assert!(
        record.command_snapshot.ends_with("--always-approve"),
        "grok tui dangerous must append --always-approve: {}",
        record.command_snapshot
    );
    assert!(
        !record.command_snapshot.contains("stream-json")
            && !record.command_snapshot.contains("agent stdio"),
        "grok tui must not inject structured flags: {}",
        record.command_snapshot
    );

    let _ = pty.kill(result.session_id);
}

#[test]
fn start_runtime_tui_grok_safe_does_not_add_always_approve() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let script = temp_dir.path().join("fake-grok-safe.sh");
    write_sleep_script(&script);

    let database = open_db(temp_dir.path());
    // dangerous=0、mode=auto → 安全路径，命令不应带 --always-approve。
    seed_grok_tui_profile(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        "auto",
        0,
    );

    let service = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();

    let result = service
        .start_agent_session_with_runtime(
            temp_dir.path(),
            StartAgentSessionInput {
                model: None,
                project_id: 1,
                issue_id: 11,
                agent_profile_id: 101,
                prompt_snapshot: "hello from grok safe".to_string(),
                workflow_skill_name: None,
                workspace_mode: Some(WorkspaceMode::CurrentBranch),
                target_branch: None,
                worktree_setup_command: None,
            },
            &pty,
            &registry,
            &broadcaster,
        )
        .expect("start grok tui safe session");

    let record = AgentSessionRepository::new(&database.connection)
        .find_by_id(result.session_id)
        .expect("find")
        .expect("session");
    assert_eq!(record.status, AgentSessionStatus::Running);
    assert!(
        !record.command_snapshot.contains("--always-approve"),
        "safe grok tui must not append --always-approve: {}",
        record.command_snapshot
    );

    let _ = pty.kill(result.session_id);
}
