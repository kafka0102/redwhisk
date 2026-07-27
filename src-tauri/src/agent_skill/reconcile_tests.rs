    use super::*;
    use crate::types::agent_profile::AgentType;
    use crate::types::agent_skill::{AgentSkillRecord, AgentSkillScope};

    #[test]
    fn normalize_skill_paths_orders_by_agent_then_path() {
        let paths = vec![
            path(AgentType::Grok, "/z"),
            path(AgentType::Codex, "/b"),
            path(AgentType::Codex, "/a"),
            path(AgentType::Claude, "/c"),
            path(AgentType::OpenCode, "/d"),
        ];

        assert_eq!(
            normalize_skill_paths(&paths),
            vec![
                path(AgentType::Codex, "/a"),
                path(AgentType::Codex, "/b"),
                path(AgentType::Claude, "/c"),
                path(AgentType::OpenCode, "/d"),
                path(AgentType::Grok, "/z"),
            ]
        );
    }

    #[test]
    fn skill_paths_from_scanned_collects_all_matching_names_case_insensitive() {
        let scanned = vec![
            scanned("Demo", AgentType::Codex, "/codex/demo"),
            scanned("other", AgentType::Claude, "/other"),
            scanned("demo", AgentType::OpenCode, "/opencode/demo"),
            scanned("DEMO", AgentType::Grok, "/grok/demo"),
        ];

        assert_eq!(
            skill_paths_from_scanned(&scanned, "demo"),
            vec![
                path(AgentType::Codex, "/codex/demo"),
                path(AgentType::OpenCode, "/opencode/demo"),
                path(AgentType::Grok, "/grok/demo"),
            ]
        );
    }

    #[test]
    fn skill_paths_from_scanned_returns_empty_when_name_missing() {
        let scanned = vec![scanned("kept", AgentType::Codex, "/kept")];
        assert!(skill_paths_from_scanned(&scanned, "missing").is_empty());
    }

    #[test]
    fn plan_updates_when_paths_added_removed_or_changed() {
        let saved = vec![
            row(
                1,
                "alpha",
                vec![path(AgentType::Codex, "/old-alpha")],
            ),
            row(
                2,
                "beta",
                vec![
                    path(AgentType::Claude, "/beta-claude"),
                    path(AgentType::Codex, "/beta-codex"),
                ],
            ),
            row(3, "gone", vec![path(AgentType::Grok, "/gone")]),
            row(
                4,
                "same",
                vec![
                    path(AgentType::OpenCode, "/same-b"),
                    path(AgentType::Codex, "/same-a"),
                ],
            ),
        ];
        let scanned = vec![
            scanned("alpha", AgentType::Codex, "/new-alpha"),
            scanned("alpha", AgentType::Claude, "/alpha-claude"),
            scanned("beta", AgentType::Codex, "/beta-codex"),
            // beta loses Claude; same keeps both paths but different order in saved
            scanned("same", AgentType::Codex, "/same-a"),
            scanned("same", AgentType::OpenCode, "/same-b"),
        ];

        let updates = plan_saved_skill_path_updates(&saved, &scanned);

        assert_eq!(updates.len(), 3);
        assert_eq!(
            updates
                .iter()
                .map(|(id, _)| *id)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(
            updates[0].1,
            vec![
                path(AgentType::Codex, "/new-alpha"),
                path(AgentType::Claude, "/alpha-claude"),
            ]
        );
        assert_eq!(updates[1].1, vec![path(AgentType::Codex, "/beta-codex")]);
        assert!(updates[2].1.is_empty());
    }

    #[test]
    fn plan_keeps_row_with_empty_paths_when_scan_has_no_match() {
        let saved = vec![row(9, "orphan", vec![path(AgentType::Codex, "/x")])];
        let updates = plan_saved_skill_path_updates(&saved, &[]);
        assert_eq!(updates, vec![(9, Vec::new())]);
    }

    #[test]
    fn plan_counts_zero_when_only_order_differs() {
        let saved = vec![row(
            1,
            "same",
            vec![
                path(AgentType::Grok, "/g"),
                path(AgentType::Codex, "/c"),
            ],
        )];
        let scanned = vec![
            scanned("same", AgentType::Codex, "/c"),
            scanned("same", AgentType::Grok, "/g"),
        ];
        assert!(plan_saved_skill_path_updates(&saved, &scanned).is_empty());
    }

    #[test]
    fn reconcile_writes_empty_paths_and_returns_changed_count() {
        let temp = tempfile::tempdir().expect("temp");
        let database = DatabaseConfig::new(temp.path()).open().expect("db");
        MigrationRunner::default()
            .run(&database.connection)
            .expect("migrate");
        let repository = SavedAgentSkillRepository::new(&database.connection);
        let kept = repository
            .save_skill(
                None,
                "kept",
                &AgentSkillScope::Global,
                None,
                &[path(AgentType::Codex, "/old")],
            )
            .expect("save kept");
        let missing = repository
            .save_skill(
                None,
                "missing",
                &AgentSkillScope::Global,
                None,
                &[path(AgentType::Claude, "/gone")],
            )
            .expect("save missing");
        drop(repository);
        drop(database);

        let scanned = vec![
            scanned("kept", AgentType::Codex, "/new"),
            scanned("kept", AgentType::OpenCode, "/opencode"),
        ];
        let changed = reconcile_saved_skills_in_data_dir(
            temp.path(),
            &scanned,
            &AgentSkillScope::Global,
            None,
        )
        .expect("reconcile");

        assert_eq!(changed, 2);

        let database = DatabaseConfig::new(temp.path()).open().expect("db");
        let repository = SavedAgentSkillRepository::new(&database.connection);
        let kept_row = repository.find_skill_by_id(kept.id).expect("read").unwrap();
        let missing_row = repository
            .find_skill_by_id(missing.id)
            .expect("read")
            .unwrap();
        assert_eq!(
            kept_row.skill_paths,
            vec![
                path(AgentType::Codex, "/new"),
                path(AgentType::OpenCode, "/opencode"),
            ]
        );
        assert!(missing_row.skill_paths.is_empty());
        assert_eq!(missing_row.del, 0);
    }

    #[test]
    fn scanned_skills_for_reconcile_global_scope_uses_only_global() {
        let global = vec![scanned("demo", AgentType::Codex, "/global/demo")];
        let project = vec![scanned_project(
            "demo",
            AgentType::Codex,
            "/project/demo",
            7,
        )];

        let scanned =
            scanned_skills_for_reconcile(&AgentSkillScope::Global, &global, &project);

        assert_eq!(scanned.len(), 1);
        assert_eq!(scanned[0].path, "/global/demo");
        assert_eq!(scanned[0].scope, AgentSkillScope::Global);
    }

    #[test]
    fn scanned_skills_for_reconcile_project_includes_global_only_skills() {
        let global = vec![
            scanned("shared", AgentType::Codex, "/global/shared"),
            scanned("shared", AgentType::Claude, "/global/shared-claude"),
        ];
        let project = vec![scanned_project(
            "local-only",
            AgentType::Codex,
            "/project/local",
            7,
        )];

        let scanned =
            scanned_skills_for_reconcile(&AgentSkillScope::Project, &global, &project);

        assert_eq!(scanned.len(), 3);
        assert!(scanned.iter().any(|s| s.path == "/global/shared"));
        assert!(scanned.iter().any(|s| s.path == "/global/shared-claude"));
        assert!(scanned.iter().any(|s| s.path == "/project/local"));
    }

    #[test]
    fn scanned_skills_for_reconcile_project_prefers_project_path_on_same_key() {
        let global = vec![
            scanned("review", AgentType::Codex, "/global/review"),
            scanned("review", AgentType::Claude, "/global/review-claude"),
        ];
        let project = vec![scanned_project(
            "review",
            AgentType::Codex,
            "/project/review",
            7,
        )];

        let scanned =
            scanned_skills_for_reconcile(&AgentSkillScope::Project, &global, &project);

        let codex_paths: Vec<&str> = scanned
            .iter()
            .filter(|s| s.name == "review" && s.agent_type == AgentType::Codex)
            .map(|s| s.path.as_str())
            .collect();
        assert_eq!(codex_paths, vec!["/project/review"]);
        assert!(scanned.iter().any(|s| {
            s.name == "review"
                && s.agent_type == AgentType::Claude
                && s.path == "/global/review-claude"
        }));
    }

    #[test]
    fn project_reconcile_plan_writes_global_paths_when_project_scan_missing() {
        let global = vec![scanned("demo", AgentType::Codex, "/global/demo")];
        let project: Vec<AgentSkillRecord> = vec![];
        let scanned =
            scanned_skills_for_reconcile(&AgentSkillScope::Project, &global, &project);
        let saved = vec![row(1, "demo", vec![])];

        let updates = plan_saved_skill_path_updates(&saved, &scanned);

        assert_eq!(
            updates,
            vec![(1, vec![path(AgentType::Codex, "/global/demo")])]
        );
    }

    #[test]
    fn project_reconcile_plan_prefers_project_path_over_global_same_key() {
        let global = vec![scanned("demo", AgentType::Codex, "/global/demo")];
        let project = vec![scanned_project(
            "demo",
            AgentType::Codex,
            "/project/demo",
            7,
        )];
        let scanned =
            scanned_skills_for_reconcile(&AgentSkillScope::Project, &global, &project);
        let saved = vec![row(
            1,
            "demo",
            vec![path(AgentType::Codex, "/stale")],
        )];

        let updates = plan_saved_skill_path_updates(&saved, &scanned);

        assert_eq!(
            updates,
            vec![(1, vec![path(AgentType::Codex, "/project/demo")])]
        );
    }

    #[test]
    fn project_reconcile_plan_clears_paths_when_missing_in_both_scopes() {
        let scanned = scanned_skills_for_reconcile(
            &AgentSkillScope::Project,
            &[],
            &[],
        );
        let saved = vec![row(
            1,
            "orphan",
            vec![path(AgentType::Codex, "/old")],
        )];

        let updates = plan_saved_skill_path_updates(&saved, &scanned);

        assert_eq!(updates, vec![(1, vec![])]);
    }

    fn path(agent_type: AgentType, path: &str) -> SavedAgentSkillPath {
        SavedAgentSkillPath {
            agent_type,
            path: path.to_string(),
        }
    }

    fn scanned(name: &str, agent_type: AgentType, path: &str) -> AgentSkillRecord {
        AgentSkillRecord {
            name: name.to_string(),
            path: path.to_string(),
            agent_type,
            scope: AgentSkillScope::Global,
            project_id: None,
            source_root: "/root".to_string(),
        }
    }

    fn scanned_project(
        name: &str,
        agent_type: AgentType,
        path: &str,
        project_id: i64,
    ) -> AgentSkillRecord {
        AgentSkillRecord {
            name: name.to_string(),
            path: path.to_string(),
            agent_type,
            scope: AgentSkillScope::Project,
            project_id: Some(project_id),
            source_root: "/project-root".to_string(),
        }
    }

    fn row(id: i64, name: &str, skill_paths: Vec<SavedAgentSkillPath>) -> SavedAgentSkillRow {
        SavedAgentSkillRow {
            id,
            name: name.to_string(),
            scope: AgentSkillScope::Global,
            project_id: None,
            skill_paths,
            del: 0,
        }
    }
