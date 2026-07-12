use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfileRecord {
    pub id: i64,
    pub name: String,
    pub avatar_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserProfileInput {
    pub name: Option<String>,
    pub avatar_source_path: Option<String>,
}
