use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Binary,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspaceInput {
    pub project_id: i64,
    pub session_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspacePathInput {
    pub project_id: i64,
    pub session_id: Option<i64>,
    pub file_path: String,
    pub commit_hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChangedFile {
    pub file_path: String,
    pub old_path: Option<String>,
    pub file_name: String,
    pub kind: WorkspaceChangeKind,
    pub status: String,
    pub additions: i64,
    pub deletions: i64,
    pub is_binary: bool,
    pub content_hash: String,
    pub metadata_signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorktreeChangesResponse {
    pub files: Vec<WorkspaceChangedFile>,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCommitChangedFile {
    pub file_path: String,
    pub old_path: Option<String>,
    pub file_name: String,
    pub kind: WorkspaceChangeKind,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCommitRecord {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author_name: String,
    pub committed_at: i64,
    pub files: Vec<WorkspaceCommitChangedFile>,
    pub is_pushed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pushed_to: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorktreeCommitHistoryResponse {
    pub commits: Vec<WorkspaceCommitRecord>,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceFileTreeNodeKind {
    Directory,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileTreeNode {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: WorkspaceFileTreeNodeKind,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<WorkspaceFileTreeNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorktreeFileTreeResponse {
    pub nodes: Vec<WorkspaceFileTreeNode>,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileContent {
    pub file_path: String,
    pub language: Option<String>,
    pub content: String,
    pub modified_at: Option<i64>,
    pub size_bytes: u64,
    pub is_binary: bool,
    pub is_too_large: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiffContent {
    pub file_path: String,
    pub old_path: Option<String>,
    pub kind: WorkspaceChangeKind,
    pub language: Option<String>,
    pub original_content: String,
    pub modified_content: String,
    pub is_binary: bool,
    pub is_too_large: bool,
}
