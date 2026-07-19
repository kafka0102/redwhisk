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
