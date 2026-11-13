use super::super::writeback_store::detail_writeback;
use super::{
    bind_repo, close_invocation, insert_completed, insert_project, memory, remote_state_of,
    set_provider, set_switches, status_of, write_back,
};
use crate::features::issue::github_issue_mirror::{
    with_captured_forge_invocations, with_simulated_forge_failure, ForgeIssueError,
};
use crate::types::issue_completion::CloseoutAction;

#[test]
fn merge_to_base_with_switch_off_keeps_remote_open() {
    let connection = memory();
    let project_id = insert_project(&connection);
    let repo = bind_repo(&connection, project_id);
    let issue_id = insert_completed(&connection, project_id);
    set_switches(&connection, project_id, false, false);
    let removed = repo.path().join("removed-worktree");

    let (result, invocations) = with_captured_forge_invocations(|| {
        write_back(
            &connection,
            issue_id,
            removed.to_str().expect("worktree path"),
            CloseoutAction::MergeToBase,
        )
    });

    result.expect("writeback");
    assert!(invocations.is_empty());
    assert_eq!(remote_state_of(&connection, issue_id), "open");
}

#[test]
fn open_pull_request_with_switch_on_keeps_remote_open() {
    let connection = memory();
    let project_id = insert_project(&connection);
    let repo = bind_repo(&connection, project_id);
    let issue_id = insert_completed(&connection, project_id);
    set_switches(&connection, project_id, true, false);
    let removed = repo.path().join("removed-worktree");

    let (result, invocations) = with_captured_forge_invocations(|| {
        write_back(
            &connection,
            issue_id,
            removed.to_str().expect("worktree path"),
            CloseoutAction::OpenPullRequest,
        )
    });

    result.expect("writeback");
    assert!(invocations.is_empty());
    assert_eq!(remote_state_of(&connection, issue_id), "open");
}

#[test]
fn merge_to_base_with_switch_on_closes_gitlab_issue() {
    let connection = memory();
    let project_id = insert_project(&connection);
    let repo = bind_repo(&connection, project_id);
    let issue_id = insert_completed(&connection, project_id);
    set_provider(&connection, issue_id, "gitlab");
    set_switches(&connection, project_id, true, false);
    let removed = repo.path().join("removed-worktree");
    let expected = close_invocation("glab", 12, repo.path());

    let (result, invocations) = with_captured_forge_invocations(|| {
        write_back(
            &connection,
            issue_id,
            removed.to_str().expect("worktree path"),
            CloseoutAction::MergeToBase,
        )
    });

    result.expect("writeback");
    assert_eq!(invocations, vec![expected]);
    assert_eq!(remote_state_of(&connection, issue_id), "closed");
}

#[test]
fn merge_to_base_close_offline_keeps_local_completion() {
    let connection = memory();
    let project_id = insert_project(&connection);
    let repo = bind_repo(&connection, project_id);
    let issue_id = insert_completed(&connection, project_id);
    set_switches(&connection, project_id, true, false);
    let removed = repo.path().join("removed-worktree");
    let expected = close_invocation("gh", 12, repo.path());

    let (result, invocations) = with_simulated_forge_failure(ForgeIssueError::Offline, || {
        write_back(
            &connection,
            issue_id,
            removed.to_str().expect("worktree path"),
            CloseoutAction::MergeToBase,
        )
    });

    let error = result.expect_err("offline");
    assert_eq!(error.reason.as_deref(), Some("writebackOffline"));
    assert_eq!(invocations, vec![expected]);
    assert_eq!(status_of(&connection, issue_id), "completed");
    assert_eq!(remote_state_of(&connection, issue_id), "open");
    let (pending, code) = detail_writeback(&connection, issue_id).expect("pending");
    assert!(pending);
    assert_eq!(code.as_deref(), Some("writebackOffline"));
}
