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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForgeIssueDraft {
    pub title: String,
    pub body: String,
}

pub trait ForgeIssuePort {
    fn list_issues(&self, query: &ForgeIssueListQuery)
        -> Result<Vec<RemoteIssue>, ForgeIssueError>;

    fn create_issue(&self, draft: &ForgeIssueDraft) -> Result<RemoteIssue, ForgeIssueError> {
        let _ = draft;
        Err(ForgeIssueError::CommandFailed)
    }
}

#[cfg(test)]
#[derive(Debug)]
pub struct FixedForge {
    pub issues: Vec<RemoteIssue>,
    pub calls: Mutex<Vec<ForgeIssueListQuery>>,
    pub created: Mutex<Option<RemoteIssue>>,
    pub create_calls: Mutex<Vec<ForgeIssueDraft>>,
    pub error: Mutex<Option<ForgeIssueError>>,
}

#[cfg(test)]
impl FixedForge {
    pub fn new(issues: Vec<RemoteIssue>) -> Self {
        Self {
            issues,
            calls: Mutex::new(Vec::new()),
            created: Mutex::new(None),
            create_calls: Mutex::new(Vec::new()),
            error: Mutex::new(None),
        }
    }

    pub fn with_created(self, issue: RemoteIssue) -> Self {
        *self.created.lock().expect("created issue") = Some(issue);
        self
    }

    pub fn failing(error: ForgeIssueError) -> Self {
        Self {
            issues: Vec::new(),
            calls: Mutex::new(Vec::new()),
            created: Mutex::new(None),
            create_calls: Mutex::new(Vec::new()),
            error: Mutex::new(Some(error)),
        }
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
