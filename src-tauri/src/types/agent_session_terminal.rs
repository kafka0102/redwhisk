use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteAgentSessionTerminalInput {
    pub project_id: i64,
    pub session_id: i64,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeAgentSessionTerminalInput {
    pub project_id: i64,
    pub session_id: i64,
    pub rows: u16,
    pub cols: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreAgentSessionTerminalInput {
    pub project_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreAgentSessionTerminalResult {
    pub session_id: i64,
    pub sequence: u64,
    pub chunks: Vec<Vec<u8>>,
    pub is_complete: bool,
    pub is_active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeAgentSessionTerminalOutputInput {
    pub project_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAgentSessionTerminalInput {
    pub project_id: i64,
    pub session_id: i64,
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAgentSessionTerminalResult {
    pub session_id: i64,
    pub snapshot: String,
    pub is_active: bool,
}
