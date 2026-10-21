use super::harness::*;

#[test]
fn switch_from_stopped_json_relaunches_tui_with_same_provider_session_without_changing_profile() {
    let temp_dir = tempdir().expect("temp");
    let repo_dir = temp_dir.path().join("repo");
    create_git_repo(&repo_dir);
    let script = temp_dir.path().join("fake-tui.sh");
    fs::write(
        &script,
        "#!/bin/sh\nprintf '%s\\n' \"$*\" > \"$PWD/argv.txt\"\nsleep 30\n",
    )
    .expect("script");
    let mut perms = fs::metadata(&script).expect("meta").permissions();
    std::os::unix::fs::PermissionsExt::set_mode(&mut perms, 0o755);
    fs::set_permissions(&script, perms).expect("chmod");

    let database = open_db(temp_dir.path());
    let provider_session_id = "thread-switch-2";
    let session_id = seed_switch_session(
        &database.connection,
        &repo_dir.to_string_lossy(),
        &script.to_string_lossy(),
        Some(provider_session_id),
        "stopped",
        "review",
        "codex",
        "json",
        "json",
    );
    let agent = service(&database.connection);
    let pty = PtySessionManager::new();
    let registry = AgentSessionRegistry::new();
    let broadcaster = AgentEventBroadcaster::new();
    let factory = RecordingFactory::default();

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
                codex_home: None,
                user_home: None,
            },
        )
        .expect("switch to tui");

    assert_eq!(result.display_mode, "tui");
    assert_eq!(result.provider_session_id, provider_session_id);
    assert!(pty.contains(session_id));
    assert!(factory.resume_thread_ids.lock().expect("lock").is_empty());
    assert_eq!(factory.sends.load(Ordering::SeqCst), 0);
    // 启动探测只保证进程还活着，脚本写 argv 可能晚于断言。
    let argv_path = repo_dir.join("argv.txt");
    let argv = (0..40)
        .find_map(|_| {
            std::thread::sleep(std::time::Duration::from_millis(25));
            fs::read_to_string(&argv_path).ok()
        })
        .expect("argv");
    assert!(argv.contains("resume"), "{argv}");
    assert!(argv.contains(provider_session_id), "{argv}");
    assert_eq!(profile_display_mode(&database.connection), "json");
    let _ = pty.kill(session_id);
}
