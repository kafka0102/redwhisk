use std::path::Path;

use super::command::{self, GitCommandError};

/// 在指定仓库路径执行 `git pull`。
pub fn pull(repo_path: impl AsRef<Path>) -> Result<(), GitCommandError> {
    command::run_git(repo_path.as_ref(), &["pull"]).map(|_| ())
}

/// 在指定仓库路径推送当前分支。
/// 已有 `@{upstream}` 时执行 `git push`；否则执行 `git push -u origin HEAD`。
pub fn push(repo_path: impl AsRef<Path>) -> Result<(), GitCommandError> {
    let repo_path = repo_path.as_ref();
    if has_upstream(repo_path)? {
        command::run_git(repo_path, &["push"]).map(|_| ())
    } else {
        command::run_git(repo_path, &["push", "-u", "origin", "HEAD"]).map(|_| ())
    }
}

fn has_upstream(repo_path: &Path) -> Result<bool, GitCommandError> {
    match command::run_git(repo_path, &["rev-parse", "--abbrev-ref", "@{upstream}"]) {
        Ok(value) => Ok(!value.trim().is_empty()),
        Err(GitCommandError::Failed { .. }) => Ok(false),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
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
        assert!(!has_upstream(&env.local).expect("check upstream"));
        write_file(&env.local, "feature.txt", "feature\n");
        git(&env.local, &["add", "feature.txt"]);
        git(&env.local, &["commit", "-m", "feature"]);

        push(&env.local).expect("push -u origin HEAD");

        assert!(has_upstream(&env.local).expect("upstream after push -u"));
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

        assert!(has_upstream(&local).expect("clone has upstream"));

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
}
