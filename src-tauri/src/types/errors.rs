use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::db::connection::DatabaseError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CommandErrorCode {
    LocalDataInitializationFailed,
    ProjectPersistenceFailed,
    ProjectRepoNotGitRepository,
    ProjectRepoPathInvalid,
    ProjectRepoPathUnavailable,
    ProjectNotFound,
    UnknownCommandError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: CommandErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Vec<ErrorDetail>>,
}

impl CommandError {
    pub fn new(code: CommandErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }

    pub fn with_detail(mut self, detail: ErrorDetail) -> Self {
        self.details.get_or_insert_with(Vec::new).push(detail);
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorDetail {
    #[serde(rename = "@type")]
    detail_type: String,
    #[serde(flatten)]
    values: Map<String, Value>,
}

impl ErrorDetail {
    pub fn new(detail_type: impl Into<String>) -> Self {
        Self {
            detail_type: detail_type.into(),
            values: Map::new(),
        }
    }

    pub fn with_value(mut self, key: impl Into<String>, value: impl Into<Value>) -> Self {
        self.values.insert(key.into(), value.into());
        self
    }
}

impl From<DatabaseError> for CommandError {
    fn from(error: DatabaseError) -> Self {
        let mut command_error = CommandError::new(
            CommandErrorCode::LocalDataInitializationFailed,
            "本地数据初始化失败。",
        );

        match error {
            DatabaseError::CreateDataDir { path, source } => {
                command_error = command_error
                    .with_detail(
                        ErrorDetail::new("DatabasePath")
                            .with_value("path", path.to_string_lossy().to_string()),
                    )
                    .with_detail(
                        ErrorDetail::new("Cause").with_value("message", source.to_string()),
                    );
            }
            DatabaseError::OpenDatabase { path, source } => {
                command_error = command_error
                    .with_detail(
                        ErrorDetail::new("DatabasePath")
                            .with_value("path", path.to_string_lossy().to_string()),
                    )
                    .with_detail(
                        ErrorDetail::new("Cause").with_value("message", source.to_string()),
                    );
            }
            DatabaseError::Migration(source) => {
                command_error = command_error.with_detail(
                    ErrorDetail::new("Cause").with_value("message", source.to_string()),
                );
            }
        }

        command_error
    }
}
