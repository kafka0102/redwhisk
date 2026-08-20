use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeLanguageHostInput {
    pub project_id: i64,
    pub workspace_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeLanguageHostStatus {
    pub status: CodeLanguageHostStatusKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<CodeLanguageUnavailableReason>,
}

impl CodeLanguageHostStatus {
    pub fn ready() -> Self {
        Self {
            status: CodeLanguageHostStatusKind::Ready,
            reason: None,
        }
    }

    pub fn unavailable(reason: CodeLanguageUnavailableReason) -> Self {
        Self {
            status: CodeLanguageHostStatusKind::Unavailable,
            reason: Some(reason),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodeLanguageHostStatusKind {
    Ready,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodeLanguageUnavailableReason {
    NodeNotFound,
    SpawnFailed,
}
