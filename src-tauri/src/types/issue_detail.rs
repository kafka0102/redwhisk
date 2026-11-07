use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetIssueDetailInput {
    pub project_id: i64,
    pub issue_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryIssueCompletionWritebackInput {
    pub project_id: i64,
    pub issue_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyIssueRecoveryInput {
    pub project_id: i64,
    pub issue_id: i64,
    pub action: RecoveryAction,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueDetailRecord {
    pub projection: Option<IssueDetailProjection>,
    pub linked_change_request: Option<LinkedChangeRequestSummary>,
    pub writeback_pending: bool,
    pub writeback_error: Option<String>,
    pub unavailable_banner: Option<UnavailableBanner>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnavailableBanner {
    pub actions: Vec<RecoveryAction>,
    pub shows_delete_confirmation: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryAction {
    KeepLocal,
    Unlink,
    Retry,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueDetailProjection {
    pub provider: String,
    pub repo: String,
    pub external_url: String,
    pub remote_state: String,
    pub author_login: Option<String>,
    pub assignees: Vec<String>,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedChangeRequestSummary {
    pub url: String,
    pub number: Option<i64>,
    pub state: Option<String>,
    pub checks_label: Option<String>,
    pub title: Option<String>,
    pub source_branch: Option<String>,
    pub target_branch: Option<String>,
}
