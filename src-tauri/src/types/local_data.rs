use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDataStatus {
    pub database_exists: bool,
    pub current_version: Option<String>,
    pub applied_versions: Vec<String>,
}
