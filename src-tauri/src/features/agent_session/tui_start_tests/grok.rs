//! Grok TUI 启动的集成测试（从 `issue.rs` 拆出，控制单文件行数）。

use super::*;
use crate::types::agent_session::ResumeAgentSessionInput;
use chrono::{SecondsFormat, Utc};

/// 模拟 grok 写入本机会话存储：
/// `<home>/.grok/sessions/<百分号编码 cwd>/<session-id>/summary.json`。
fn write_grok_session_store(home_dir: &Path, cwd: &Path, provider_session_id: &str) {
    let encoded = percent_encode_cwd(&cwd.to_string_lossy());
    let session_dir = home_dir
        .join(".grok")
        .join("sessions")
        .join(encoded)
        .join(provider_session_id);
    fs::create_dir_all(&session_dir).expect("create grok session dir");
    let created_at = Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true);
    fs::write(
        session_dir.join("summary.json"),
        serde_json::json!({
            "info": {"id": provider_session_id, "cwd": cwd.to_string_lossy()},
            "created_at": created_at,
        })
        .to_string(),
    )
    .expect("write grok summary");
}

/// Grok 会话目录名：绝对 cwd 的百分号编码（非字母数字按 UTF-8 字节编码）。
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

fn wait_for_provider_session_id(
    repository: &AgentSessionRepository<'_>,
    session_id: i64,
) -> Option<String> {
    for _ in 0..100 {
        let captured = repository
            .find_by_id(session_id)
            .expect("find session")
            .and_then(|record| record.provider_session_id)
            .filter(|value| !value.trim().is_empty());
        if captured.is_some() {
            return captured;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    None
}

#[test]
fn restart_reopens_grok_tui_session_with_captured_provider_session_id() {
    let temp_dir = tempdir().expect("temp");
    let home_dir = temp_dir.path().to_path_buf();
    // 生产形态：data_dir = <home>/.redwhisk，provider 本机会话存储 = <home>/.grok/sessions。
    let data_dir = home_dir.join(".redwhisk");
    fs::create_dir_all(&data_dir).expect("create data dir");
    let repo_dir = home_dir.join("repo");
    create_git_repo(&repo_dir);
    let script = home_dir.join("fake-grok.sh");
    write_sleep_script(&script);

    let provider_session_id = "01a14e62-5f07-7f80-8262-1d6d588f76af";
    write_grok_session_store(&home_dir, &repo_dir, provider_session_id);

    let database = open_db(&data_dir);
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

    let started = service
        .start_agent_session_with_runtime(
            &data_dir,
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
    let session_id = started.session_id;

    let repository = AgentSessionRepository::new(&database.connection);
    let captured = wait_for_provider_session_id(&repository, session_id);
    assert_eq!(
        captured.as_deref(),
        Some(provider_session_id),
        "grok TUI 启动后必须捕获 provider session id，否则重启后无法续接"
    );

    // 模拟应用重启：PTY 随进程消失，会话被记为 stopped。
    let _ = pty.kill(session_id);
    database
        .connection
        .execute(
            "UPDATE agent_sessions SET status = 'stopped' WHERE id = ?1",
            params![session_id],
        )
        .expect("mark stopped");

    // 重新打开这条 TUI 会话：必须能续接，而不是停在 saved output。
    let resumed = service
        .resume_agent_session(
            &data_dir,
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
        .expect("grok tui session must resume after restart");

    assert_eq!(resumed.session_id, session_id);
    assert_eq!(resumed.thread_id, provider_session_id);
    assert!(pty.contains(session_id), "must register PTY");

    let _ = pty.kill(session_id);
}

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
