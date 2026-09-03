//! 主 checkout：基于当前 HEAD 创建并签出本地分支（`git checkout -b`）。

use std::path::Path;

use super::command::{self, GitCommandError};

/// 在 `repo_path` 基于当前 HEAD 创建并签出本地分支 `name`。
/// 工作区未提交改动随迁；Git 拒绝时原样返回错误，不丢弃改动。
pub fn create_and_checkout_branch(
    repo_path: impl AsRef<Path>,
    name: &str,
) -> Result<String, GitCommandError> {
    let repo_path = repo_path.as_ref();
    command::run_git(repo_path, &["checkout", "-b", name])?;
    Ok(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::super::command::GitCommandError;
    use super::*;
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use tempfile::tempdir;

    #[test]
    fn create_and_checkout_switches_to_new_branch() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        create_repo(&repo);
        write_commit(&repo, "base.txt", "base\n", "initial");
        git(&repo, &["branch", "-M", "main"]);

        let branch = create_and_checkout_branch(&repo, "feature-new").expect("create");

        assert_eq!(branch, "feature-new");
        assert_eq!(current_branch(&repo), "feature-new");
        let head = rev_parse(&repo, "HEAD");
        let main = rev_parse(&repo, "main");
        assert_eq!(head, main);
    }

    #[test]
    fn create_and_checkout_keeps_dirty_working_tree() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        create_repo(&repo);
        write_commit(&repo, "base.txt", "base\n", "initial");
        git(&repo, &["branch", "-M", "main"]);
        fs::write(repo.join("dirty.txt"), "dirty\n").expect("write dirty");

        create_and_checkout_branch(&repo, "with-dirty").expect("create");

        assert_eq!(current_branch(&repo), "with-dirty");
        assert_eq!(
            fs::read_to_string(repo.join("dirty.txt")).expect("read"),
            "dirty\n"
        );
        let status = git_stdout(&repo, &["status", "--porcelain"]);
        assert!(
            status.contains("dirty.txt"),
            "dirty file should remain: {status}"
        );
    }

    #[test]
    fn create_and_checkout_rejects_existing_branch_without_discard() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        create_repo(&repo);
        write_commit(&repo, "base.txt", "base\n", "initial");
        git(&repo, &["branch", "-M", "main"]);
        git(&repo, &["branch", "existing"]);
        fs::write(repo.join("keep.txt"), "keep\n").expect("write");

        let err = create_and_checkout_branch(&repo, "existing").expect_err("should fail");
        match err {
            GitCommandError::Failed { .. } => {}
            other => panic!("expected Failed, got {other:?}"),
        }
        assert_eq!(current_branch(&repo), "main");
        assert_eq!(
            fs::read_to_string(repo.join("keep.txt")).expect("read"),
            "keep\n"
        );
    }

    #[test]
    fn create_and_checkout_rejects_empty_name() {
        let temp = tempdir().expect("temp");
        let repo = temp.path().join("repo");
        create_repo(&repo);
        write_commit(&repo, "base.txt", "base\n", "initial");
        git(&repo, &["branch", "-M", "main"]);

        let err = create_and_checkout_branch(&repo, "").expect_err("empty name");
        match err {
            GitCommandError::Failed { .. } => {}
            other => panic!("expected Failed, got {other:?}"),
        }
        assert_eq!(current_branch(&repo), "main");
    }

    fn create_repo(repo_dir: &Path) {
        fs::create_dir_all(repo_dir).expect("create");
        git(repo_dir, &["init"]);
        git(repo_dir, &["config", "user.email", "redwhisk@example.test"]);
        git(repo_dir, &["config", "user.name", "RedWhisk Test"]);
    }

    fn write_commit(repo_dir: &Path, path: &str, contents: &str, message: &str) {
        fs::write(repo_dir.join(path), contents).expect("write");
        git(repo_dir, &["add", path]);
        git(repo_dir, &["commit", "-m", message]);
    }

    fn git(repo_dir: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo_dir)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_stdout(repo_dir: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo_dir)
            .output()
            .expect("run git");
        assert!(output.status.success());
        String::from_utf8_lossy(&output.stdout).to_string()
    }

    fn current_branch(repo_dir: &Path) -> String {
        git_stdout(repo_dir, &["branch", "--show-current"])
            .trim()
            .to_string()
    }

    fn rev_parse(repo_dir: &Path, rev: &str) -> String {
        git_stdout(repo_dir, &["rev-parse", rev]).trim().to_string()
    }
}
