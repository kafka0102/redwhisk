use super::state_machine::{
    advance, CompletionEvent, CompletionState, CompletionWorld, Effect, FailurePolicy, Transition,
};
use crate::git::operation_state::GitOperationState;
use crate::git::status::{GitChangedFile, GitSnapshot};
use crate::types::agent_session::WorkspaceMode;
use crate::types::agent_session::WorktreeOwner;
use crate::types::completion_attempt::CompletionAttemptOption;
use crate::types::issue::IssueStatus;
use crate::types::issue_completion::{CloseoutAction, IssueCompletionPhase};
use crate::types::project::ProjectPrTarget;

fn clean_snapshot() -> GitSnapshot {
    GitSnapshot {
        head: "deadbeef".to_string(),
        status_porcelain: String::new(),
        changed_files: vec![],
        operation_state: GitOperationState::None,
        is_clean: true,
    }
}

fn dirty_snapshot() -> GitSnapshot {
    GitSnapshot {
        head: "deadbeef".to_string(),
        status_porcelain: " M src/a.rs".to_string(),
        changed_files: vec![GitChangedFile {
            path: "src/a.rs".to_string(),
            status: "modified".to_string(),
            old_path: None,
        }],
        operation_state: GitOperationState::None,
        is_clean: false,
    }
}

fn worktree_world(owner: WorktreeOwner, mismatch: bool) -> CompletionWorld {
    let mut world = CompletionWorld {
        issue_status: IssueStatus::Review,
        workspace_mode: WorkspaceMode::Worktree,
        workspace_missing: false,
        owner,
        target_branch: Some("main".to_string()),
        current_branch: Some("main".to_string()),
        branch_mismatch: mismatch,
        forge_known: false,
        actual_path: "/repo".to_string(),
        drifted: false,
        session_closed_out: false,
        missing_worktree_error: None,
        snapshot: clean_snapshot(),
        attempt_option: CompletionAttemptOption::CompleteManual,
        confirm_completion_action: false,
        saved_closeout_action: CloseoutAction::MergeToBase,
        saved_pr_target: ProjectPrTarget::IssueBase,
        repo_default_branch: None,
        saved_closeout_draft: true,
    };
    if mismatch {
        world.current_branch = Some("issue-1".to_string());
    }
    world
}

fn detecting() -> CompletionState {
    CompletionState::detecting()
}

fn assert_phase(transition: &Transition, phase: IssueCompletionPhase) {
    assert_eq!(
        transition.new_state.phase, phase,
        "expected phase {:?}",
        phase
    );
}

#[test]
fn ready_forge_skips_closeout_prompt_when_confirmation_is_declined() {
    let mut world = worktree_world(WorktreeOwner::Redwhisk, true);
    world.forge_known = true;
    world.confirm_completion_action = false;
    world.saved_closeout_action = CloseoutAction::MergeToBase;
    world.saved_pr_target = ProjectPrTarget::IssueBase;
    world.saved_closeout_draft = false;
    let transition = advance(&detecting(), &world, CompletionEvent::Begin).unwrap();
    assert_ne!(
        transition.new_state.phase,
        IssueCompletionPhase::PromptingCloseoutAction
    );
    assert_eq!(
        transition.new_state.closeout_action,
        Some(CloseoutAction::MergeToBase)
    );
    assert!(!transition.new_state.closeout_draft);
    assert!(matches!(
        transition.effects.first(),
        Some(Effect::AttemptRebaseAndCleanup {
            on_failure: FailurePolicy::Block
        })
    ));
}

#[test]
fn ready_forge_publishes_saved_draft_on_repo_default_without_prompt() {
    let mut world = worktree_world(WorktreeOwner::Redwhisk, true);
    world.forge_known = true;
    world.confirm_completion_action = false;
    world.saved_closeout_action = CloseoutAction::OpenPullRequest;
    world.saved_pr_target = ProjectPrTarget::RepoDefault;
    world.repo_default_branch = Some("trunk".to_string());
    world.target_branch = Some("issue-base".to_string());
    world.saved_closeout_draft = true;
    let transition = advance(&detecting(), &world, CompletionEvent::Begin).unwrap();
    assert_phase(&transition, IssueCompletionPhase::Completed);
    assert_ne!(
        transition.new_state.phase,
        IssueCompletionPhase::PromptingCloseoutAction
    );
    assert_eq!(
        transition.new_state.closeout_action,
        Some(CloseoutAction::OpenPullRequest)
    );
    assert!(transition.new_state.closeout_draft);
    match transition.effects.first() {
        Some(Effect::PublishPullRequest {
            base,
            draft: true,
            on_failure: FailurePolicy::Block,
        }) => assert_eq!(base, "trunk"),
        other => panic!("expected draft publish on trunk, got {other:?}"),
    }
}

#[test]
fn ready_forge_publishes_issue_base_without_draft_when_confirmation_is_declined() {
    let mut world = worktree_world(WorktreeOwner::Redwhisk, true);
    world.forge_known = true;
    world.confirm_completion_action = false;
    world.saved_closeout_action = CloseoutAction::OpenPullRequest;
    world.saved_pr_target = ProjectPrTarget::IssueBase;
    world.repo_default_branch = Some("trunk".to_string());
    world.target_branch = Some("issue-base".to_string());
    world.saved_closeout_draft = false;
    let transition = advance(&detecting(), &world, CompletionEvent::Begin).unwrap();
    assert_ne!(
        transition.new_state.phase,
        IssueCompletionPhase::PromptingCloseoutAction
    );
    assert!(!transition.new_state.closeout_draft);
    match transition.effects.first() {
        Some(Effect::PublishPullRequest {
            base, draft: false, ..
        }) => assert_eq!(base, "issue-base"),
        other => panic!("expected non-draft publish on issue base, got {other:?}"),
    }
}

#[test]
fn ready_forge_still_prompts_when_confirmation_is_enabled() {
    let mut world = worktree_world(WorktreeOwner::Redwhisk, true);
    world.forge_known = true;
    world.confirm_completion_action = true;
    world.saved_closeout_action = CloseoutAction::OpenPullRequest;
    world.saved_closeout_draft = true;
    let transition = advance(&detecting(), &world, CompletionEvent::Begin).unwrap();
    assert_phase(&transition, IssueCompletionPhase::PromptingCloseoutAction);
    assert_eq!(transition.new_state.closeout_action, None);
    assert!(transition.effects.is_empty());
}

#[test]
fn on_base_completes_without_prompt_even_when_confirmation_is_enabled() {
    let mut world = worktree_world(WorktreeOwner::Redwhisk, false);
    world.forge_known = true;
    world.confirm_completion_action = true;
    let transition = advance(&detecting(), &world, CompletionEvent::Begin).unwrap();
    assert_phase(&transition, IssueCompletionPhase::Completed);
    assert!(matches!(
        transition.effects.first(),
        Some(Effect::CommitCompletion { .. })
    ));
    assert!(transition
        .effects
        .iter()
        .all(|effect| !matches!(effect, Effect::AttemptRebaseAndCleanup { .. })));
}

#[test]
fn unknown_forge_merges_without_prompt_even_when_confirmation_is_enabled() {
    let mut world = worktree_world(WorktreeOwner::Redwhisk, true);
    world.forge_known = false;
    world.confirm_completion_action = true;
    let transition = advance(&detecting(), &world, CompletionEvent::Begin).unwrap();
    assert_phase(&transition, IssueCompletionPhase::Completed);
    assert_ne!(
        transition.new_state.phase,
        IssueCompletionPhase::PromptingCloseoutAction
    );
    assert!(matches!(
        transition.effects.first(),
        Some(Effect::AttemptRebaseAndCleanup { .. })
    ));
}

#[test]
fn dirty_workspace_still_prompts_when_confirmation_is_declined() {
    let mut world = worktree_world(WorktreeOwner::Redwhisk, true);
    world.snapshot = dirty_snapshot();
    world.forge_known = true;
    world.confirm_completion_action = false;
    world.saved_closeout_action = CloseoutAction::MergeToBase;
    let transition = advance(&detecting(), &world, CompletionEvent::Begin).unwrap();
    assert_phase(&transition, IssueCompletionPhase::PromptingDirtyDecision);
}

#[test]
fn external_worktree_cleanup_still_prompts_when_confirmation_is_declined() {
    let mut world = worktree_world(WorktreeOwner::External, true);
    world.forge_known = true;
    world.confirm_completion_action = false;
    world.saved_closeout_action = CloseoutAction::MergeToBase;
    let transition = advance(&detecting(), &world, CompletionEvent::Begin).unwrap();
    assert_phase(&transition, IssueCompletionPhase::ConfirmingWorktreeCleanup);
}
