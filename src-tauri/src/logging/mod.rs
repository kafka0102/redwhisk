//! 后端关键操作日志。
//!
//! 日志写入 `~/.redwhisk/logs/` 下，按月分割为 `YYYY-MM.log`。
//!
//! - [`Logger`] 在应用启动时初始化一次，全局单例、线程安全。
//! - 写入由后台线程异步完成，业务线程不阻塞；通道满或断开时丢弃日志，绝不影响业务。
//! - 未初始化时（如单测）所有日志调用为 no-op。
//!
//! 关键操作通过 [`info`] / [`info_kv`] 记录；`Result<T, CommandError>` 失败时通过
//! [`CommandResultExt::log_if_error`] 自动记录错误码与 details。

use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::logging::writer::LogWriter;
use crate::types::errors::CommandError;

pub mod writer;

static LOGGER: OnceLock<Logger> = OnceLock::new();

#[derive(Clone)]
pub struct Logger {
    writer: LogWriter,
}

impl Logger {
    /// 以 `~/.redwhisk` 数据目录初始化全局 Logger。重复调用幂等，仅首次生效。
    pub fn init(data_dir: PathBuf) {
        let _ = LOGGER.get_or_init(|| Logger {
            writer: LogWriter::new(data_dir),
        });
    }

    pub fn current() -> Option<&'static Logger> {
        LOGGER.get()
    }

    fn log(&self, entry: LogEntry) {
        self.writer.log(entry);
    }
}

/// 记录关键操作 info 日志。Logger 未初始化时为 no-op。
pub fn info(operation: &str, message: &str) {
    if let Some(logger) = Logger::current() {
        logger.log(LogEntry::new(
            LogLevel::Info,
            operation,
            message,
            Vec::new(),
        ));
    }
}

/// 记录带结构化字段的关键操作 info 日志。Logger 未初始化时为 no-op。
pub fn info_kv(operation: &str, message: &str, kvs: &[(&str, &str)]) {
    if let Some(logger) = Logger::current() {
        let fields = kvs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect();
        logger.log(LogEntry::new(LogLevel::Info, operation, message, fields));
    }
}

/// 记录 command 错误日志，包含错误码与 details。Logger 未初始化时为 no-op。
pub fn error(operation: &str, command_error: &CommandError) {
    if let Some(logger) = Logger::current() {
        logger.log(LogEntry::new(
            LogLevel::Error,
            operation,
            &command_error.message,
            command_error_fields(command_error),
        ));
    }
}

/// 将 `CommandError` 的错误码与 details 序列化为日志字段。
fn command_error_fields(command_error: &CommandError) -> Vec<(String, String)> {
    let mut fields = Vec::new();
    if let Ok(code) = serde_json::to_string(&command_error.code) {
        fields.push(("code".to_string(), code));
    }
    if let Some(details) = command_error.details.as_ref() {
        if let Ok(details_json) = serde_json::to_string(details) {
            fields.push(("details".to_string(), details_json));
        }
    }
    fields
}

/// `Result<T, CommandError>` 失败时自动记录错误日志，原样返回 `Result`。
///
/// 用于在关键操作返回点统一兜底错误日志，避免错误被静默吞掉。
pub trait CommandResultExt<T> {
    fn log_if_error(self, operation: &str) -> Self;
}

impl<T> CommandResultExt<T> for Result<T, CommandError> {
    fn log_if_error(self, operation: &str) -> Self {
        if let Err(command_error) = &self {
            error(operation, command_error);
        }
        self
    }
}

#[derive(Debug, Clone)]
pub(crate) struct LogEntry {
    pub(crate) timestamp_millis: i64,
    pub(crate) level: LogLevel,
    pub(crate) operation: String,
    pub(crate) message: String,
    pub(crate) fields: Vec<(String, String)>,
}

impl LogEntry {
    pub(crate) fn new(
        level: LogLevel,
        operation: &str,
        message: &str,
        fields: Vec<(String, String)>,
    ) -> Self {
        Self {
            timestamp_millis: current_epoch_millis(),
            level,
            operation: operation.to_string(),
            message: message.to_string(),
            fields,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LogLevel {
    Info,
    Error,
}

fn current_epoch_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

    use super::command_error_fields;

    #[test]
    fn command_error_fields_includes_code_and_details() {
        let error = CommandError::new(
            CommandErrorCode::IssueValidationFailed,
            "只有运行中 Issue 可以标记待验收。",
        )
        .with_detail(
            ErrorDetail::new("IssueStatus")
                .with_value("issueId", 1)
                .with_value("status", "backlog"),
        );

        let fields = command_error_fields(&error);
        let code = fields
            .iter()
            .find(|(key, _)| key == "code")
            .map(|(_, value)| value.as_str());
        assert_eq!(code, Some("\"ISSUE_VALIDATION_FAILED\""));

        let details = fields
            .iter()
            .find(|(key, _)| key == "details")
            .map(|(_, value)| value.as_str());
        assert!(
            details.is_some_and(|value| value.contains("IssueStatus")),
            "details: {details:?}"
        );
        assert!(
            details.is_some_and(|value| value.contains("issueId")),
            "details: {details:?}"
        );
    }

    #[test]
    fn command_error_fields_omits_details_when_absent() {
        let error = CommandError::new(CommandErrorCode::IssueNotFound, "Issue 不存在。");
        let fields = command_error_fields(&error);
        assert!(fields.iter().any(|(key, _)| key == "code"));
        assert!(!fields.iter().any(|(key, _)| key == "details"));
    }
}
