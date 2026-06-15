use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueActionRecord {
    pub id: i64,
    pub issue_id: i64,
    pub action_type: IssueActionType,
    pub payload_json: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueActionType {
    IssueCreated,
    AgentSessionStarted,
    IssueReviewMarked,
    IssueStatusChanged,
    IssueCompleted,
    IssueDeleted,
}

impl IssueActionType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::IssueCreated => "issue_created",
            Self::AgentSessionStarted => "agent_session_started",
            Self::IssueReviewMarked => "issue_review_marked",
            Self::IssueStatusChanged => "issue_status_changed",
            Self::IssueCompleted => "issue_completed",
            Self::IssueDeleted => "issue_deleted",
        }
    }
}
