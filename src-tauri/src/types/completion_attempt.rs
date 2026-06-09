use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CompletionAttemptOption {
    CompleteManual,
    CompleteClean,
    AgentAutoCommit,
}

impl CompletionAttemptOption {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CompleteManual => "complete_manual",
            Self::CompleteClean => "complete_clean",
            Self::AgentAutoCommit => "agent_auto_commit",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CompletionAttemptResult {
    Completed,
    PromptSent,
    NoCommitDetected,
    GitOperationBlocked,
}

impl CompletionAttemptResult {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::PromptSent => "prompt_sent",
            Self::NoCommitDetected => "no_commit_detected",
            Self::GitOperationBlocked => "git_operation_blocked",
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
    pub commit_hash: Option<String>,
    pub failure_reason: Option<String>,
    pub changed_files_json: String,
    pub result: CompletionAttemptResult,
    pub created_at: i64,
}
