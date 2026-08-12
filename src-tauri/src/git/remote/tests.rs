    use super::*;
    use std::fs;
    use std::process::Command;
    use tempfile::tempdir;

    #[test]
    fn pull_fast_forwards_local_branch_from_remote() {
        let env = setup_clone_with_upstream();
        write_file(&env.other_clone, "remote.txt", "from-remote\n");
        git(&env.other_clone, &["add", "remote.txt"]);
        git(&env.other_clone, &["commit", "-m", "remote change"]);
        git(&env.other_clone, &["push"]);

        pull(&env.local).expect("pull should succeed");

        assert_eq!(
            fs::read_to_string(env.local.join("remote.txt")).expect("read pulled file"),
            "from-remote\n"
        );
    }

    #[test]
    fn push_with_upstream_updates_remote() {
        let env = setup_clone_with_upstream();
        write_file(&env.local, "local.txt", "from-local\n");
        git(&env.local, &["add", "local.txt"]);
        git(&env.local, &["commit", "-m", "local change"]);

        push(&env.local).expect("push with upstream");

        git(&env.other_clone, &["pull"]);
        assert_eq!(
            fs::read_to_string(env.other_clone.join("local.txt")).expect("read pushed file"),
            "from-local\n"
        );
    }

    #[test]
    fn push_without_upstream_sets_origin_head_tracking() {
        let env = setup_clone_with_upstream();
        git(&env.local, &["checkout", "-b", "feature/no-upstream"]);
        // 新分支默认无 upstream。
        assert!(resolve_primary_upstream(&env.local).expect("check upstream").is_none());
        write_file(&env.local, "feature.txt", "feature\n");
        git(&env.local, &["add", "feature.txt"]);
        git(&env.local, &["commit", "-m", "feature"]);

        push(&env.local).expect("push -u origin HEAD");

        assert!(resolve_primary_upstream(&env.local).expect("upstream after push -u").is_some());
        let remote_head = git_output(&env.bare, &["rev-parse", "refs/heads/feature/no-upstream"]);
        let local_head = git_output(&env.local, &["rev-parse", "HEAD"]);
        assert_eq!(remote_head, local_head);
    }

    #[test]
    fn pull_fails_when_remote_is_unreachable() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_repo(&repo_dir);
        write_file(&repo_dir, "base.txt", "base\n");
        git(&repo_dir, &["add", "base.txt"]);
        git(&repo_dir, &["commit", "-m", "initial"]);
        git(
            &repo_dir,
            &[
                "remote",
                "add",
                "origin",
                temp_dir
                    .path()
                    .join("missing-remote.git")
                    .to_string_lossy()
                    .as_ref(),
            ],
        );

        let result = pull(&repo_dir);
        assert!(result.is_err(), "pull without reachable remote must fail");
    }

    #[test]
    fn push_fast_forward_behind_pulls_then_pushes() {
        let env = setup_clone_with_upstream();
        // remote-only commit via other clone
        write_file(&env.other_clone, "remote-only.txt", "remote\n");
        git(&env.other_clone, &["add", "remote-only.txt"]);
        git(&env.other_clone, &["commit", "-m", "remote only"]);
        git(&env.other_clone, &["push"]);

        // local-only commit (behind + ahead would diverge; this is behind only until we don't commit)
        // Actually for pure behind: local has no new commits, only remote does.
        // But then push after pull is a no-op push. Spec wants pull --ff-only then push.
        // Add a local commit AFTER establishing behind would diverge.
        // Pure behind path: local unchanged, remote advanced → push should ff-pull then push.
        push(&env.local).expect("safe push should ff-pull then push");

        assert!(
            env.local.join("remote-only.txt").exists(),
            "local should have fast-forwarded remote commit"
        );
        // no merge/rebase state
        assert_clean_sync_state(&env.local);
    }

    #[test]
    fn push_ahead_only_pushes_without_pull_commit() {
        let env = setup_clone_with_upstream();
        write_file(&env.local, "local-only.txt", "local\n");
        git(&env.local, &["add", "local-only.txt"]);
        git(&env.local, &["commit", "-m", "local only"]);

        push(&env.local).expect("ahead-only push");

        git(&env.other_clone, &["pull"]);
        assert_eq!(
            fs::read_to_string(env.other_clone.join("local-only.txt")).expect("read"),
            "local\n"
        );
        assert_clean_sync_state(&env.local);
    }

    #[test]
    fn push_diverged_fails_without_merge_or_rebase_state() {
        let env = setup_clone_with_upstream();
        // remote commits
        write_file(&env.other_clone, "remote-diverge.txt", "remote\n");
        git(&env.other_clone, &["add", "remote-diverge.txt"]);
        git(&env.other_clone, &["commit", "-m", "remote diverge"]);
        git(&env.other_clone, &["push"]);

        // local commits without pulling (diverged once both exist)
        write_file(&env.local, "local-diverge.txt", "local\n");
        git(&env.local, &["add", "local-diverge.txt"]);
        git(&env.local, &["commit", "-m", "local diverge"]);

        let err = push(&env.local).expect_err("diverged push must fail");
        match err {
            GitCommandError::Failed { message, .. } => {
                assert!(
                    message.contains(PUSH_REQUIRES_MANUAL_SYNC)
                        || message == PUSH_REQUIRES_MANUAL_SYNC,
                    "expected pushRequiresManualSync, got {message}"
                );
            }
            other => panic!("unexpected error: {other:?}"),
        }
        assert_clean_sync_state(&env.local);
        // remote must not have local diverge commit
        let remote_log = git_output(&env.bare, &["log", "--oneline", "--all"]);
        assert!(
            !remote_log.contains("local diverge"),
            "remote should not receive diverged local commit: {remote_log}"
        );
        assert!(
            !env.local.join("remote-diverge.txt").exists(),
            "local should not have pulled remote diverge via merge"
        );
    }

    #[test]
    fn pull_with_pull_rebase_and_multiple_merge_refs_succeeds_on_primary_upstream() {
        // 回归：裸 `git pull` + pull.rebase=true + 多 branch.*.merge
        // （第二 merge 在远端也存在）会 fatal: Cannot rebase onto multiple branches。
        let env = setup_clone_with_upstream();
        git(&env.local, &["config", "pull.rebase", "true"]);
        // 远端存在 develop，使第二 merge ref 成为可拉取目标。
        git(&env.other_clone, &["branch", "develop"]);
        git(&env.other_clone, &["push", "-u", "origin", "develop"]);
        git(
            &env.local,
            &["config", "--add", "branch.main.merge", "refs/heads/develop"],
        );

        write_file(&env.local, "local.txt", "local\n");
        git(&env.local, &["add", "local.txt"]);
        git(&env.local, &["commit", "-m", "local ahead"]);

        write_file(&env.other_clone, "remote.txt", "remote\n");
        git(&env.other_clone, &["add", "remote.txt"]);
        git(&env.other_clone, &["commit", "-m", "remote ahead"]);
        git(&env.other_clone, &["push", "origin", "main"]);

        pull(&env.local).expect("pull should target primary upstream only");

        assert!(
            env.local.join("remote.txt").exists(),
            "should integrate primary upstream commit"
        );
        assert!(
            env.local.join("local.txt").exists(),
            "should keep rebased local commit tree"
        );
        assert_clean_sync_state(&env.local);
    }

    #[test]
    fn push_with_multiple_merge_refs_updates_primary_upstream() {
        let env = setup_clone_with_upstream();
        git(
            &env.local,
            &["config", "--add", "branch.main.merge", "refs/heads/develop"],
        );
        write_file(&env.local, "local.txt", "local\n");
        git(&env.local, &["add", "local.txt"]);
        git(&env.local, &["commit", "-m", "local ahead"]);

        push(&env.local).expect("push should target primary upstream only");

        git(&env.other_clone, &["pull"]);
        assert_eq!(
            fs::read_to_string(env.other_clone.join("local.txt")).expect("read pushed file"),
            "local\n"
        );
    }

    fn assert_clean_sync_state(repo: &std::path::Path) {
        let git_dir = repo.join(".git");
        assert!(
            !git_dir.join("MERGE_HEAD").exists(),
            "must not leave MERGE_HEAD"
        );
        assert!(
            !git_dir.join("rebase-merge").exists(),
            "must not leave rebase-merge"
        );
        assert!(
            !git_dir.join("rebase-apply").exists(),
            "must not leave rebase-apply"
        );
        assert!(
            !git_dir.join("CHERRY_PICK_HEAD").exists(),
            "must not leave CHERRY_PICK_HEAD"
        );
    }

    struct RemoteTestEnv {
        bare: std::path::PathBuf,
        local: std::path::PathBuf,
        other_clone: std::path::PathBuf,
        _temp_dir: tempfile::TempDir,
    }

    fn setup_clone_with_upstream() -> RemoteTestEnv {
        let temp_dir = tempdir().expect("temp dir");
        let seed = temp_dir.path().join("seed");
        let bare = temp_dir.path().join("remote.git");
        let local = temp_dir.path().join("local");
        let other_clone = temp_dir.path().join("other");

        create_repo(&seed);
        write_file(&seed, "base.txt", "base\n");
        git(&seed, &["add", "base.txt"]);
        git(&seed, &["commit", "-m", "initial"]);

        git(
            temp_dir.path(),
            &[
                "clone",
                "--bare",
                seed.to_string_lossy().as_ref(),
                bare.to_string_lossy().as_ref(),
            ],
        );
        git(
            temp_dir.path(),
            &[
                "clone",
                bare.to_string_lossy().as_ref(),
                local.to_string_lossy().as_ref(),
            ],
        );
        git(
            temp_dir.path(),
            &[
                "clone",
                bare.to_string_lossy().as_ref(),
                other_clone.to_string_lossy().as_ref(),
            ],
        );

        // clone 后保证 user 配置，便于后续 commit。
        git(&local, &["config", "user.email", "redwhisk@example.test"]);
        git(&local, &["config", "user.name", "RedWhisk Test"]);
        git(
            &other_clone,
            &["config", "user.email", "redwhisk@example.test"],
        );
        git(&other_clone, &["config", "user.name", "RedWhisk Test"]);

        assert!(resolve_primary_upstream(&local).expect("clone has upstream").is_some());

        RemoteTestEnv {
            bare,
            local,
            other_clone,
            _temp_dir: temp_dir,
        }
    }

    fn create_repo(repo_dir: &Path) {
        fs::create_dir_all(repo_dir).expect("create repo dir");
        git(repo_dir, &["init"]);
        git(repo_dir, &["config", "user.email", "redwhisk@example.test"]);
        git(repo_dir, &["config", "user.name", "RedWhisk Test"]);
        git(repo_dir, &["checkout", "-b", "main"]);
    }

    fn write_file(repo_dir: &Path, relative_path: &str, contents: &str) {
        fs::write(repo_dir.join(relative_path), contents).expect("write file");
    }

    fn git(repo_dir: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo_dir)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_output(repo_dir: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo_dir)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout)
            .trim_end_matches(['\r', '\n'])
            .to_string()
    }
