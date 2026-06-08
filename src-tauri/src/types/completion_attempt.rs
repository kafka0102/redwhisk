use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CompletionAttemptOption {
    CompleteManual,
    CompleteClean,
}

impl CompletionAttemptOption {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CompleteManual => "complete_manual",
            Self::CompleteClean => "complete_clean",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CompletionAttemptResult {
    Completed,
}

impl CompletionAttemptResult {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionAttemptRecord {
    pub id: i64,
    pub issue_id: i64,
    pub session_id: i64,
    pub option: CompletionAttemptOption,
    pub head_before: String,
    pub head_after: String,
    pub result: CompletionAttemptResult,
    pub created_at: i64,
}
