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

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeLanguageDocumentInput {
    pub project_id: i64,
    pub workspace_path: String,
    pub uri: String,
    pub kind: CodeLanguageDocumentKind,
    #[serde(default)]
    pub language_id: Option<String>,
    #[serde(default)]
    pub version: Option<i32>,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodeLanguageDocumentKind {
    DidOpen,
    DidChange,
    DidClose,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeLanguageDiagnosticsEvent {
    pub project_id: i64,
    pub workspace_path: String,
    pub uri: String,
    pub diagnostics: Vec<CodeLanguageDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeLanguageDiagnostic {
    pub range: CodeLanguageRange,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeLanguageRange {
    pub start: CodeLanguagePosition,
    pub end: CodeLanguagePosition,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeLanguagePosition {
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeLanguageDefinitionInput {
    pub project_id: i64,
    pub workspace_path: String,
    pub uri: String,
    pub position: CodeLanguagePosition,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeLanguageDefinitionResult {
    pub locations: Vec<CodeLanguageLocation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeLanguageLocation {
    pub file_path: String,
    pub range: CodeLanguageRange,
}
