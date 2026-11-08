use serde::{Deserialize, Serialize};

pub const CHANGE_REQUEST_SYNC_CHANGED_EVENT: &str = "change-request-sync-changed";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeRequestSyncOutcome {
    Synced,
    Skipped,
    CredentialExpired,
    CacheFailed,
    Coalesced,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestSyncResult {
    pub outcome: ChangeRequestSyncOutcome,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestSyncChangedEvent {
    pub project_id: i64,
    pub outcome: ChangeRequestSyncOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestFilterCounts {
    pub review_requested: i64,
    pub created_by_me: i64,
    pub all_open: i64,
    pub recently_merged: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestLinkedIssue {
    pub issue_id: i64,
    pub label: String,
    pub link_kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestListRow {
    pub id: i64,
    pub provider: String,
    pub number: i64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub author_login: Option<String>,
    pub source_branch: String,
    pub target_branch: String,
    pub review_decision: Option<String>,
    pub checks_ok: Option<i64>,
    pub checks_failed: Option<i64>,
    pub checks_pending: Option<i64>,
    pub remote_updated_at: i64,
    pub linked_issues: Vec<ChangeRequestLinkedIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuePullRequestRef {
    pub url: String,
    pub change_request_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestListResponse {
    pub rows: Vec<ChangeRequestListRow>,
    pub tab_count: i64,
    pub counts: ChangeRequestFilterCounts,
    pub pull_request_refs: Vec<IssuePullRequestRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestReviewer {
    pub login: String,
    pub state: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestFileChange {
    pub path: String,
    pub additions: i64,
    pub deletions: i64,
    pub patch: Option<String>,
    pub patch_status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestCheckRun {
    pub name: String,
    pub status: String,
    pub duration_ms: Option<i64>,
    pub log_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestDiscussionItem {
    pub author: String,
    pub kind: String,
    pub body: String,
    pub created_at: i64,
    pub state: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestDetail {
    pub id: i64,
    pub provider: String,
    pub number: i64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub body: String,
    pub author_login: Option<String>,
    pub source_branch: String,
    pub target_branch: String,
    pub commit_count: Option<i64>,
    pub additions: Option<i64>,
    pub deletions: Option<i64>,
    pub labels: Vec<String>,
    pub reviewers: Vec<ChangeRequestReviewer>,
    pub mergeable: Option<String>,
    pub merge_state_status: Option<String>,
    pub review_decision: Option<String>,
    pub blocking_reasons: Vec<String>,
    pub merge_method: Option<String>,
    pub merge_commit_sha: Option<String>,
    pub detail_status: String,
    pub detail_error: Option<String>,
    pub files: Vec<ChangeRequestFileChange>,
    pub checks: Vec<ChangeRequestCheckRun>,
    pub reviews: Vec<ChangeRequestDiscussionItem>,
    pub comments: Vec<ChangeRequestDiscussionItem>,
    pub linked_issues: Vec<ChangeRequestLinkedIssue>,
    pub ready_supported: bool,
    pub review_supported: bool,
    pub supported_merge_methods: Vec<String>,
    pub source_branch_deleted: Option<bool>,
}
