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
}

#[cfg(test)]
impl FixedForge {
    pub fn new(issues: Vec<RemoteIssue>) -> Self {
        Self {
            issues,
            change_requests: Vec::new(),
            calls: Mutex::new(Vec::new()),
            created: Mutex::new(None),
            create_calls: Mutex::new(Vec::new()),
            error: Mutex::new(None),
            details: Mutex::new(None),
            detail_error: Mutex::new(None),
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
        Self {
            issues: Vec::new(),
            change_requests: Vec::new(),
            calls: Mutex::new(Vec::new()),
            created: Mutex::new(None),
            create_calls: Mutex::new(Vec::new()),
            error: Mutex::new(Some(error)),
            details: Mutex::new(None),
            detail_error: Mutex::new(None),
        }
    }

    pub fn with_detail_error(self, error: ForgeIssueError) -> Self {
        *self.detail_error.lock().expect("detail error") = Some(error);
        self
    }

    pub fn with_details(self, details: RemoteChangeRequestDetails) -> Self {
        *self.details.lock().expect("details") = Some(details);
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
        labels: Vec::new(),
        updated_at: 1,
    }
}
