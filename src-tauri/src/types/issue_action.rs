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

/// Issue 动作的操作者。按 `actor_kind` 二选一：
/// 用户操作者携带用户档案 id；Agent 操作者携带 Agent 配置 id 与发表时的名称快照
/// （配置改名或删除后历史仍可读）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IssueActionActor {
    User {
        profile_id: i64,
    },
    Agent {
        profile_id: i64,
        name_snapshot: String,
    },
}

impl IssueActionActor {
    /// 稳定字符串，写入 `issue_actions.actor_kind`。
    pub fn kind_str(&self) -> &'static str {
        match self {
            Self::User { .. } => "user",
            Self::Agent { .. } => "agent",
        }
    }
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
    IssueCommentAdded,
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
            Self::IssueCommentAdded => "issue_comment_added",
        }
    }
}
