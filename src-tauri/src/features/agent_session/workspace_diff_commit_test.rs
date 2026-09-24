//! 单文件差异定向取数：提交内侧单测。

use std::fs;

use super::test_support::{
    commit_all, error_reason, git, head_hash, init_git_repo, renamed_file_content,
};
use super::*;

#[test]
fn commit_diff_reads_target_file_with_unrelated_changes_present() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path();
    init_git_repo(root);
    fs::write(root.join("target.ts"), "const title = 'old';\n").expect("write target");
    fs::write(root.join("unrelated.ts"), "const other = 'old';\n").expect("write unrelated");
    commit_all(root, "base");
    fs::write(root.join("target.ts"), "const title = 'new';\n").expect("modify target");
    fs::write(root.join("unrelated.ts"), "const other = 'new';\n").expect("modify unrelated");
    fs::write(root.join("added.ts"), "const added = true;\n").expect("write added");
    commit_all(root, "update");
    let commit_hash = head_hash(root);

    let diff = read_workspace_commit_diff(root, &commit_hash, "target.ts").expect("read diff");

    assert_eq!(diff.file_path, "target.ts");
    assert_eq!(diff.kind, WorkspaceChangeKind::Modified);
    assert_eq!(diff.original_content, "const title = 'old';\n");
    assert_eq!(diff.modified_content, "const title = 'new';\n");
    assert_eq!(diff.language, Some("typescript".to_string()));
    assert!(!diff.is_binary);
    assert!(!diff.is_too_large);

    assert_eq!(
        error_reason(read_workspace_commit_diff(root, &commit_hash, "keep.ts")),
        "fileNotInCommit"
    );
}

#[test]
fn commit_diff_reads_root_commit_with_empty_original() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path();
    init_git_repo(root);
    fs::write(root.join("first.ts"), "const first = 1;\n").expect("write first");
    commit_all(root, "root");
    let commit_hash = head_hash(root);

    let diff = read_workspace_commit_diff(root, &commit_hash, "first.ts").expect("read diff");

    assert_eq!(diff.kind, WorkspaceChangeKind::Added);
    assert!(diff.original_content.is_empty());
    assert_eq!(diff.modified_content, "const first = 1;\n");
    assert!(!diff.is_binary);
}

#[test]
fn commit_diff_reads_rename_original_from_old_path() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path();
    init_git_repo(root);
    let original = renamed_file_content(1);
    let modified = renamed_file_content(99);
    fs::write(root.join("old-name.ts"), &original).expect("write old");
    commit_all(root, "base");
    git(root, &["mv", "old-name.ts", "new-name.ts"]);
    fs::write(root.join("new-name.ts"), &modified).expect("modify renamed");
    commit_all(root, "rename");
    let commit_hash = head_hash(root);

    let diff = read_workspace_commit_diff(root, &commit_hash, "new-name.ts").expect("read diff");

    assert_eq!(diff.file_path, "new-name.ts");
    assert_eq!(diff.old_path.as_deref(), Some("old-name.ts"));
    assert_eq!(diff.kind, WorkspaceChangeKind::Renamed);
    assert_eq!(diff.original_content, original);
    assert_eq!(diff.modified_content, modified);

    assert_eq!(
        error_reason(read_workspace_commit_diff(
            root,
            &commit_hash,
            "old-name.ts"
        )),
        "fileNotInCommit"
    );
}

#[test]
fn commit_diff_reads_deleted_and_binary_entries() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let root = temp_dir.path();
    init_git_repo(root);
    fs::write(root.join("gone.ts"), "const gone = 1;\n").expect("write gone");
    fs::write(root.join("logo.png"), b"\x89PNG\r\n\x1a\n").expect("write image");
    commit_all(root, "base");
    fs::remove_file(root.join("gone.ts")).expect("remove gone");
    fs::write(root.join("logo.png"), b"\x89PNG\r\n\x1a\n\x00binary").expect("modify image");
    commit_all(root, "update");
    let commit_hash = head_hash(root);

    let deleted =
        read_workspace_commit_diff(root, &commit_hash, "gone.ts").expect("read deleted diff");
    assert_eq!(deleted.kind, WorkspaceChangeKind::Deleted);
    assert_eq!(deleted.original_content, "const gone = 1;\n");
    assert!(deleted.modified_content.is_empty());

    let binary =
        read_workspace_commit_diff(root, &commit_hash, "logo.png").expect("read binary diff");
    assert!(binary.is_binary);
    assert!(binary.original_content.is_empty());
    assert!(binary.modified_content.is_empty());
}
