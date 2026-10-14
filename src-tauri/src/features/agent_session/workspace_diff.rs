//! 单文件差异定向取数：点开一个文件时只读取该路径所需的变更条目与内容，
//! 不再先算出整个工作区 / 整个提交的全部变更文件再挑出这一个。
//!
//! 入口是用户点击差异时的高频命令。历史实现先跑完整
//! `git status --untracked-files=all` + 完整 `git diff --numstat HEAD` + 逐文件
//! metadata + branch sync，再从中 `find` 出目标文件，等于为一个文件付整个工作区的
//! 取数成本（见 docs/standards/performance.md §3「按需过滤」）。这里改为按该路径
//! 定向查询，命令名、DTO、错误码与既有展示语义保持不变。

use std::path::Path;

use crate::types::errors::CommandError;
use crate::types::session_workspace::{WorkspaceChangeKind, WorkspaceDiffContent};

use super::workspace::{
    literal_pathspec, parse_status_entries, read_git_file, read_head_file, read_workspace_file,
    resolve_commit_hash, run_git, run_git_bytes, validate_workspace_relative_path,
    workspace_validation_error,
};
use super::workspace_diff_commit::read_commit_change;
use super::workspace_diff_preview::{
    absent_side, assemble_diff, read_diff_side_from_git, read_diff_side_from_workspace,
};

/// 工作区变更条目：定向取数只保留差异渲染所需的字段。
struct WorktreeChange {
    file_path: String,
    old_path: Option<String>,
    kind: WorkspaceChangeKind,
}

/// 目标路径在重命名 / 复制检测结果里扮演的角色。
///
/// 工作区（`git diff --cached -z`）与提交（`git diff-tree --name-status`）两侧的解析
/// 格式不同，但「目标路径是新路径、旧路径，还是无关」是同一段判定规则，收敛在这里，
/// 避免两侧各写一份。
pub(super) enum RenameRole {
    /// 目标路径是重命名 / 复制的新路径。
    Target {
        kind: WorkspaceChangeKind,
        old_path: String,
    },
    /// 目标路径是重命名 / 复制的旧路径：全量变更列表不把它当成独立条目。
    Source,
    /// 目标路径与重命名 / 复制无关。
    None,
}

pub(super) fn classify_rename_role(
    entries: impl IntoIterator<Item = (WorkspaceChangeKind, String, String)>,
    file_path: &str,
) -> RenameRole {
    let mut target = None;
    let mut is_source = false;

    for (kind, old_path, new_path) in entries {
        if new_path == file_path {
            target = Some((kind, old_path.clone()));
        }
        if old_path == file_path {
            is_source = true;
        }
    }

    match target {
        Some((kind, old_path)) => RenameRole::Target { kind, old_path },
        None if is_source => RenameRole::Source,
        None => RenameRole::None,
    }
}

pub(super) fn read_workspace_diff(
    root: &Path,
    file_path: &str,
) -> Result<WorkspaceDiffContent, CommandError> {
    let change = read_worktree_change(root, file_path)?.ok_or_else(|| {
        workspace_validation_error("文件没有未提交变更。", file_path)
            .with_reason("fileNoUncommittedChanges")
    })?;

    let original = match change.kind {
        WorkspaceChangeKind::Added | WorkspaceChangeKind::Untracked => absent_side(),
        _ => {
            let original_path = change.old_path.as_deref().unwrap_or(&change.file_path);
            read_diff_side_from_git(read_head_file(root, original_path)?, original_path)?
        }
    };
    let modified = match change.kind {
        WorkspaceChangeKind::Deleted => absent_side(),
        _ => read_diff_side_from_workspace(read_workspace_file(root, &change.file_path)?),
    };

    Ok(assemble_diff(
        &change.file_path,
        change.old_path,
        change.kind,
        original,
        modified,
    ))
}

pub(super) fn read_workspace_commit_diff(
    root: &Path,
    commit_hash: &str,
    file_path: &str,
) -> Result<WorkspaceDiffContent, CommandError> {
    let commit_hash = resolve_commit_hash(root, commit_hash)?;
    let change = read_commit_change(root, &commit_hash, file_path)?.ok_or_else(|| {
        workspace_validation_error("文件不属于该提交。", file_path).with_reason("fileNotInCommit")
    })?;
    validate_workspace_relative_path(&change.file_path)?;
    if let Some(old_path) = &change.old_path {
        validate_workspace_relative_path(old_path)?;
    }

    let parent_ref = format!("{commit_hash}^");
    let has_parent = run_git(
        root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{parent_ref}{{commit}}"),
        ],
    )
    .is_ok();

    let original = match change.kind {
        WorkspaceChangeKind::Added | WorkspaceChangeKind::Untracked => absent_side(),
        _ if !has_parent => absent_side(),
        _ => {
            let original_path = change.old_path.as_deref().unwrap_or(&change.file_path);
            read_diff_side_from_git(
                read_git_file(root, &parent_ref, original_path)?,
                original_path,
            )?
        }
    };
    let modified = match change.kind {
        WorkspaceChangeKind::Deleted => absent_side(),
        _ => read_diff_side_from_git(
            read_git_file(root, &commit_hash, &change.file_path)?,
            &change.file_path,
        )?,
    };

    Ok(assemble_diff(
        &change.file_path,
        change.old_path,
        change.kind,
        original,
        modified,
    ))
}

/// 按路径定向读取工作区变更条目：一次限定路径的 `git status`。
///
/// 不再调用 `read_workspace_changes`，因此不付「全量 status + 全量 numstat +
/// 逐文件 metadata + branch sync」的成本。
fn read_worktree_change(
    root: &Path,
    file_path: &str,
) -> Result<Option<WorktreeChange>, CommandError> {
    validate_workspace_relative_path(file_path)?;
    let output = run_git_bytes(
        root,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--",
            &literal_pathspec(file_path),
        ],
    )?;
    let entries = parse_status_entries(&output)?;
    let Some(entry) = entries.into_iter().find(|entry| entry.path == file_path) else {
        return Ok(None);
    };

    let mut kind = entry.kind;
    let mut old_path = entry.old_path;
    // 限定 pathspec 会让 git 关掉重命名检测，A / D 可能是被拆开的重命名。
    if matches!(
        kind,
        WorkspaceChangeKind::Added | WorkspaceChangeKind::Deleted
    ) {
        match resolve_staged_rename(root, file_path)? {
            RenameRole::Target {
                old_path: source, ..
            } => {
                kind = WorkspaceChangeKind::Renamed;
                old_path = Some(source);
            }
            RenameRole::Source => return Ok(None),
            RenameRole::None => {}
        }
    }

    Ok(Some(WorktreeChange {
        file_path: entry.path,
        old_path,
        kind,
    }))
}

/// `git mv a b` 在全量 `git status` 里是一条 `R b\0a`；把 pathspec 限定到单个路径后
/// git 无法再做重命名检测，只会报 `A b`（或 `D a`）。为保持「重命名按 old_path 读原始
/// 内容」的既有语义，只在可能被拆开的 A / D 上补一次暂存区重命名查询。
///
/// 暂存区是唯一会产生 R 的对比（worktree 侧的 mv 在 status 里本就是「被跟踪文件 D +
/// 未跟踪文件 ??」，不会被折叠），因此这里查 `git diff --cached` 即可，既不遍历未跟踪
/// 目录也不做全量 status。`-M` 与 `git status` 的默认重命名检测一致。
fn resolve_staged_rename(root: &Path, file_path: &str) -> Result<RenameRole, CommandError> {
    let output = match run_git_bytes(
        root,
        &[
            "diff",
            "--cached",
            "--name-status",
            "-z",
            "-M",
            "--diff-filter=R",
            "HEAD",
        ],
    ) {
        Ok(output) => output,
        // 没有 HEAD（空仓库首次 add）等场景无法比较暂存区：按「没有重命名」处理，
        // 与全量 status 在这些场景下只会报 A / ?? 的结果一致。
        Err(_) => return Ok(RenameRole::None),
    };

    Ok(classify_rename_role(
        staged_rename_entries(&output),
        file_path,
    ))
}

/// 解析 `git diff --cached --name-status -z --diff-filter=R` 的输出。
fn staged_rename_entries(output: &[u8]) -> Vec<(WorkspaceChangeKind, String, String)> {
    let mut records = output.split(|byte| *byte == b'\0');
    let mut entries = Vec::new();

    // `--diff-filter=R` 保证每条状态记录都形如 `R<score>`，其后跟旧路径、新路径。
    while let Some(record) = records.next() {
        if !record.starts_with(b"R") {
            continue;
        }
        let Some(old_path) = records.next() else {
            break;
        };
        let Some(new_path) = records.next() else {
            break;
        };
        entries.push((
            WorkspaceChangeKind::Renamed,
            String::from_utf8_lossy(old_path).to_string(),
            String::from_utf8_lossy(new_path).to_string(),
        ));
    }

    entries
}

#[cfg(test)]
#[path = "workspace_diff_test_support.rs"]
mod test_support;

#[cfg(test)]
#[path = "workspace_diff_worktree_test.rs"]
mod worktree_tests;

#[cfg(test)]
#[path = "workspace_diff_commit_test.rs"]
mod commit_tests;
