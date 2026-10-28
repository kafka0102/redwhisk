//! 脏工作区处理完之后，决定要不要弹出完成选择。

use crate::types::issue_completion::CloseoutAction;
use crate::types::project::ProjectPrTarget;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseoutRoute {
    /// 未识别宿主：沿用今天的合入。
    Reconcile,
    /// 已在 base，或环境未就绪：不弹窗，直接结束。
    Complete,
    /// 环境就绪且不在 base：弹出选择。
    Prompt,
    /// 用户选了提交 PR/MR。
    OpenPullRequest,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppliedCloseout {
    pub action: CloseoutAction,
    pub base: String,
    pub draft: bool,
}

pub fn route_closeout(
    isolated_worktree: bool,
    branch_mismatch: bool,
    forge_known: bool,
    action: Option<CloseoutAction>,
) -> CloseoutRoute {
    // 没有隔离 worktree，或已经在 base 上：不弹窗，直接完成。
    if !isolated_worktree || !branch_mismatch {
        return CloseoutRoute::Complete;
    }
    if !forge_known {
        return CloseoutRoute::Reconcile;
    }
    match action {
        None => CloseoutRoute::Prompt,
        Some(CloseoutAction::MergeToBase) => CloseoutRoute::Reconcile,
        Some(CloseoutAction::OpenPullRequest) => CloseoutRoute::OpenPullRequest,
    }
}

/// 否，且今天会弹出完成选择窗、本次还没有选择：用已保存动作收尾。
pub fn applied_saved_closeout(
    isolated_worktree: bool,
    branch_mismatch: bool,
    forge_known: bool,
    decided: Option<CloseoutAction>,
    confirm_completion_action: bool,
    saved_action: CloseoutAction,
    saved_target: ProjectPrTarget,
    issue_base: Option<&str>,
    repo_default_branch: Option<&str>,
    draft: bool,
) -> Option<AppliedCloseout> {
    if confirm_completion_action || decided.is_some() {
        return None;
    }
    if route_closeout(isolated_worktree, branch_mismatch, forge_known, None)
        != CloseoutRoute::Prompt
    {
        return None;
    }
    Some(AppliedCloseout {
        action: saved_action,
        base: resolved_saved_base(saved_target, issue_base, repo_default_branch),
        draft,
    })
}

fn resolved_saved_base(
    saved_target: ProjectPrTarget,
    issue_base: Option<&str>,
    repo_default_branch: Option<&str>,
) -> String {
    match saved_target {
        ProjectPrTarget::RepoDefault => repo_default_branch
            .or(issue_base)
            .unwrap_or("main")
            .to_string(),
        ProjectPrTarget::IssueBase => issue_base.unwrap_or("main").to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{route_closeout, CloseoutRoute};
    use crate::types::issue_completion::CloseoutAction;

    #[test]
    fn on_base_completes_without_dialog() {
        assert_eq!(
            route_closeout(true, false, true, None),
            CloseoutRoute::Complete
        );
    }

    #[test]
    fn current_checkout_completes_without_dialog() {
        assert_eq!(
            route_closeout(false, true, true, None),
            CloseoutRoute::Complete
        );
    }

    #[test]
    fn unknown_host_keeps_merge() {
        assert_eq!(
            route_closeout(true, true, false, None),
            CloseoutRoute::Reconcile
        );
    }

    #[test]
    fn known_host_prompts_without_probing_cli() {
        assert_eq!(
            route_closeout(true, true, true, None),
            CloseoutRoute::Prompt
        );
    }

    #[test]
    fn known_host_prompts_then_opens() {
        assert_eq!(
            route_closeout(true, true, true, None),
            CloseoutRoute::Prompt
        );
        assert_eq!(
            route_closeout(true, true, true, Some(CloseoutAction::OpenPullRequest)),
            CloseoutRoute::OpenPullRequest
        );
    }
}
