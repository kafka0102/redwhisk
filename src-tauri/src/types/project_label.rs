use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectLabelScope {
    Project,
    Global,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLabelRecord {
    pub id: i64,
    pub name: String,
    pub scope: ProjectLabelScope,
    pub project_id: Option<i64>,
    pub color: String,
    pub workflow_skill: Option<String>,
    pub del: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectLabelsInput {
    pub scope: ProjectLabelScope,
    pub project_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLabelListResponse {
    pub labels: Vec<ProjectLabelRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProjectLabelInput {
    pub id: Option<i64>,
    pub name: String,
    pub scope: ProjectLabelScope,
    pub project_id: Option<i64>,
    pub color: String,
    pub workflow_skill: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectLabelInput {
    pub id: i64,
}
