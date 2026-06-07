use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEventRecord {
    pub id: i64,
    pub session_id: i64,
    pub event_type: SessionEventType,
    pub payload_json: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionEventType {
    SessionStarted,
    SessionExited,
    SessionPromptInjected,
    SessionAttentionRequested,
    SessionAttentionCleared,
}

impl SessionEventType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SessionStarted => "session_started",
            Self::SessionExited => "session_exited",
            Self::SessionPromptInjected => "session_prompt_injected",
            Self::SessionAttentionRequested => "session_attention_requested",
            Self::SessionAttentionCleared => "session_attention_cleared",
        }
    }
}
