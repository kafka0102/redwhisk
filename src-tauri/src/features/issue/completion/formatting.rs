use crate::features::issue::completion::git_reconcile::WorktreeMergeBlockDescription;
use crate::types::completion_attempt::CompletionAttemptOption;
use crate::types::issue_completion::IssueCompletionPhase;

pub(crate) fn completion_session_close_reason(option: CompletionAttemptOption) -> &'static str {
    match option {
        CompletionAttemptOption::CompleteManual => "manual_completion",
        CompletionAttemptOption::CompleteClean => "clean_completion",
    }
}

pub(crate) fn completion_message(
    phase: IssueCompletionPhase,
    merge_block: Option<&WorktreeMergeBlockDescription>,
) -> String {
    match phase {
        IssueCompletionPhase::Completed => "Issue 已完成。".to_string(),
        IssueCompletionPhase::Cancelled => "完成已取消，Issue 保持待验收。".to_string(),
        IssueCompletionPhase::Blocked => match merge_block {
            Some(block) => block.message.clone(),
            None => "Agent worktree 缺失且无法确认分支已合入，请手动处理。".to_string(),
        },
        IssueCompletionPhase::PromptingDirtyDecision => {
            "当前工作区存在未提交改动，请选择自动提交 / 不提交 / 取消。".to_string()
        }
        IssueCompletionPhase::AutoCommitting => {
            "已请求 Agent 自动提交，请在 session 中完成提交后再次确认。".to_string()
        }
        IssueCompletionPhase::ConfirmingWorktreeCleanup => {
            "当前使用外部 worktree，请确认是否合并并删除该 worktree。".to_string()
        }
        IssueCompletionPhase::ConfirmingContinueAfterCommit => {
            "代码已提交成功。确定继续标记完成吗？".to_string()
        }
        IssueCompletionPhase::DetectingWorkspace | IssueCompletionPhase::ReconcilingWorktree => {
            "Issue 已完成。".to_string()
        }
    }
}

pub(crate) fn build_agent_commit_completion_prompt(issue_title: &str, head: &str) -> String {
    format!(
        "请获取本次修改相关的代码，检查当前 Issue 涉及的文件变更；只暂存并提交与本次 Issue 直接相关的文件，不要提交无关改动。\n\
Issue: {issue_title}\n\
当前 HEAD: {head}\n\
要求：\n\
- 只包含当前 Issue 直接相关文件\n\
- 不要提交无关改动\n\
- 先自检再提交\n\
- 使用中文 Conventional Commit\n\
- 完成后请回复 commit hash、提交结果与验证命令\n"
    )
}
