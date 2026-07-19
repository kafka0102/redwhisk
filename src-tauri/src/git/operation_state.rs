use std::path::Path;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GitOperationState {
    None,
    MergeInProgress,
    RebaseInProgress,
    CherryPickInProgress,
    RevertInProgress,
    SequencerInProgress,
    Unmerged,
}

/// 完成流程被 Git 操作阻断时的业务场景，用于生成面向用户的提示。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitOperationBlockContext {
    /// 完成 Issue（complete_issue_flow Begin 守卫）。
    CompleteIssue,
    /// 直接完成路径（legacy complete_issue_clean / manual 错误文案）。
    DirectComplete,
    /// 检测 Agent 是否已提交。
    DetectCommit,
    /// 准备 / 发送 Agent Commit。
    AgentCommit,
}

pub fn format_git_operation_state(state: GitOperationState) -> &'static str {
    match state {
        GitOperationState::None => "none",
        GitOperationState::MergeInProgress => "merge_in_progress",
        GitOperationState::RebaseInProgress => "rebase_in_progress",
        GitOperationState::CherryPickInProgress => "cherry_pick_in_progress",
        GitOperationState::RevertInProgress => "revert_in_progress",
        GitOperationState::SequencerInProgress => "sequencer_in_progress",
        GitOperationState::Unmerged => "unmerged",
    }
}

pub fn detect_operation_state(git_dir: impl AsRef<Path>) -> GitOperationState {
    let git_dir = git_dir.as_ref();

    if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        return GitOperationState::RebaseInProgress;
    }

    if git_dir.join("MERGE_HEAD").exists() {
        return GitOperationState::MergeInProgress;
    }

    if git_dir.join("REVERT_HEAD").exists() {
        return GitOperationState::RevertInProgress;
    }

    if git_dir.join("sequencer").exists() {
        return GitOperationState::SequencerInProgress;
    }

    if git_dir.join("CHERRY_PICK_HEAD").exists() {
        return GitOperationState::CherryPickInProgress;
    }

    GitOperationState::None
}

/// 生成「Git 操作进行中」的详细用户提示：操作类型 + 工作目录 + 手动处理步骤。
pub fn git_operation_blocking_message(
    state: GitOperationState,
    context: GitOperationBlockContext,
    working_dir: Option<&str>,
) -> String {
    let action = match context {
        GitOperationBlockContext::CompleteIssue => "完成 Issue",
        GitOperationBlockContext::DirectComplete => "直接完成 Issue",
        GitOperationBlockContext::DetectCommit => "检测提交",
        GitOperationBlockContext::AgentCommit => "执行 Agent Commit",
    };
    let operation = describe_git_operation(state);
    let (continue_cmd, abort_cmd) = git_operation_resolution_commands(state);

    let mut lines = vec![format!(
        "当前 Git 正在进行中的操作（{operation}）阻止{action}。"
    )];

    if let Some(path) = working_dir.map(str::trim).filter(|path| !path.is_empty()) {
        lines.push(format!("工作目录：{path}"));
    }

    lines.push("请先在终端手动处理该仓库的 Git 状态，再回到 RedWhisk 重试。".to_string());
    lines.push("建议步骤：".to_string());
    lines.push("1. 运行 git status 查看冲突与进行中的操作".to_string());
    lines.push("2. 若有冲突：手动合并代码后执行 git add <文件>".to_string());
    lines.push(format!("3. 继续：{continue_cmd}；或中止：{abort_cmd}"));
    lines.push(
        "4. 确认 git status 不再显示 rebase/merge/cherry-pick 等进行中状态后，再标记完成"
            .to_string(),
    );

    lines.join("\n")
}

fn describe_git_operation(state: GitOperationState) -> &'static str {
    match state {
        GitOperationState::None => "未知操作",
        GitOperationState::MergeInProgress => "合并 merge",
        GitOperationState::RebaseInProgress => "变基 rebase",
        GitOperationState::CherryPickInProgress => "拣选 cherry-pick",
        GitOperationState::RevertInProgress => "回退 revert",
        GitOperationState::SequencerInProgress => "序列操作 sequencer",
        GitOperationState::Unmerged => "未合并冲突 unmerged",
    }
}

fn git_operation_resolution_commands(state: GitOperationState) -> (&'static str, &'static str) {
    match state {
        GitOperationState::MergeInProgress => (
            "解决冲突并 git commit（完成合并）",
            "git merge --abort",
        ),
        GitOperationState::RebaseInProgress => ("git rebase --continue", "git rebase --abort"),
        GitOperationState::CherryPickInProgress => {
            ("git cherry-pick --continue", "git cherry-pick --abort")
        }
        GitOperationState::RevertInProgress => ("git revert --continue", "git revert --abort"),
        GitOperationState::SequencerInProgress => {
            ("按 git status 提示继续当前序列操作", "按 git status 提示中止")
        }
        GitOperationState::Unmerged => (
            "解决冲突后 git add，再提交或继续原操作",
            "按 git status 提示中止原操作",
        ),
        GitOperationState::None => ("按 git status 提示继续", "按 git status 提示中止"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocking_message_includes_operation_path_and_manual_hint() {
        let message = git_operation_blocking_message(
            GitOperationState::RebaseInProgress,
            GitOperationBlockContext::CompleteIssue,
            Some("/tmp/worktrees/issue-128"),
        );

        assert!(message.contains("变基 rebase"), "message: {message}");
        assert!(message.contains("完成 Issue"), "message: {message}");
        assert!(
            message.contains("/tmp/worktrees/issue-128"),
            "message: {message}"
        );
        assert!(message.contains("git rebase --continue"), "message: {message}");
        assert!(message.contains("git rebase --abort"), "message: {message}");
        assert!(message.contains("手动合并"), "message: {message}");
    }
}
