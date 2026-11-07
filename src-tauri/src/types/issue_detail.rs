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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueDetailRecord {
    pub projection: Option<IssueDetailProjection>,
    pub linked_change_request: Option<LinkedChangeRequestSummary>,
    pub writeback_pending: bool,
    pub writeback_error: Option<String>,
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
