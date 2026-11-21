use serde::{Deserialize, Serialize};

use super::issue::{IssueRecord, IssueStatusTotals};

pub const ISSUE_SYNC_CHANGED_EVENT: &str = "issue-sync-changed";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueBoardAssignee {
    pub login: String,
    pub name: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueSyncOutcome {
    Synced,
    Skipped,
    CredentialExpired,
    CacheFailed,
    Coalesced,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueSyncResult {
    pub outcome: IssueSyncOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueSyncStatus {
    pub last_synced_at: Option<i64>,
    pub sync_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueSyncChangedEvent {
    pub project_id: i64,
    pub outcome: IssueSyncOutcome,
}

/// `list_issues` 的单条记录。`issue` 被展平进同一 JSON 对象，parity 按展平后的字段核对。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueBoardRecord {
    #[serde(flatten)]
    pub issue: IssueRecord,
    pub source: String,
    pub provider: Option<String>,
    pub external_number: Option<i64>,
    pub remote_state: Option<String>,
    pub remote_labels: Vec<String>,
    pub sync_status: Option<String>,
    pub remote_closed_while_running: bool,
    pub remote_reopened: bool,
    pub pull_request_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_assignee: Option<IssueBoardAssignee>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueBoardListResponse {
    pub issues: Vec<IssueBoardRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_totals: Option<IssueStatusTotals>,
}
