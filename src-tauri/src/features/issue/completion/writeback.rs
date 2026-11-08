//! 本地完成已经成立之后的远程写回决策。不新增完成 phase。

use crate::features::issue::github_issue_mirror::{ForgeIssueError, RemoteIssueState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CompletionMethod {
    MergeToBase,
    OpenPullRequest,
}

impl CompletionMethod {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::MergeToBase => "merge_to_base",
            Self::OpenPullRequest => "open_pull_request",
        }
    }

    pub(crate) fn parse(value: &str) -> Self {
        if value == Self::OpenPullRequest.as_str() {
            Self::OpenPullRequest
        } else {
            Self::MergeToBase
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CompletionWriteback {
    pub remote_state: RemoteIssueState,
    pub close_remote_after_completion: bool,
    pub comment_summary: bool,
    pub completion: CompletionMethod,
    pub local_completed: bool,
    pub summary: String,
    pub existing_open_pull_request: Option<String>,
    pub merged_change_request: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct WritebackBook {
    pub close_done: bool,
    pub comment_done: bool,
    pub pending_error: Option<String>,
    pub linked_pull_request: Option<String>,
}

pub(crate) trait CompletionForge {
    fn close_issue(&self) -> Result<(), ForgeIssueError>;
    fn comment_issue(&self, body: &str) -> Result<(), ForgeIssueError>;
}

pub(crate) fn apply_completion_writeback(
    forge: &impl CompletionForge,
    book: &mut WritebackBook,
    request: &CompletionWriteback,
) -> Result<(), ForgeIssueError> {
    if !request.local_completed {
        return Ok(());
    }
    if request.completion == CompletionMethod::OpenPullRequest {
        if let Some(url) = nonempty(request.existing_open_pull_request.clone()) {
            book.linked_pull_request = Some(url);
        }
    }
    if should_close(request) && !book.close_done {
        if request.remote_state != RemoteIssueState::Closed {
            forge.close_issue().map_err(|error| {
                book.pending_error = Some(error_reason(&error).to_string());
                error
            })?;
        }
        book.close_done = true;
    }
    if request.comment_summary && !book.comment_done && !request.summary.trim().is_empty() {
        forge.comment_issue(&request.summary).map_err(|error| {
            book.pending_error = Some(error_reason(&error).to_string());
            error
        })?;
        book.comment_done = true;
    }
    book.pending_error = None;
    Ok(())
}

fn should_close(request: &CompletionWriteback) -> bool {
    request.local_completed
        && request.close_remote_after_completion
        && (request.completion == CompletionMethod::MergeToBase || request.merged_change_request)
}

fn nonempty(value: Option<String>) -> Option<String> {
    value.filter(|url| !url.trim().is_empty())
}

pub(crate) fn error_reason(error: &ForgeIssueError) -> &'static str {
    match error {
        ForgeIssueError::Unauthenticated => "writebackUnauthenticated",
        ForgeIssueError::Forbidden => "writebackForbidden",
        ForgeIssueError::Offline => "writebackOffline",
        _ => "writebackUnavailable",
    }
}

#[cfg(test)]
pub(crate) struct FakeForge {
    closes: std::sync::Mutex<usize>,
    comments: std::sync::Mutex<Vec<String>>,
    attempts: std::sync::Mutex<usize>,
    error: std::sync::Mutex<Option<ForgeIssueError>>,
}

#[cfg(test)]
impl FakeForge {
    pub(crate) fn open() -> Self {
        Self {
            closes: std::sync::Mutex::new(0),
            comments: std::sync::Mutex::new(Vec::new()),
            attempts: std::sync::Mutex::new(0),
            error: std::sync::Mutex::new(None),
        }
    }

    pub(crate) fn failing(error: ForgeIssueError) -> Self {
        let forge = Self::open();
        *forge.error.lock().expect("error") = Some(error);
        forge
    }

    pub(crate) fn clear_error(&self) {
        *self.error.lock().expect("error") = None;
    }

    pub(crate) fn close_count(&self) -> usize {
        *self.closes.lock().expect("closes")
    }

    pub(crate) fn comments(&self) -> Vec<String> {
        self.comments.lock().expect("comments").clone()
    }

    pub(crate) fn attempts(&self) -> usize {
        *self.attempts.lock().expect("attempts")
    }
}

#[cfg(test)]
impl CompletionForge for FakeForge {
    fn close_issue(&self) -> Result<(), ForgeIssueError> {
        *self.attempts.lock().expect("attempts") += 1;
        if let Some(error) = self.error.lock().expect("error").clone() {
            return Err(error);
        }
        *self.closes.lock().expect("closes") += 1;
        Ok(())
    }

    fn comment_issue(&self, body: &str) -> Result<(), ForgeIssueError> {
        *self.attempts.lock().expect("attempts") += 1;
        if let Some(error) = self.error.lock().expect("error").clone() {
            return Err(error);
        }
        self.comments
            .lock()
            .expect("comments")
            .push(body.to_string());
        Ok(())
    }
}

#[cfg(test)]
pub(crate) fn merge_request(close: bool, comment: bool) -> CompletionWriteback {
    CompletionWriteback {
        remote_state: RemoteIssueState::Open,
        close_remote_after_completion: close,
        comment_summary: comment,
        completion: CompletionMethod::MergeToBase,
        local_completed: true,
        summary: "Shipped the flow".to_string(),
        existing_open_pull_request: None,
        merged_change_request: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_to_base_closes_remote_once() {
        let forge = FakeForge::open();
        let mut book = WritebackBook::default();
        let request = merge_request(true, false);

        apply_completion_writeback(&forge, &mut book, &request).expect("first writeback");
        assert_eq!(forge.close_count(), 1);

        apply_completion_writeback(&forge, &mut book, &request).expect("repeated writeback");
        assert_eq!(forge.close_count(), 1);
    }
}
