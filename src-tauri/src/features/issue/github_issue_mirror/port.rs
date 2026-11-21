#[cfg(test)]
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteIssueState {
    Open,
    Closed,
}

impl RemoteIssueState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Closed => "closed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteIssue {
    pub external_id: String,
    pub number: i64,
    pub title: String,
    pub body: String,
    pub state: RemoteIssueState,
    pub is_pull_request: bool,
    pub url: String,
    pub author_login: Option<String>,
    pub assignees: Vec<String>,
    pub remote_assignee: Option<crate::types::issue_mirror::IssueBoardAssignee>,
    pub labels: Vec<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForgeIssueListQuery {
    pub assignee: Option<String>,
    pub states: Vec<RemoteIssueState>,
    pub label: Option<String>,
    pub limit: i64,
    pub updated_after: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForgeIssueError {
    CommandFailed,
    Unparseable,
    CliMissing,
    Offline,
    RateLimited,
    Unauthenticated,
    Forbidden,
    NotFound,
    Gone,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForgeIssueDraft {
    pub title: String,
    pub body: String,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteChangeRequest {
    pub external_id: String,
    pub number: i64,
    pub title: String,
    pub body: String,
    pub state: String,
    pub url: String,
    pub author_login: Option<String>,
    pub source_branch: String,
    pub target_branch: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RemoteChangeRequestDetails {
    pub title: String,
    pub body: String,
    pub state: String,
    pub url: String,
    pub author_login: Option<String>,
    pub source_branch: String,
    pub target_branch: String,
    pub commit_count: Option<i64>,
    pub additions: Option<i64>,
    pub deletions: Option<i64>,
    pub labels: Vec<String>,
    pub reviewers: Vec<crate::types::change_request::ChangeRequestReviewer>,
    pub mergeable: Option<String>,
    pub merge_state_status: Option<String>,
    pub review_decision: Option<String>,
    pub blocking_reasons: Vec<String>,
    pub merge_method: Option<String>,
    pub merge_commit_sha: Option<String>,
    pub source_branch_deleted: Option<bool>,
    pub files: Vec<crate::types::change_request::ChangeRequestFileChange>,
    pub checks: Vec<crate::types::change_request::ChangeRequestCheckRun>,
    pub reviews: Vec<crate::types::change_request::ChangeRequestDiscussionItem>,
    pub comments: Vec<crate::types::change_request::ChangeRequestDiscussionItem>,
}

pub trait ForgeIssuePort {
    fn list_issues(&self, query: &ForgeIssueListQuery)
        -> Result<Vec<RemoteIssue>, ForgeIssueError>;

    fn create_issue(&self, draft: &ForgeIssueDraft) -> Result<RemoteIssue, ForgeIssueError> {
        let _ = draft;
        Err(ForgeIssueError::CommandFailed)
    }

    fn list_labels(&self) -> Result<Vec<String>, ForgeIssueError> {
        Ok(Vec::new())
    }

    fn list_change_requests(&self) -> Result<Vec<RemoteChangeRequest>, ForgeIssueError> {
        Ok(Vec::new())
    }

    fn get_change_request_details(
        &self,
        number: i64,
    ) -> Result<RemoteChangeRequestDetails, ForgeIssueError> {
        let _ = number;
        Err(ForgeIssueError::CommandFailed)
    }

    fn mark_change_request_ready(
        &self,
        number: i64,
    ) -> Result<RemoteChangeRequestDetails, ChangeRequestWriteError> {
        let _ = number;
        Err(ChangeRequestWriteError::Unsupported)
    }

    fn supports_change_request_ready(&self) -> bool {
        false
    }

    fn request_change_request_review(
        &self,
        number: i64,
        reviewer: &str,
    ) -> Result<RemoteChangeRequestDetails, ChangeRequestWriteError> {
        let _ = (number, reviewer);
        Err(ChangeRequestWriteError::Unsupported)
    }

    fn supports_change_request_review(&self) -> bool {
        false
    }

    fn close_change_request(
        &self,
        number: i64,
    ) -> Result<RemoteChangeRequestDetails, ChangeRequestWriteError> {
        let _ = number;
        Err(ChangeRequestWriteError::Unsupported)
    }

    fn merge_change_request(
        &self,
        number: i64,
        method: &str,
        delete_source_branch: bool,
    ) -> Result<RemoteChangeRequestDetails, ChangeRequestWriteError> {
        let _ = (number, method, delete_source_branch);
        Err(ChangeRequestWriteError::Unsupported)
    }

    fn supports_change_request_merge_method(&self, method: &str) -> bool {
        let _ = method;
        false
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChangeRequestWriteError {
    Unsupported,
    Failed(ForgeIssueError),
}

#[cfg(test)]
#[derive(Debug)]
pub struct FixedForge {
    pub issues: Vec<RemoteIssue>,
    pub change_requests: Vec<RemoteChangeRequest>,
    pub calls: Mutex<Vec<ForgeIssueListQuery>>,
    pub created: Mutex<Option<RemoteIssue>>,
    pub create_calls: Mutex<Vec<ForgeIssueDraft>>,
    pub error: Mutex<Option<ForgeIssueError>>,
    pub details: Mutex<Option<RemoteChangeRequestDetails>>,
    pub detail_error: Mutex<Option<ForgeIssueError>>,
    pub ready_calls: Mutex<Vec<i64>>,
    pub action_details: Mutex<Option<RemoteChangeRequestDetails>>,
    pub action_error: Mutex<Option<ForgeIssueError>>,
    pub ready_supported: bool,
    pub review_calls: Mutex<Vec<(i64, String)>>,
    pub review_supported: bool,
    pub close_calls: Mutex<Vec<i64>>,
    pub merge_calls: Mutex<Vec<(i64, String, bool)>>,
    pub merge_methods: Vec<String>,
    pub host_labels: Vec<String>,
    pub label_list_calls: Mutex<usize>,
    label_error: Mutex<Option<ForgeIssueError>>,
}

#[cfg(test)]
impl FixedForge {
    pub fn new(issues: Vec<RemoteIssue>) -> Self {
        Self::blank(issues, None)
    }

    fn blank(issues: Vec<RemoteIssue>, error: Option<ForgeIssueError>) -> Self {
        Self {
            issues,
            change_requests: Vec::new(),
            calls: Mutex::new(Vec::new()),
            created: Mutex::new(None),
            create_calls: Mutex::new(Vec::new()),
            error: Mutex::new(error),
            details: Mutex::new(None),
            detail_error: Mutex::new(None),
            ready_calls: Mutex::new(Vec::new()),
            action_details: Mutex::new(None),
            action_error: Mutex::new(None),
            ready_supported: true,
            review_calls: Mutex::new(Vec::new()),
            review_supported: true,
            close_calls: Mutex::new(Vec::new()),
            merge_calls: Mutex::new(Vec::new()),
            merge_methods: ["squash", "merge", "rebase"]
                .into_iter()
                .map(str::to_string)
                .collect(),
            host_labels: Vec::new(),
            label_list_calls: Mutex::new(0),
            label_error: Mutex::new(None),
        }
    }

    pub fn with_change_requests(mut self, change_requests: Vec<RemoteChangeRequest>) -> Self {
        self.change_requests = change_requests;
        self
    }

    pub fn with_created(self, issue: RemoteIssue) -> Self {
        *self.created.lock().expect("created issue") = Some(issue);
        self
    }

    pub fn failing(error: ForgeIssueError) -> Self {
        Self::blank(Vec::new(), Some(error))
    }

    pub fn with_host_labels<I, S>(mut self, labels: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.host_labels = labels.into_iter().map(Into::into).collect();
        self
    }

    pub fn failing_labels(self, error: ForgeIssueError) -> Self {
        *self.label_error.lock().expect("label error") = Some(error);
        self
    }

    pub fn with_detail_error(self, error: ForgeIssueError) -> Self {
        *self.detail_error.lock().expect("detail error") = Some(error);
        self
    }

    pub fn with_details(self, details: RemoteChangeRequestDetails) -> Self {
        *self.details.lock().expect("details") = Some(details);
        self
    }

    pub fn with_action_details(self, details: RemoteChangeRequestDetails) -> Self {
        *self.action_details.lock().expect("action details") = Some(details);
        self
    }

    pub fn ready_calls(&self) -> Vec<i64> {
        self.ready_calls.lock().expect("ready calls").clone()
    }

    pub fn without_ready_support(mut self) -> Self {
        self.ready_supported = false;
        self
    }

    pub fn with_action_error(self, error: ForgeIssueError) -> Self {
        *self.action_error.lock().expect("action error") = Some(error);
        self
    }

    pub fn review_calls(&self) -> Vec<(i64, String)> {
        self.review_calls.lock().expect("review calls").clone()
    }

    pub fn without_review_support(mut self) -> Self {
        self.review_supported = false;
        self
    }

    pub fn close_calls(&self) -> Vec<i64> {
        self.close_calls.lock().expect("close calls").clone()
    }

    pub fn merge_calls(&self) -> Vec<(i64, String, bool)> {
        self.merge_calls.lock().expect("merge calls").clone()
    }

    pub fn without_merge_method(mut self, method: &str) -> Self {
        self.merge_methods.retain(|item| item != method);
        self
    }

    pub fn calls(&self) -> Vec<ForgeIssueListQuery> {
        self.calls.lock().expect("forge calls").clone()
    }
}

#[cfg(test)]
impl ForgeIssuePort for FixedForge {
    fn list_issues(
        &self,
        query: &ForgeIssueListQuery,
    ) -> Result<Vec<RemoteIssue>, ForgeIssueError> {
        self.calls.lock().expect("forge calls").push(query.clone());
        if let Some(error) = self.error.lock().expect("forge error").clone() {
            return Err(error);
        }
        Ok(self.issues.clone())
    }

    fn list_change_requests(&self) -> Result<Vec<RemoteChangeRequest>, ForgeIssueError> {
        if let Some(error) = self.error.lock().expect("forge error").clone() {
            return Err(error);
        }
        Ok(self.change_requests.clone())
    }

    fn create_issue(&self, draft: &ForgeIssueDraft) -> Result<RemoteIssue, ForgeIssueError> {
        self.create_calls
            .lock()
            .expect("create calls")
            .push(draft.clone());
        if let Some(error) = self.error.lock().expect("forge error").clone() {
            return Err(error);
        }
        self.created
            .lock()
            .expect("created issue")
            .clone()
            .ok_or(ForgeIssueError::CommandFailed)
    }

    fn list_labels(&self) -> Result<Vec<String>, ForgeIssueError> {
        *self.label_list_calls.lock().expect("label list") += 1;
        if let Some(error) = self.label_error.lock().expect("label error").clone() {
            return Err(error);
        }
        Ok(self.host_labels.clone())
    }

    fn get_change_request_details(
        &self,
        number: i64,
    ) -> Result<RemoteChangeRequestDetails, ForgeIssueError> {
        let _ = number;
        if let Some(error) = self.detail_error.lock().expect("detail error").clone() {
            return Err(error);
        }
        if let Some(error) = self.error.lock().expect("forge error").clone() {
            return Err(error);
        }
        self.details
            .lock()
            .expect("details")
            .clone()
            .ok_or(ForgeIssueError::CommandFailed)
    }

    fn mark_change_request_ready(
        &self,
        number: i64,
    ) -> Result<RemoteChangeRequestDetails, ChangeRequestWriteError> {
        self.ready_calls.lock().expect("ready calls").push(number);
        if let Some(error) = self.action_error.lock().expect("action error").clone() {
            return Err(ChangeRequestWriteError::Failed(error));
        }
        self.action_details
            .lock()
            .expect("action details")
            .clone()
            .ok_or(ChangeRequestWriteError::Failed(
                ForgeIssueError::CommandFailed,
            ))
    }

    fn supports_change_request_ready(&self) -> bool {
        self.ready_supported
    }

    fn request_change_request_review(
        &self,
        number: i64,
        reviewer: &str,
    ) -> Result<RemoteChangeRequestDetails, ChangeRequestWriteError> {
        self.review_calls
            .lock()
            .expect("review calls")
            .push((number, reviewer.to_string()));
        if let Some(error) = self.action_error.lock().expect("action error").clone() {
            return Err(ChangeRequestWriteError::Failed(error));
        }
        self.action_details
            .lock()
            .expect("action details")
            .clone()
            .ok_or(ChangeRequestWriteError::Failed(
                ForgeIssueError::CommandFailed,
            ))
    }

    fn supports_change_request_review(&self) -> bool {
        self.review_supported
    }

    fn close_change_request(
        &self,
        number: i64,
    ) -> Result<RemoteChangeRequestDetails, ChangeRequestWriteError> {
        self.close_calls.lock().expect("close calls").push(number);
        if let Some(error) = self.action_error.lock().expect("action error").clone() {
            return Err(ChangeRequestWriteError::Failed(error));
        }
        self.action_details
            .lock()
            .expect("action details")
            .clone()
            .ok_or(ChangeRequestWriteError::Failed(
                ForgeIssueError::CommandFailed,
            ))
    }

    fn merge_change_request(
        &self,
        number: i64,
        method: &str,
        delete_source_branch: bool,
    ) -> Result<RemoteChangeRequestDetails, ChangeRequestWriteError> {
        self.merge_calls.lock().expect("merge calls").push((
            number,
            method.to_string(),
            delete_source_branch,
        ));
        if let Some(error) = self.action_error.lock().expect("action error").clone() {
            return Err(ChangeRequestWriteError::Failed(error));
        }
        self.action_details
            .lock()
            .expect("action details")
            .clone()
            .ok_or(ChangeRequestWriteError::Failed(
                ForgeIssueError::CommandFailed,
            ))
    }

    fn supports_change_request_merge_method(&self, method: &str) -> bool {
        self.merge_methods.iter().any(|item| item == method)
    }
}

#[cfg(test)]
pub fn open_issue(number: i64, title: &str) -> RemoteIssue {
    RemoteIssue {
        external_id: format!("issue-{number}"),
        number,
        title: title.to_string(),
        body: String::new(),
        state: RemoteIssueState::Open,
        is_pull_request: false,
        url: format!("https://github.com/acme/redwhisk/issues/{number}"),
        author_login: None,
        assignees: Vec::new(),
        remote_assignee: None,
        labels: Vec::new(),
        updated_at: 1,
    }
}
