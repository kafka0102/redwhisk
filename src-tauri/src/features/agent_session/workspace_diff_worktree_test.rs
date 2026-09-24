//! 单文件差异定向取数：工作区（未提交）侧单测。

use std::fs;

use crate::features::agent_session::workspace::MAX_TEXT_FILE_BYTES;

use super::test_support::{commit_all, error_reason, git, init_git_repo, renamed_file_content};
use super::*;

#[test]
fn worktree_diff_reads_target_file_with_unrelated_changes_present() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path();
    init_git_repo(root);
    fs::write(root.join("target.ts"), "const value = 1;\n").expect("write target");
    fs::write(root.join("unrelated.ts"), "const other = 1;\n").expect("write unrelated");
    commit_all(root, "base");
    fs::write(root.join("target.ts"), "const value = 2;\n").expect("modify target");
    fs::write(root.join("unrelated.ts"), "const other = 2;\n").expect("modify unrelated");
    fs::create_dir_all(root.join("untracked dir")).expect("create dir");
    fs::write(root.join("untracked dir/extra.txt"), "extra\n").expect("write untracked");

    let diff = read_workspace_diff(root, "target.ts").expect("read diff");

    assert_eq!(diff.file_path, "target.ts");
    assert!(diff.old_path.is_none());
    assert_eq!(diff.kind, WorkspaceChangeKind::Modified);
    assert_eq!(diff.language, Some("typescript".to_string()));
    assert_eq!(diff.original_content, "const value = 1;\n");
    assert_eq!(diff.modified_content, "const value = 2;\n");
    assert!(!diff.is_binary);
    assert!(!diff.is_too_large);

    // 同一仓库里其他文件与未跟踪目录不影响该文件的取数结果。
    let unrelated = read_workspace_diff(root, "unrelated.ts").expect("read unrelated diff");
    assert_eq!(unrelated.modified_content, "const other = 2;\n");
}

#[test]
fn worktree_diff_reads_untracked_file() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path();
    init_git_repo(root);
    fs::write(root.join("tracked.txt"), "tracked\n").expect("write tracked");
    commit_all(root, "base");
    fs::create_dir_all(root.join("notes")).expect("create dir");
    fs::write(root.join("notes/new file.md"), "# new\n").expect("write untracked");

    let diff = read_workspace_diff(root, "notes/new file.md").expect("read diff");

    assert_eq!(diff.file_path, "notes/new file.md");
    assert_eq!(diff.kind, WorkspaceChangeKind::Untracked);
    assert_eq!(diff.language, Some("markdown".to_string()));
    assert!(diff.original_content.is_empty());
    assert_eq!(diff.modified_content, "# new\n");
    assert!(!diff.is_binary);
}

#[test]
fn worktree_diff_reads_staged_new_file_in_repo_without_commits() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path();
    init_git_repo(root);
    fs::write(root.join("fresh.txt"), "fresh\n").expect("write fresh");
    git(root, &["add", "fresh.txt"]);

    let diff = read_workspace_diff(root, "fresh.txt").expect("read diff");

    assert_eq!(diff.kind, WorkspaceChangeKind::Added);
    assert!(diff.original_content.is_empty());
    assert_eq!(diff.modified_content, "fresh\n");
    assert!(!diff.is_binary);
}

#[test]
fn worktree_diff_reads_rename_original_from_old_path() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path();
    init_git_repo(root);
    let original = renamed_file_content(1);
    let modified = renamed_file_content(99);
    fs::write(root.join("old-name.ts"), &original).expect("write old");
    commit_all(root, "base");
    git(root, &["mv", "old-name.ts", "new-name.ts"]);
    fs::write(root.join("new-name.ts"), &modified).expect("modify renamed");
    git(root, &["add", "new-name.ts"]);

    let diff = read_workspace_diff(root, "new-name.ts").expect("read diff");

    assert_eq!(diff.file_path, "new-name.ts");
    assert_eq!(diff.old_path.as_deref(), Some("old-name.ts"));
    assert_eq!(diff.kind, WorkspaceChangeKind::Renamed);
    assert_eq!(diff.original_content, original);
    assert_eq!(diff.modified_content, modified);
    assert_eq!(diff.language, Some("typescript".to_string()));

    // 重命名的旧路径在变更列表里不是独立条目：点它仍按「没有未提交变更」处理。
    assert_eq!(
        error_reason(read_workspace_diff(root, "old-name.ts")),
        "fileNoUncommittedChanges"
    );
}

#[test]
fn worktree_diff_reads_deleted_file_with_empty_modified_content() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path();
    init_git_repo(root);
    fs::write(root.join("gone.ts"), "const gone = 1;\n").expect("write gone");
    commit_all(root, "base");
    fs::remove_file(root.join("gone.ts")).expect("remove gone");

    let diff = read_workspace_diff(root, "gone.ts").expect("read diff");

    assert_eq!(diff.kind, WorkspaceChangeKind::Deleted);
    assert_eq!(diff.original_content, "const gone = 1;\n");
    assert!(diff.modified_content.is_empty());
    assert!(!diff.is_binary);
    assert!(!diff.is_too_large);
}

#[test]
fn worktree_diff_marks_binary_change() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path();
    init_git_repo(root);
    fs::write(root.join("logo.png"), b"\x89PNG\r\n\x1a\n").expect("write image");
    commit_all(root, "base");
    fs::write(root.join("logo.png"), b"\x89PNG\r\n\x1a\n\x00binary").expect("modify image");
    fs::write(root.join("payload.bin"), b"hello\x00world\n").expect("write untracked binary");

    let tracked = read_workspace_diff(root, "logo.png").expect("read tracked diff");
    assert_eq!(tracked.kind, WorkspaceChangeKind::Binary);
    assert!(tracked.is_binary);
    assert!(tracked.original_content.is_empty());
    assert!(tracked.modified_content.is_empty());

    let untracked = read_workspace_diff(root, "payload.bin").expect("read untracked diff");
    assert!(untracked.is_binary);
    assert!(untracked.modified_content.is_empty());
}

#[test]
fn worktree_diff_reports_missing_change_without_touching_unrelated_ones() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path();
    init_git_repo(root);
    fs::write(root.join("clean.ts"), "const clean = 1;\n").expect("write clean");
    fs::write(root.join("dirty.ts"), "const dirty = 1;\n").expect("write dirty");
    commit_all(root, "base");
    fs::write(root.join("dirty.ts"), "const dirty = 2;\n").expect("modify dirty");

    assert_eq!(
        error_reason(read_workspace_diff(root, "clean.ts")),
        "fileNoUncommittedChanges"
    );
    assert_eq!(
        read_workspace_diff(root, "dirty.ts")
            .expect("read dirty diff")
            .modified_content,
        "const dirty = 2;\n"
    );
}

#[test]
fn worktree_diff_agrees_with_full_status_for_mixed_changes() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path();
    init_git_repo(root);
    let large_original = renamed_file_content(1);
    fs::write(root.join("modified.ts"), "const modified = 1;\n").expect("write modified");
    fs::write(root.join("deleted.ts"), "const deleted = 1;\n").expect("write deleted");
    fs::write(root.join("large-old.ts"), &large_original).expect("write large old");
    fs::write(root.join("small-old.ts"), "const small = 1;\n").expect("write small old");
    fs::write(root.join("binary.png"), b"\x89PNG\r\n\x1a\n").expect("write binary");
    commit_all(root, "base");

    fs::write(root.join("modified.ts"), "const modified = 2;\n").expect("modify");
    fs::remove_file(root.join("deleted.ts")).expect("delete");
    fs::write(root.join("binary.png"), b"\x89PNG\r\n\x1a\n\x00more").expect("modify binary");
    // 两处重命名都要与全量 status 的折叠结果一致（大文件改一行、小文件整体搬迁）。
    git(root, &["mv", "large-old.ts", "large-new.ts"]);
    fs::write(root.join("large-new.ts"), renamed_file_content(99)).expect("modify renamed");
    git(root, &["add", "large-new.ts"]);
    git(root, &["mv", "small-old.ts", "small-new.ts"]);
    fs::write(root.join("staged.ts"), "const staged = 1;\n").expect("write staged");
    git(root, &["add", "staged.ts"]);
    fs::create_dir_all(root.join("newdir/sub")).expect("create dir");
    fs::write(root.join("newdir/sub/leaf.ts"), "const leaf = 1;\n").expect("write leaf");
    fs::write(root.join("untracked.bin"), b"payload\x00").expect("write untracked binary");

    // 期望条目写死在用例里（不拿被测实现当判据）。
    let mut expected = vec![
        (
            "binary.png".to_string(),
            WorkspaceChangeKind::Modified,
            None,
        ),
        ("deleted.ts".to_string(), WorkspaceChangeKind::Deleted, None),
        (
            "large-new.ts".to_string(),
            WorkspaceChangeKind::Renamed,
            Some("large-old.ts".to_string()),
        ),
        (
            "modified.ts".to_string(),
            WorkspaceChangeKind::Modified,
            None,
        ),
        (
            "newdir/sub/leaf.ts".to_string(),
            WorkspaceChangeKind::Untracked,
            None,
        ),
        (
            "small-new.ts".to_string(),
            WorkspaceChangeKind::Renamed,
            Some("small-old.ts".to_string()),
        ),
        ("staged.ts".to_string(), WorkspaceChangeKind::Added, None),
        (
            "untracked.bin".to_string(),
            WorkspaceChangeKind::Untracked,
            None,
        ),
    ];
    expected.sort_by(|left, right| left.0.cmp(&right.0));

    // 基准来自全量 status（变更列表的实际来源），先确认它与写死的期望一致。
    let status_output = run_git_bytes(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )
    .expect("read status");
    let mut entries = parse_status_entries(&status_output)
        .expect("parse status")
        .into_iter()
        .map(|entry| (entry.path, entry.kind, entry.old_path))
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    assert_eq!(entries, expected, "status baseline drifted from fixture");

    for (path, kind, old_path) in &entries {
        let diff = read_workspace_diff(root, path)
            .unwrap_or_else(|error| panic!("diff for {path} failed: {error:?}"));
        assert_eq!(&diff.old_path, old_path, "old path mismatch for {path}");
        if !diff.is_binary {
            assert_eq!(&diff.kind, kind, "kind mismatch for {path}");
        }
    }
}

#[test]
fn worktree_diff_marks_large_head_content_too_large_without_returning_original() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path();
    init_git_repo(root);
    let large_content = "a".repeat((MAX_TEXT_FILE_BYTES + 1) as usize);
    fs::write(root.join("large.txt"), large_content).expect("write large");
    git(root, &["add", "large.txt"]);
    git(root, &["commit", "-m", "add large"]);
    fs::write(root.join("large.txt"), "small\n").expect("write small");

    let diff = read_workspace_diff(root, "large.txt").expect("read diff");

    assert!(diff.is_too_large);
    assert!(!diff.is_binary);
    assert!(diff.original_content.is_empty());
    assert!(diff.modified_content.is_empty());
}

#[test]
fn worktree_diff_matches_path_literally_for_glob_characters() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path();
    init_git_repo(root);
    fs::write(root.join("keep.txt"), "keep\n").expect("write keep");
    commit_all(root, "base");
    fs::write(root.join("a[1].txt"), "bracket\n").expect("write bracket");
    fs::write(root.join("a1.txt"), "plain\n").expect("write plain");

    let diff = read_workspace_diff(root, "a[1].txt").expect("read diff");

    assert_eq!(diff.file_path, "a[1].txt");
    assert_eq!(diff.kind, WorkspaceChangeKind::Untracked);
    assert_eq!(diff.modified_content, "bracket\n");
}

#[cfg(unix)]
#[test]
fn worktree_diff_rejects_symlink_escaping_workspace() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path().join("workspace");
    let outside = temp_dir.path().join("outside.txt");
    fs::create_dir_all(&root).expect("create root");
    init_git_repo(&root);
    fs::write(&outside, "secret\n").expect("write outside");
    std::os::unix::fs::symlink(&outside, root.join("linked.txt")).expect("symlink");

    let error = read_workspace_diff(&root, "linked.txt").expect_err("symlink escape");

    assert_eq!(error.reason.as_deref(), Some("filePathOutsideRepo"));
}

#[test]
fn diff_rejects_paths_outside_workspace() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path();
    init_git_repo(root);
    fs::write(root.join("keep.txt"), "keep\n").expect("write keep");
    commit_all(root, "base");
    let commit_hash = super::test_support::head_hash(root);

    assert_eq!(
        error_reason(read_workspace_diff(root, "../outside.txt")),
        "pathMustBeRelative"
    );
    assert_eq!(
        error_reason(read_workspace_commit_diff(
            root,
            &commit_hash,
            "../outside.txt"
        )),
        "pathMustBeRelative"
    );
}
