    use std::fs;
    use std::path::Path;

    use crate::types::agent_profile::AgentType;
    use crate::types::agent_skill::AgentSkillScope;

    use super::{
        find_project_skill_roots, scan_global_skills, scan_project_skills, scan_skill_root,
    };

    #[test]
    fn agent_skill_scanner_reads_frontmatter_name_and_falls_back_to_directory_name() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path().join("skills");
        write_skill(
            &root.join("frontmatter"),
            "---\nname: 'Review Skill'\ndescription: test\n---\nBody",
        );
        write_skill(&root.join("fallback-name"), "No frontmatter");

        let skills = scan_skill_root(&root, &[AgentType::Codex], AgentSkillScope::Global, None);

        assert_eq!(skills.len(), 2);
        assert!(skills.iter().any(|skill| skill.name == "Review Skill"));
        assert!(skills.iter().any(|skill| skill.name == "fallback-name"));
        assert!(skills
            .iter()
            .any(|skill| skill.path == canonical(&root.join("frontmatter").join("SKILL.md"))));
        assert!(skills
            .iter()
            .any(|skill| skill.path == canonical(&root.join("fallback-name").join("SKILL.md"))));
        assert!(skills
            .iter()
            .all(|skill| skill.source_root == canonical(&root)));
    }

    #[test]
    fn agent_skill_scanner_finds_nested_project_roots_and_skips_ignored_directories() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let project = temp_dir.path();
        write_skill(&project.join(".agents/skills/root-codex"), "Root Codex");
        write_skill(
            &project.join("packages/app/.agents/skills/nested-codex"),
            "Nested Codex",
        );
        write_skill(
            &project.join("node_modules/pkg/.agents/skills/ignored-codex"),
            "Ignored Codex",
        );

        let roots = find_project_skill_roots(project, ".agents/skills");
        let skills = scan_project_skills(7, project);

        assert!(roots.contains(&project.join(".agents/skills").canonicalize().unwrap()));
        assert!(roots.contains(
            &project
                .join("packages/app/.agents/skills")
                .canonicalize()
                .unwrap()
        ));
        assert!(!roots
            .iter()
            .any(|root| root.to_string_lossy().contains("node_modules")));
        assert!(skills.iter().any(|skill| skill.name == "root-codex"));
        assert!(skills.iter().any(|skill| skill.name == "nested-codex"));
        assert!(!skills.iter().any(|skill| skill.name == "ignored-codex"));
        assert!(skills.iter().all(|skill| {
            skill.scope == AgentSkillScope::Project && skill.project_id == Some(7)
        }));
        assert_agent_types_for_name(
            &skills,
            "root-codex",
            &[AgentType::Codex, AgentType::OpenCode, AgentType::Grok],
        );
    }

    #[cfg(unix)]
    #[test]
    fn agent_skill_scanner_does_not_follow_project_symlink_directories() {
        use std::os::unix::fs::symlink;

        let temp_dir = tempfile::tempdir().expect("temp dir");
        let project = temp_dir.path().join("project");
        let external = temp_dir.path().join("external");
        fs::create_dir_all(&project).expect("project dir");
        write_skill(&project.join(".agents/skills/local-codex"), "Local Codex");
        write_skill(
            &external.join(".agents/skills/external-codex"),
            "External Codex",
        );
        symlink(&external, project.join("linked-external")).expect("external symlink");

        let roots = find_project_skill_roots(&project, ".agents/skills");
        let skills = scan_project_skills(7, &project);

        assert!(roots.contains(&project.join(".agents/skills").canonicalize().unwrap()));
        assert!(!roots
            .iter()
            .any(|root| root.to_string_lossy().contains("external")));
        assert!(skills.iter().any(|skill| skill.name == "local-codex"));
        assert!(!skills.iter().any(|skill| skill.name == "external-codex"));
    }

    #[test]
    fn agent_skill_scanner_scans_codex_and_claude_global_roots() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let home = temp_dir.path();
        write_skill(&home.join(".agents/skills/codex-global"), "Codex Global");
        write_skill(&home.join(".claude/skills/claude-global"), "Claude Global");

        let skills = scan_global_skills(Some(home));

        assert_agent_types_for_name(
            &skills,
            "codex-global",
            &[AgentType::Codex, AgentType::OpenCode, AgentType::Grok],
        );
        assert_agent_types_for_name(
            &skills,
            "claude-global",
            &[AgentType::Claude, AgentType::OpenCode, AgentType::Grok],
        );
        assert!(skills.iter().all(|skill| skill.scope == AgentSkillScope::Global));
    }

    #[cfg(unix)]
    #[test]
    fn agent_skill_scanner_follows_symlinked_global_skill_per_root() {
        use std::os::unix::fs::symlink;

        let temp_dir = tempfile::tempdir().expect("temp dir");
        let home = temp_dir.path();
        // 真实 skill 位于 .agents/skills（Codex root）
        write_skill(&home.join(".agents/skills/implement"), "Implement");
        // .claude/skills/implement 以软链指向同一个 skill，应按所在 root 识别为 Claude
        fs::create_dir_all(home.join(".claude/skills")).expect("claude skills root");
        symlink(
            home.join(".agents/skills/implement"),
            home.join(".claude/skills/implement"),
        )
        .expect("symlink skill");

        let skills = scan_global_skills(Some(home));

        assert!(skills
            .iter()
            .any(|skill| skill.name == "implement" && skill.agent_type == AgentType::Claude));
        assert!(skills
            .iter()
            .any(|skill| skill.name == "implement" && skill.agent_type == AgentType::Codex));
        assert!(skills
            .iter()
            .any(|skill| skill.name == "implement" && skill.agent_type == AgentType::OpenCode));
        assert!(skills
            .iter()
            .any(|skill| skill.name == "implement" && skill.agent_type == AgentType::Grok));
    }

    #[test]
    fn agent_skill_scanner_expands_shared_global_roots_to_multiple_agents() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let home = temp_dir.path();
        write_skill(&home.join(".agents/skills/shared-agents"), "Shared Agents");
        write_skill(&home.join(".claude/skills/shared-claude"), "Shared Claude");

        let skills = scan_global_skills(Some(home));
        let agents_path = canonical(&home.join(".agents/skills/shared-agents/SKILL.md"));
        let claude_path = canonical(&home.join(".claude/skills/shared-claude/SKILL.md"));

        for agent_type in [AgentType::Codex, AgentType::OpenCode, AgentType::Grok] {
            assert!(
                skills.iter().any(|skill| {
                    skill.name == "shared-agents"
                        && skill.agent_type == agent_type
                        && skill.path == agents_path
                        && skill.scope == AgentSkillScope::Global
                }),
                "expected .agents skill for {agent_type:?}"
            );
        }
        for agent_type in [AgentType::Claude, AgentType::OpenCode, AgentType::Grok] {
            assert!(
                skills.iter().any(|skill| {
                    skill.name == "shared-claude"
                        && skill.agent_type == agent_type
                        && skill.path == claude_path
                        && skill.scope == AgentSkillScope::Global
                }),
                "expected .claude skill for {agent_type:?}"
            );
        }
        assert!(!skills.iter().any(|skill| {
            skill.name == "shared-agents" && skill.agent_type == AgentType::Claude
        }));
        assert!(!skills.iter().any(|skill| {
            skill.name == "shared-claude" && skill.agent_type == AgentType::Codex
        }));
    }

    #[test]
    fn agent_skill_scanner_keeps_exclusive_global_roots_single_agent() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let home = temp_dir.path();
        write_skill(&home.join(".codex/skills/codex-only"), "Codex Only");
        write_skill(
            &home.join(".config/opencode/skills/opencode-only"),
            "OpenCode Only",
        );
        write_skill(&home.join(".grok/skills/grok-only"), "Grok Only");

        let skills = scan_global_skills(Some(home));

        assert_agent_types_for_name(&skills, "codex-only", &[AgentType::Codex]);
        assert_agent_types_for_name(&skills, "opencode-only", &[AgentType::OpenCode]);
        assert_agent_types_for_name(&skills, "grok-only", &[AgentType::Grok]);
    }

    #[test]
    fn agent_skill_scanner_expands_shared_and_exclusive_project_roots() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let project = temp_dir.path();
        write_skill(&project.join(".agents/skills/proj-agents"), "Proj Agents");
        write_skill(&project.join(".claude/skills/proj-claude"), "Proj Claude");
        write_skill(&project.join(".codex/skills/proj-codex"), "Proj Codex");
        write_skill(&project.join(".opencode/skills/proj-opencode"), "Proj OpenCode");
        write_skill(&project.join(".grok/skills/proj-grok"), "Proj Grok");

        let skills = scan_project_skills(11, project);

        assert_agent_types_for_name(&skills, "proj-agents", &[
            AgentType::Codex,
            AgentType::OpenCode,
            AgentType::Grok,
        ]);
        assert_agent_types_for_name(&skills, "proj-claude", &[
            AgentType::Claude,
            AgentType::OpenCode,
            AgentType::Grok,
        ]);
        assert_agent_types_for_name(&skills, "proj-codex", &[AgentType::Codex]);
        assert_agent_types_for_name(&skills, "proj-opencode", &[AgentType::OpenCode]);
        assert_agent_types_for_name(&skills, "proj-grok", &[AgentType::Grok]);
        assert!(skills.iter().all(|skill| {
            skill.scope == AgentSkillScope::Project && skill.project_id == Some(11)
        }));
    }

    #[test]
    fn agent_skill_scanner_keeps_same_name_paths_across_roots_for_same_agent() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let home = temp_dir.path();
        write_skill(&home.join(".agents/skills/duplicate"), "Agents copy");
        write_skill(&home.join(".codex/skills/duplicate"), "Codex copy");

        let skills = scan_global_skills(Some(home));
        let codex_paths: Vec<_> = skills
            .iter()
            .filter(|skill| skill.name == "duplicate" && skill.agent_type == AgentType::Codex)
            .map(|skill| skill.path.as_str())
            .collect();

        assert_eq!(codex_paths.len(), 2);
        assert!(codex_paths.contains(
            &canonical(&home.join(".agents/skills/duplicate/SKILL.md")).as_str()
        ));
        assert!(codex_paths.contains(
            &canonical(&home.join(".codex/skills/duplicate/SKILL.md")).as_str()
        ));
    }

    fn assert_agent_types_for_name(
        skills: &[crate::types::agent_skill::AgentSkillRecord],
        name: &str,
        expected: &[AgentType],
    ) {
        let mut actual: Vec<AgentType> = skills
            .iter()
            .filter(|skill| skill.name == name)
            .map(|skill| skill.agent_type.clone())
            .collect();
        actual.sort_by(|left, right| format!("{left:?}").cmp(&format!("{right:?}")));
        let mut expected = expected.to_vec();
        expected.sort_by(|left, right| format!("{left:?}").cmp(&format!("{right:?}")));
        assert_eq!(actual, expected, "agent types for skill {name}");
    }

    fn write_skill(skill_dir: &Path, contents: &str) {
        fs::create_dir_all(skill_dir).expect("skill dir");
        fs::write(skill_dir.join("SKILL.md"), contents).expect("skill file");
    }

    fn canonical(path: &Path) -> String {
        path.canonicalize()
            .expect("canonical path")
            .to_string_lossy()
            .to_string()
    }
