use crate::git::forge::ForgeHost;
use crate::types::project::ProjectCompletionAction;

pub struct CompletionSuggestion {
    pub host: String,
    pub completion_action: ProjectCompletionAction,
    pub confirm_completion_action: bool,
}

/// `saved` 来自已保存的来源类别。other / none 没有同类，不采用保存值。
pub fn completion_suggestion(
    host: ForgeHost,
    saved: Option<(ProjectCompletionAction, bool)>,
) -> CompletionSuggestion {
    let saved = if host == ForgeHost::None { None } else { saved };
    CompletionSuggestion {
        host: host.as_str().to_string(),
        completion_action: saved
            .map(|(action, _)| action)
            .unwrap_or(ProjectCompletionAction::MergeToBase),
        confirm_completion_action: saved.map(|(_, confirm)| confirm).unwrap_or(false),
    }
}
