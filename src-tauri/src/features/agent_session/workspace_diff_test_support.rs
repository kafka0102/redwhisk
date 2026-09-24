//! workspace_diff 单测共用的临时 git 仓库助手。

use std::path::Path;

use super::*;

pub(super) use crate::features::agent_session::workspace::tests::{git, init_git_repo};

pub(super) fn commit_all(root: &Path, message: &str) {
    git(root, &["add", "-A"]);
    git(root, &["commit", "-m", message]);
}

pub(super) fn head_hash(root: &Path) -> String {
    run_git(root, &["rev-parse", "HEAD"])
        .expect("read head")
        .trim()
        .to_string()
}

/// 40 行文件 + 单行改动：相似度高于 git 默认 50% 阈值，重命名会被折叠成 R。
/// （单行文件改字符会低于阈值，退化成「新增 + 删除」，那是另一个既有语义。）
pub(super) fn renamed_file_content(second_value: i64) -> String {
    let mut lines = (1..=40)
        .map(|row| format!("const row{row} = {row};\n"))
        .collect::<Vec<_>>();
    lines[0] = format!("const row1 = {second_value};\n");
    lines.concat()
}

pub(super) fn error_reason(result: Result<WorkspaceDiffContent, CommandError>) -> String {
    result
        .expect_err("expected error")
        .reason
        .unwrap_or_default()
}
