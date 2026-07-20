    use super::*;
    use std::fs;

    fn codex_data_dir(temp: &tempfile::TempDir) -> std::path::PathBuf {
        // 约定：data_dir 的 parent 即 home；temp.path() 当 home，data_dir = home/data。
        temp.path().join("data")
    }

    fn write_codex_config(home: &Path, model: Option<&str>, effort: Option<&str>) {
        let codex_dir = home.join(".codex");
        fs::create_dir_all(&codex_dir).expect("codex dir");
        let mut content = String::new();
        if let Some(model) = model {
            content.push_str(&format!("model = \"{model}\"\n"));
        }
        if let Some(effort) = effort {
            content.push_str(&format!("model_reasoning_effort = \"{effort}\"\n"));
        }
        fs::write(codex_dir.join("config.toml"), content).expect("write config");
    }

    #[test]
    fn descriptor_for_returns_matching_descriptor() {
        assert_eq!(descriptor_for(&AgentType::Codex).agent_type(), AgentType::Codex);
        assert_eq!(
            descriptor_for(&AgentType::Claude).agent_type(),
            AgentType::Claude
        );
    }

    #[test]
    fn codex_resolve_runtime_config_reads_from_data_dir_parent() {
        let temp = tempfile::tempdir().expect("temp");
        write_codex_config(temp.path(), Some("gpt-5"), Some("high"));
        let data_dir = codex_data_dir(&temp);

        let config = CodexDescriptor.resolve_runtime_config(&data_dir, None, None);
        assert_eq!(config.model.as_deref(), Some("gpt-5"));
        assert_eq!(config.effort.as_deref(), Some("high"));
    }

    #[test]
    fn codex_resolve_runtime_config_prefers_requested_over_config() {
        let temp = tempfile::tempdir().expect("temp");
        write_codex_config(temp.path(), Some("gpt-5"), Some("high"));
        let data_dir = codex_data_dir(&temp);

        let config = CodexDescriptor.resolve_runtime_config(&data_dir, Some("gpt-5.5"), Some("xhigh"));
        assert_eq!(config.model.as_deref(), Some("gpt-5.5"));
        assert_eq!(config.effort.as_deref(), Some("xhigh"));
    }

    #[test]
    fn claude_resolve_runtime_config_ignores_effort_and_data_dir() {
        let temp = tempfile::tempdir().expect("temp");
        let data_dir = codex_data_dir(&temp);

        let config = ClaudeDescriptor.resolve_runtime_config(&data_dir, Some("sonnet"), Some("high"));
        assert_eq!(config.model.as_deref(), Some("sonnet"));
        assert!(config.effort.is_none());
    }

    #[test]
    fn claude_resolve_runtime_config_returns_none_when_no_request() {
        let temp = tempfile::tempdir().expect("temp");
        let data_dir = codex_data_dir(&temp);

        let config = ClaudeDescriptor.resolve_runtime_config(&data_dir, None, None);
        assert!(config.model.is_none());
        assert!(config.effort.is_none());
    }

    #[test]
    fn codex_build_command_snapshot_with_bypass_appends_flag() {
        assert_eq!(
            CodexDescriptor.build_command_snapshot_with_bypass("codex"),
            "codex --dangerously-bypass-approvals-and-sandbox"
        );
    }

    #[test]
    fn codex_build_command_snapshot_with_bypass_keeps_existing_flag() {
        assert_eq!(
            CodexDescriptor
                .build_command_snapshot_with_bypass("codex --dangerously-bypass-approvals-and-sandbox"),
            "codex --dangerously-bypass-approvals-and-sandbox"
        );
    }

    #[test]
    fn claude_build_command_snapshot_with_bypass_appends_permission_mode() {
        assert_eq!(
            ClaudeDescriptor.build_command_snapshot_with_bypass("claude"),
            "claude --permission-mode bypassPermissions"
        );
    }

    #[test]
    fn claude_build_command_snapshot_with_bypass_keeps_existing_permission_mode() {
        assert_eq!(
            ClaudeDescriptor.build_command_snapshot_with_bypass("claude --permission-mode auto"),
            "claude --permission-mode auto"
        );
    }

    #[test]
    fn codex_build_launch_command_snapshot_trims_only() {
        assert_eq!(
            CodexDescriptor.build_launch_command_snapshot(" codex-asxs "),
            "codex-asxs"
        );
    }

    #[test]
    fn claude_build_launch_command_snapshot_appends_bypass() {
        assert_eq!(
            ClaudeDescriptor.build_launch_command_snapshot("claude"),
            "claude --permission-mode bypassPermissions"
        );
    }

    #[test]
    fn fallback_command_when_snapshot_empty_returns_default_with_bypass() {
        assert_eq!(
            CodexDescriptor.fallback_command_when_snapshot_empty(),
            "codex --dangerously-bypass-approvals-and-sandbox"
        );
        assert_eq!(
            ClaudeDescriptor.fallback_command_when_snapshot_empty(),
            "claude --permission-mode bypassPermissions"
        );
    }

    #[test]
    fn codex_list_models_marks_selected_from_config() {
        let temp = tempfile::tempdir().expect("temp");
        write_codex_config(temp.path(), Some("gpt-5"), None);

        let models = CodexDescriptor.list_models(temp.path());
        let default = models
            .iter()
            .find(|m| m.is_default == Some(true))
            .expect("有一个默认模型");
        assert_eq!(default.model_id, "gpt-5");
    }

    #[test]
    fn codex_is_model_list_read_only_is_always_false() {
        let temp = tempfile::tempdir().expect("temp");
        assert!(!CodexDescriptor.is_model_list_read_only(temp.path()));
    }

    #[test]
    fn claude_list_models_empty_when_no_settings() {
        let temp = tempfile::tempdir().expect("temp");
        assert!(ClaudeDescriptor.list_models(temp.path()).is_empty());
    }

    #[test]
    fn claude_list_models_official_marks_current_default() {
        let temp = tempfile::tempdir().expect("temp");
        let claude_dir = temp.path().join(".claude");
        fs::create_dir_all(&claude_dir).expect("claude dir");
        fs::write(
            claude_dir.join("settings.json"),
            r#"{"model": "sonnet", "env": {}}"#,
        )
        .expect("write settings");

        let models = ClaudeDescriptor.list_models(temp.path());
        let ids: Vec<&str> = models.iter().map(|m| m.model_id.as_str()).collect();
        assert_eq!(ids, vec!["opus", "sonnet", "haiku"]);
        let default = models
            .iter()
            .find(|m| m.is_default == Some(true))
            .expect("sonnet 默认");
        assert_eq!(default.model_id, "sonnet");
    }

    #[test]
    fn claude_is_model_list_read_only_detects_third_party() {
        let temp = tempfile::tempdir().expect("temp");
        let claude_dir = temp.path().join(".claude");
        fs::create_dir_all(&claude_dir).expect("claude dir");
        fs::write(
            claude_dir.join("settings.json"),
            r#"{"model": "sonnet[1m]", "env": {"ANTHROPIC_BASE_URL": "http://x:9009"}}"#,
        )
        .expect("write settings");

        assert!(ClaudeDescriptor.is_model_list_read_only(temp.path()));
    }

    #[test]
    fn claude_is_model_list_read_only_false_for_official() {
        let temp = tempfile::tempdir().expect("temp");
        let claude_dir = temp.path().join(".claude");
        fs::create_dir_all(&claude_dir).expect("claude dir");
        fs::write(
            claude_dir.join("settings.json"),
            r#"{"model": "opus", "env": {}}"#,
        )
        .expect("write settings");

        assert!(!ClaudeDescriptor.is_model_list_read_only(temp.path()));
    }
