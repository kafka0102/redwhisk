use serde::{Deserialize, Serialize};

/// 切换一条 Session 的展示形式快照。只携带项目与 Session，目标形式由当前快照对调。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchAgentSessionDisplayModeInput {
    pub project_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchAgentSessionDisplayModeResult {
    pub session_id: i64,
    pub display_mode: String,
    pub provider_session_id: String,
}
