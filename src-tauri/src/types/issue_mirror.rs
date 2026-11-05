use serde::{Deserialize, Serialize};

pub const ISSUE_SYNC_CHANGED_EVENT: &str = "issue-sync-changed";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueSyncOutcome {
    Synced,
    Skipped,
    CredentialExpired,
    CacheFailed,
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
