//! 提交内单文件差异的定向取数：只读取该提交里目标路径的变更条目。

use std::path::Path;

use crate::types::errors::CommandError;
use crate::types::session_workspace::WorkspaceChangeKind;

use super::workspace::{
    literal_pathspec, parse_commit_changed_file, run_git, validate_workspace_relative_path,
};
use super::workspace_diff::{classify_rename_role, RenameRole};

/// 提交内变更条目。二进制由 blob 内容读取判定，不在此结构上。
pub(super) struct CommitChange {
    pub(super) file_path: String,
    pub(super) old_path: Option<String>,
    pub(super) kind: WorkspaceChangeKind,
}

/// 按路径定向读取提交内变更条目。
///
/// 原实现用 `read_commit_changed_files` 取该提交的全部变更文件再 `find`。这里把
/// pathspec 限定到目标路径，`--name-status -M -C` 的其余语义保持一致。
pub(super) fn read_commit_change(
    root: &Path,
    commit_hash: &str,
    file_path: &str,
) -> Result<Option<CommitChange>, CommandError> {
    validate_workspace_relative_path(file_path)?;
    let output = run_git(
        root,
        &[
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--name-status",
            "-r",
            "-M",
            "-C",
            commit_hash,
            "--",
            &literal_pathspec(file_path),
        ],
    )?;
    let Some(change) = output
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(parse_commit_changed_file)
        .find(|change| change.file_path == file_path)
    else {
        return Ok(None);
    };

    // 与工作区路径同理：限定 pathspec 后 git 无法检测重命名，`-M -C` 的 R / C 会被拆成
    // A / D。只在可能被拆开的 A / D 上补一次该提交的 R / C 查询。
    if matches!(
        change.kind,
        WorkspaceChangeKind::Added | WorkspaceChangeKind::Deleted
    ) {
        match resolve_commit_rename(root, commit_hash, file_path)? {
            RenameRole::Target { kind, old_path } => {
                return Ok(Some(CommitChange {
                    file_path: change.file_path,
                    old_path: Some(old_path),
                    kind,
                }));
            }
            RenameRole::Source => return Ok(None),
            RenameRole::None => {}
        }
    }

    Ok(Some(CommitChange {
        file_path: change.file_path,
        old_path: change.old_path,
        kind: change.kind,
    }))
}

fn resolve_commit_rename(
    root: &Path,
    commit_hash: &str,
    file_path: &str,
) -> Result<RenameRole, CommandError> {
    // 与旧实现 read_commit_changed_files 同一套 `-M -C` 语义，只把结果裁到 R / C，
    // 因此它能命中的重命名 / 复制与全量列表完全一致。
    let output = run_git(
        root,
        &[
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--name-status",
            "-r",
            "-M",
            "-C",
            "--diff-filter=RC",
            commit_hash,
        ],
    )?;

    Ok(classify_rename_role(
        commit_rename_entries(&output),
        file_path,
    ))
}

/// 解析 `git diff-tree --name-status -r -M -C --diff-filter=RC` 的输出。
fn commit_rename_entries(output: &str) -> Vec<(WorkspaceChangeKind, String, String)> {
    let mut entries = Vec::new();
    for change in output
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(parse_commit_changed_file)
    {
        if let Some(old_path) = change.old_path {
            entries.push((change.kind, old_path, change.file_path));
        }
    }

    entries
}
