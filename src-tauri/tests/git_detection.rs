use std::fs;
use std::path::Path;
use std::process::Command;

use redwhisk_lib::git::operation_state::GitOperationState;
use redwhisk_lib::git::status::{
    detect_commit_result, read_git_snapshot, GitCommitDetectionResult,
};

#[test]
fn git_snapshot_records_head_porcelain_status_and_changed_files() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo = temp_dir.path();
    init_repo(repo);
    write_file(repo, "tracked.txt", "initial\n");
    git(repo, &["add", "tracked.txt"]);
    git(repo, &["commit", "-m", "initial"]);

    write_file(repo, "tracked.txt", "changed\n");
    write_file(repo, "untracked.txt", "new\n");

    let snapshot = read_git_snapshot(repo).expect("git snapshot");

    assert_eq!(snapshot.head.len(), 40);
    assert!(snapshot.status_porcelain.contains(" M tracked.txt"));
    assert!(snapshot.status_porcelain.contains("?? untracked.txt"));
    assert!(!snapshot.is_clean);
    assert_eq!(snapshot.operation_state, GitOperationState::None);
    assert!(snapshot
        .changed_files
        .iter()
        .any(|file| file.status == " M" && file.path == "tracked.txt"));
    assert!(snapshot
        .changed_files
        .iter()
        .any(|file| file.status == "??" && file.path == "untracked.txt"));
}

#[test]
fn git_snapshot_preserves_special_characters_in_changed_paths() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo = temp_dir.path();
    init_repo(repo);
    write_file(repo, "tab\t\"quoted\".txt", "initial\n");
    git(repo, &["add", "tab\t\"quoted\".txt"]);
    git(repo, &["commit", "-m", "initial"]);

    write_file(repo, "tab\t\"quoted\".txt", "changed\n");

    let snapshot = read_git_snapshot(repo).expect("git snapshot");

    assert!(snapshot.changed_files.iter().any(|file| {
        file.status == " M" && file.path == "tab\t\"quoted\".txt" && file.old_path.is_none()
    }));
}

#[test]
fn commit_detection_reports_new_commit_hash_when_head_changes() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo = temp_dir.path();
    init_repo(repo);
    write_file(repo, "tracked.txt", "initial\n");
    git(repo, &["add", "tracked.txt"]);
    git(repo, &["commit", "-m", "initial"]);
    let before = read_git_snapshot(repo).expect("before snapshot");

    write_file(repo, "tracked.txt", "changed\n");
    git(repo, &["add", "tracked.txt"]);
    git(repo, &["commit", "-m", "changed"]);
    let after = read_git_snapshot(repo).expect("after snapshot");

    assert_eq!(
        detect_commit_result(repo, &before, &after).expect("commit result"),
        GitCommitDetectionResult::NewCommit {
            commit_hash: after.head.clone(),
        }
    );
}

#[test]
fn commit_detection_reports_no_commit_detected_when_head_is_unchanged() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo = temp_dir.path();
    init_repo(repo);
    write_file(repo, "tracked.txt", "initial\n");
    git(repo, &["add", "tracked.txt"]);
    git(repo, &["commit", "-m", "initial"]);
    let before = read_git_snapshot(repo).expect("before snapshot");

    write_file(repo, "tracked.txt", "changed without commit\n");
    let after = read_git_snapshot(repo).expect("after snapshot");

    assert_eq!(
        detect_commit_result(repo, &before, &after).expect("commit result"),
        GitCommitDetectionResult::NoCommitDetected
    );
}

#[test]
fn commit_detection_blocks_when_operation_is_in_progress() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo = temp_dir.path();
    init_repo(repo);
    write_file(repo, "conflict.txt", "base\n");
    git(repo, &["add", "conflict.txt"]);
    git(repo, &["commit", "-m", "base"]);
    let before = read_git_snapshot(repo).expect("before snapshot");

    git(repo, &["checkout", "-b", "feature"]);
    write_file(repo, "conflict.txt", "feature\n");
    git(repo, &["commit", "-am", "feature"]);
    git(repo, &["checkout", "main"]);
    write_file(repo, "conflict.txt", "main\n");
    git(repo, &["commit", "-am", "main"]);

    git_expect_failure(repo, &["merge", "feature"]);
    let after = read_git_snapshot(repo).expect("merge snapshot");

    assert_eq!(
        detect_commit_result(repo, &before, &after).expect("commit result"),
        GitCommitDetectionResult::OperationInProgress {
            operation_state: GitOperationState::MergeInProgress,
        }
    );
    git(repo, &["reset", "--hard", "HEAD"]);
}

#[test]
fn commit_detection_does_not_treat_checkout_or_reset_as_new_commit() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo = temp_dir.path();
    init_repo(repo);
    write_file(repo, "tracked.txt", "initial\n");
    git(repo, &["add", "tracked.txt"]);
    git(repo, &["commit", "-m", "initial"]);
    let initial_head = git_output(repo, &["rev-parse", "HEAD"]);

    write_file(repo, "tracked.txt", "second\n");
    git(repo, &["commit", "-am", "second"]);
    let before = read_git_snapshot(repo).expect("before snapshot");

    git(repo, &["reset", "--hard", &initial_head]);
    let after_reset = read_git_snapshot(repo).expect("after reset snapshot");
    assert_eq!(
        detect_commit_result(repo, &before, &after_reset).expect("commit result"),
        GitCommitDetectionResult::HeadMovedWithoutNewCommit {
            head: after_reset.head.clone(),
        }
    );

    git(repo, &["checkout", "-b", "side", &initial_head]);
    write_file(repo, "side.txt", "side\n");
    git(repo, &["add", "side.txt"]);
    git(repo, &["commit", "-m", "side"]);
    let side_head = git_output(repo, &["rev-parse", "HEAD"]);
    let before_checkout = read_git_snapshot(repo).expect("before checkout snapshot");
    git(repo, &["checkout", "main"]);
    let after_checkout = read_git_snapshot(repo).expect("after checkout snapshot");

    assert_eq!(
        side_head, before_checkout.head,
        "fixture expects checkout to move back to an existing different head"
    );
    assert_eq!(
        detect_commit_result(repo, &before_checkout, &after_checkout).expect("commit result"),
        GitCommitDetectionResult::HeadMovedWithoutNewCommit {
            head: after_checkout.head.clone(),
        }
    );
}

#[test]
fn git_snapshot_detects_merge_rebase_and_cherry_pick_in_progress() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo = temp_dir.path();
    init_repo(repo);
    write_file(repo, "conflict.txt", "base\n");
    git(repo, &["add", "conflict.txt"]);
    git(repo, &["commit", "-m", "base"]);

    git(repo, &["checkout", "-b", "feature"]);
    write_file(repo, "conflict.txt", "feature\n");
    git(repo, &["commit", "-am", "feature"]);
    let feature_head = git_output(repo, &["rev-parse", "HEAD"]);

    git(repo, &["checkout", "main"]);
    write_file(repo, "conflict.txt", "main\n");
    git(repo, &["commit", "-am", "main"]);

    git_expect_failure(repo, &["merge", "feature"]);
    assert_eq!(
        read_git_snapshot(repo)
            .expect("merge snapshot")
            .operation_state,
        GitOperationState::MergeInProgress
    );
    git(repo, &["reset", "--hard", "HEAD"]);

    git_expect_failure(repo, &["cherry-pick", &feature_head]);
    assert_eq!(
        read_git_snapshot(repo)
            .expect("cherry-pick snapshot")
            .operation_state,
        GitOperationState::CherryPickInProgress
    );
    git(repo, &["cherry-pick", "--abort"]);

    git_expect_failure(repo, &["rebase", "feature"]);
    assert_eq!(
        read_git_snapshot(repo)
            .expect("rebase snapshot")
            .operation_state,
        GitOperationState::RebaseInProgress
    );
    git(repo, &["rebase", "--abort"]);
}

#[test]
fn git_snapshot_detects_unmerged_revert_and_sequencer_blockers() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let repo = temp_dir.path();
    init_repo(repo);
    write_file(repo, "conflict.txt", "base\n");
    git(repo, &["add", "conflict.txt"]);
    git(repo, &["commit", "-m", "base"]);

    git(repo, &["checkout", "-b", "feature"]);
    write_file(repo, "conflict.txt", "feature\n");
    git(repo, &["commit", "-am", "feature"]);

    git(repo, &["checkout", "main"]);
    write_file(repo, "conflict.txt", "main\n");
    git(repo, &["commit", "-am", "main"]);

    git_expect_failure(repo, &["merge", "feature"]);
    fs::remove_file(repo.join(".git").join("MERGE_HEAD")).expect("remove merge marker");
    assert_eq!(
        read_git_snapshot(repo)
            .expect("unmerged snapshot")
            .operation_state,
        GitOperationState::Unmerged
    );
    git(repo, &["reset", "--hard", "HEAD"]);

    write_file(repo, "revert.txt", "base\n");
    git(repo, &["add", "revert.txt"]);
    git(repo, &["commit", "-m", "add revert file"]);
    let revert_base = git_output(repo, &["rev-parse", "HEAD"]);

    git(repo, &["checkout", "-b", "revert-topic", &revert_base]);
    write_file(repo, "revert.txt", "topic line\n");
    git(repo, &["commit", "-am", "topic revert conflict"]);
    let revert_target = git_output(repo, &["rev-parse", "HEAD"]);

    git(repo, &["checkout", "main"]);
    write_file(repo, "revert.txt", "main line\n");
    git(repo, &["commit", "-am", "main revert conflict"]);
    git_expect_failure(repo, &["revert", &revert_target]);
    assert_eq!(
        read_git_snapshot(repo)
            .expect("revert snapshot")
            .operation_state,
        GitOperationState::RevertInProgress
    );
    git(repo, &["revert", "--abort"]);

    git(repo, &["checkout", "main"]);
    git(repo, &["checkout", "-b", "sequencer-source"]);
    write_file(repo, "conflict.txt", "pick one\n");
    git(repo, &["commit", "-am", "pick one"]);
    let pick_one = git_output(repo, &["rev-parse", "HEAD"]);
    write_file(repo, "conflict.txt", "pick two\n");
    git(repo, &["commit", "-am", "pick two"]);
    let pick_two = git_output(repo, &["rev-parse", "HEAD"]);
    git(repo, &["checkout", "main"]);
    write_file(repo, "conflict.txt", "main sequencer\n");
    git(repo, &["commit", "-am", "main sequencer conflict"]);
    git(repo, &["checkout", "-b", "sequencer-target"]);
    git_expect_failure(repo, &["cherry-pick", &pick_one, &pick_two]);
    assert_eq!(
        read_git_snapshot(repo)
            .expect("sequencer snapshot")
            .operation_state,
        GitOperationState::SequencerInProgress
    );
    git(repo, &["cherry-pick", "--abort"]);
}

fn init_repo(path: &Path) {
    git(path, &["init", "-b", "main"]);
    git(path, &["config", "user.name", "RedWhisk Test"]);
    git(path, &["config", "user.email", "redwhisk@example.test"]);
}

fn write_file(repo: &Path, relative_path: &str, content: &str) {
    fs::write(repo.join(relative_path), content).expect("write file");
}

fn git(repo: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_expect_failure(repo: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .expect("run git");
    assert!(
        !output.status.success(),
        "git {:?} unexpectedly succeeded\nstdout:\n{}\nstderr:\n{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_output(repo: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("utf8 output")
        .trim()
        .to_string()
}
