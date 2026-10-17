use serde::{Deserialize, Serialize};

/// 已完成 Issue 的只读交互式 resume。不改 Issue 或 Agent Session 状态。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCompletedReviewInput {
    pub project_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCompletedReviewResult {
    pub session_id: i64,
    pub command: String,
    pub working_dir: String,
}
