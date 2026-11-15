use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadIssueHostAttachmentInput {
    pub project_id: i64,
    pub temp_token: String,
    pub source_path: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadIssueHostAttachmentResult {
    pub markdown: String,
}
