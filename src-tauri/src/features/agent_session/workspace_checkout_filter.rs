//! 签出列表过滤：排除未关闭完成的 RedWhisk 托管 worktree 工作分支。

use std::collections::HashSet;

use crate::db::agent_session_repository::AgentSessionListRow;
use crate::types::agent_session::{AgentSessionStatus, WorkspaceMode, WorktreeOwner};
use crate::types::issue::IssueStatus;

/// 若该 Session 仍占用 RedWhisk 临时 worktree 分支，返回应隐藏的分支名。
pub(super) fn reserved_worktree_branch<'a>(
    workspace_mode: WorkspaceMode,
    worktree_owner: WorktreeOwner,
    session_status: &AgentSessionStatus,
    issue_status: Option<&IssueStatus>,
    workspace_branch: Option<&'a str>,
) -> Option<&'a str> {
    let branch = workspace_branch
        .map(str::trim)
        .filter(|name| !name.is_empty())?;
    if workspace_mode != WorkspaceMode::Worktree || worktree_owner != WorktreeOwner::Redwhisk {
        return None;
    }
    let session_open = *session_status != AgentSessionStatus::Closed;
    let issue_open = issue_status.is_some_and(|status| *status != IssueStatus::Completed);
    (session_open || issue_open).then_some(branch)
}

pub(super) fn reserved_active_worktree_branches(
    sessions: impl IntoIterator<Item = AgentSessionListRow>,
) -> HashSet<String> {
    sessions
        .into_iter()
        .filter_map(|session| {
            reserved_worktree_branch(
                session.workspace_mode,
                session.worktree_owner,
                &session.status,
                session.issue_status.as_ref(),
                session.workspace_branch.as_deref(),
            )
            .map(str::to_string)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reserved(
        mode: WorkspaceMode,
        owner: WorktreeOwner,
        session: AgentSessionStatus,
        issue: Option<IssueStatus>,
        branch: Option<&str>,
    ) -> Option<&str> {
        reserved_worktree_branch(mode, owner, &session, issue.as_ref(), branch)
    }

    #[test]
    fn hides_running_redwhisk_worktree_branch() {
        assert_eq!(
            reserved(
                WorkspaceMode::Worktree,
                WorktreeOwner::Redwhisk,
                AgentSessionStatus::Running,
                Some(IssueStatus::Running),
                Some("issue-1-redwhisk"),
            ),
            Some("issue-1-redwhisk")
        );
    }

    #[test]
    fn hides_when_session_closed_but_issue_not_completed() {
        assert_eq!(
            reserved(
                WorkspaceMode::Worktree,
                WorktreeOwner::Redwhisk,
                AgentSessionStatus::Closed,
                Some(IssueStatus::Review),
                Some("issue-8-redwhisk"),
            ),
            Some("issue-8-redwhisk")
        );
    }

    #[test]
    fn hides_crashed_or_stopped_session_branch() {
        assert_eq!(
            reserved(
                WorkspaceMode::Worktree,
                WorktreeOwner::Redwhisk,
                AgentSessionStatus::Crashed,
                Some(IssueStatus::Completed),
                Some("issue-3-redwhisk"),
            ),
            Some("issue-3-redwhisk")
        );
        assert_eq!(
            reserved(
                WorkspaceMode::Worktree,
                WorktreeOwner::Redwhisk,
                AgentSessionStatus::Stopped,
                None,
                Some("temp-work"),
            ),
            Some("temp-work")
        );
    }

    #[test]
    fn shows_after_issue_and_session_are_done() {
        assert_eq!(
            reserved(
                WorkspaceMode::Worktree,
                WorktreeOwner::Redwhisk,
                AgentSessionStatus::Closed,
                Some(IssueStatus::Completed),
                Some("issue-9"),
            ),
            None
        );
    }

    #[test]
    fn ignores_current_branch_and_external_worktree() {
        assert_eq!(
            reserved(
                WorkspaceMode::CurrentBranch,
                WorktreeOwner::Redwhisk,
                AgentSessionStatus::Running,
                Some(IssueStatus::Running),
                Some("main"),
            ),
            None
        );
        assert_eq!(
            reserved(
                WorkspaceMode::Worktree,
                WorktreeOwner::External,
                AgentSessionStatus::Running,
                Some(IssueStatus::Running),
                Some("user-wt"),
            ),
            None
        );
    }

    #[test]
    fn ignores_blank_branch() {
        assert_eq!(
            reserved(
                WorkspaceMode::Worktree,
                WorktreeOwner::Redwhisk,
                AgentSessionStatus::Running,
                Some(IssueStatus::Running),
                Some("   "),
            ),
            None
        );
    }
}

#[cfg(test)]
mod service_tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use rusqlite::params;

    use crate::db::agent_session_repository::AgentSessionRepository;
    use crate::db::migrations::MigrationRunner;
    use crate::db::project_repository::ProjectRepository;
    use crate::types::session_workspace::ProjectWorkspaceInput;

    use super::super::workspace::SessionWorkspaceService;

    #[test]
    fn list_hides_open_redwhisk_worktree_only() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_root = temp_dir.path().join("repo");
        fs::create_dir_all(&repo_root).expect("create repo dir");
        init_git_repo(&repo_root);
        fs::write(repo_root.join("README.md"), "base\n").expect("write");
        git(&repo_root, &["add", "README.md"]);
        git(&repo_root, &["commit", "-m", "base"]);
        git(&repo_root, &["branch", "-M", "main"]);
        git(&repo_root, &["branch", "feature-keep"]);
        git(&repo_root, &["branch", "issue-1-redwhisk"]);
        git(&repo_root, &["branch", "issue-2-redwhisk"]);

        let repo_canonical = repo_root
            .canonicalize()
            .expect("canonicalize repo")
            .to_string_lossy()
            .to_string();
        let connection = rusqlite::Connection::open_in_memory().expect("open db");
        MigrationRunner::default()
            .run(&connection)
            .expect("migrate");
        connection
            .execute(
                "INSERT INTO projects (id, name, repo_path, created_at, last_opened_at)
                 VALUES (1, 'p1', ?1, 0, 0)",
                params![&repo_canonical],
            )
            .expect("insert project");
        connection
            .execute(
                "INSERT INTO agent_profiles (
                   id, name, agent_type, command, scope, project_id, mode, dangerous,
                   default_skill, prompt_template, del
                 ) VALUES (
                   100, 'Codex', 'codex', 'codex', 'project', 1, 'full-auto', 1,
                   '', '', 0
                 )",
                [],
            )
            .expect("insert profile");
        connection
            .execute(
                "INSERT INTO issues (id, project_id, number, title, description, status, created_at, updated_at, del)
                 VALUES (1, 1, 1, 'open', '', 'running', 1, 1, 0)",
                [],
            )
            .expect("insert open issue");
        connection
            .execute(
                "INSERT INTO issues (id, project_id, number, title, description, status, created_at, updated_at, del)
                 VALUES (2, 1, 2, 'done', '', 'completed', 1, 1, 0)",
                [],
            )
            .expect("insert done issue");
        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, number, issue_id, agent_profile_id, status, attention,
                   working_dir, command_snapshot, prompt_snapshot, workspace_mode,
                   workspace_branch, worktree_owner, log_path, last_active_at, started_at, del
                 ) VALUES (
                   1, 1, 1, 1, 100, 'running', 'none',
                   ?1, 'codex', '', 'worktree',
                   'issue-1-redwhisk', 'redwhisk', '/tmp/s1.log', 1, 1, 0
                 )",
                params![&repo_canonical],
            )
            .expect("insert open session");
        connection
            .execute(
                "INSERT INTO agent_sessions (
                   id, project_id, number, issue_id, agent_profile_id, status, attention,
                   working_dir, command_snapshot, prompt_snapshot, workspace_mode,
                   workspace_branch, worktree_owner, log_path, last_active_at, started_at,
                   closed_at, del
                 ) VALUES (
                   2, 1, 2, 2, 100, 'closed', 'none',
                   ?1, 'codex', '', 'worktree',
                   'issue-2-redwhisk', 'redwhisk', '/tmp/s2.log', 1, 1,
                   2, 0
                 )",
                params![&repo_canonical],
            )
            .expect("insert closed session");

        let service = SessionWorkspaceService::new(
            ProjectRepository::new(&connection),
            AgentSessionRepository::new(&connection),
        );
        let response = service
            .list_checkout_branches(ProjectWorkspaceInput {
                project_id: 1,
                session_id: None,
                workspace_path: Some(repo_canonical),
                limit: None,
                offset: None,
            })
            .expect("list");
        let names: Vec<&str> = response
            .local_branches
            .iter()
            .map(|branch| branch.name.as_str())
            .collect();
        assert!(names.contains(&"main"), "{names:?}");
        assert!(names.contains(&"feature-keep"), "{names:?}");
        assert!(names.contains(&"issue-2-redwhisk"), "{names:?}");
        assert!(
            !names.contains(&"issue-1-redwhisk"),
            "open redwhisk worktree branch must be hidden: {names:?}"
        );
    }

    fn init_git_repo(root: &Path) {
        git(root, &["init"]);
        git(root, &["config", "user.email", "test@example.com"]);
        git(root, &["config", "user.name", "Test User"]);
    }

    fn git(root: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
