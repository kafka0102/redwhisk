use std::path::{Path, PathBuf};

use crate::git::worktree::list_code_workspaces;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

pub fn validate_code_language_workspace(
    workspace_path: &str,
    repo_path: &str,
) -> Result<PathBuf, CommandError> {
    let trimmed = workspace_path.trim();
    if trimmed.is_empty() {
        return Err(validation_error(
            "工作区路径不能为空。",
            "workspacePathRequired",
            workspace_path,
        ));
    }

    let canonical = Path::new(trimmed).canonicalize().map_err(|error| {
        validation_error(
            "工作区路径不可访问。",
            "workspacePathInvalid",
            workspace_path,
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;
    if !canonical.is_dir() {
        return Err(validation_error(
            "工作区路径不是目录。",
            "workspacePathInvalid",
            workspace_path,
        ));
    }

    let roots = list_code_workspaces(repo_path).map_err(|error| {
        validation_error("代码工作区不存在。", "workspaceNotFound", workspace_path)
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;
    let belongs = roots
        .iter()
        .any(|root| Path::new(&root.path).canonicalize().ok().as_ref() == Some(&canonical));
    if !belongs {
        return Err(validation_error(
            "代码工作区不存在。",
            "workspaceNotFound",
            workspace_path,
        ));
    }

    Ok(canonical)
}

fn validation_error(message: &str, reason: &str, workspace_path: &str) -> CommandError {
    CommandError::new(CommandErrorCode::CodeLanguageValidationFailed, message)
        .with_reason(reason)
        .with_detail(ErrorDetail::new("WorkspacePath").with_value("workspacePath", workspace_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use tempfile::tempdir;

    fn create_repo(repo_dir: &Path) {
        fs::create_dir_all(repo_dir).expect("create repo dir");
        git(repo_dir, &["init"]);
        git(repo_dir, &["config", "user.email", "redwhisk@example.test"]);
        git(repo_dir, &["config", "user.name", "RedWhisk Test"]);
        git(repo_dir, &["checkout", "-b", "main"]);
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

    #[test]
    fn accepts_project_root_workspace() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        create_repo(&repo_dir);

        let canonical = validate_code_language_workspace(
            repo_dir.to_str().expect("utf8 path"),
            repo_dir.to_str().expect("utf8 path"),
        )
        .expect("valid workspace");

        assert_eq!(canonical, repo_dir.canonicalize().expect("canonicalize"));
    }

    #[test]
    fn rejects_empty_workspace_path() {
        let error = validate_code_language_workspace("  ", "/tmp/repo").expect_err("empty");
        assert_eq!(error.code, CommandErrorCode::CodeLanguageValidationFailed);
        assert_eq!(error.reason.as_deref(), Some("workspacePathRequired"));
    }

    #[test]
    fn rejects_missing_workspace_path() {
        let error =
            validate_code_language_workspace("/tmp/missing-redwhisk-workspace", "/tmp/repo")
                .expect_err("missing");
        assert_eq!(error.code, CommandErrorCode::CodeLanguageValidationFailed);
        assert_eq!(error.reason.as_deref(), Some("workspacePathInvalid"));
    }

    #[test]
    fn rejects_workspace_outside_code_roots() {
        let temp_dir = tempdir().expect("temp dir");
        let repo_dir = temp_dir.path().join("repo");
        let other_dir = temp_dir.path().join("other");
        create_repo(&repo_dir);
        fs::create_dir_all(&other_dir).expect("other dir");

        let error = validate_code_language_workspace(
            other_dir.to_str().expect("utf8 path"),
            repo_dir.to_str().expect("utf8 path"),
        )
        .expect_err("outside");
        assert_eq!(error.code, CommandErrorCode::CodeLanguageValidationFailed);
        assert_eq!(error.reason.as_deref(), Some("workspaceNotFound"));
    }
}
