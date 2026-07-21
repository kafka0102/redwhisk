//! Session 展示形式快照 → 运行时传输选择（ADR-0022）。
//! 不回读 profile；调用方传入 session / launch 已持久化的 display_mode 字符串。

use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SessionDisplayMode {
    Json,
    Tui,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RuntimeTransport {
    StructuredJson,
    InteractiveTui,
}

pub(crate) fn parse_session_display_mode(raw: &str) -> Result<SessionDisplayMode, CommandError> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "json" => Ok(SessionDisplayMode::Json),
        "tui" => Ok(SessionDisplayMode::Tui),
        other => Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "不支持的 Session 展示形式快照。",
        )
        .with_reason("invalidDisplayMode")
        .with_detail(ErrorDetail::new("Field").with_value("name", "displayMode"))
        .with_detail(ErrorDetail::new("Value").with_value("displayMode", other.to_string()))),
    }
}

pub(crate) fn runtime_transport(mode: SessionDisplayMode) -> RuntimeTransport {
    match mode {
        SessionDisplayMode::Json => RuntimeTransport::StructuredJson,
        SessionDisplayMode::Tui => RuntimeTransport::InteractiveTui,
    }
}

pub(crate) fn runtime_transport_from_raw(raw: &str) -> Result<RuntimeTransport, CommandError> {
    Ok(runtime_transport(parse_session_display_mode(raw)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_json_and_tui() {
        assert_eq!(
            parse_session_display_mode("json").unwrap(),
            SessionDisplayMode::Json
        );
        assert_eq!(
            parse_session_display_mode("tui").unwrap(),
            SessionDisplayMode::Tui
        );
        assert_eq!(
            parse_session_display_mode(" JSON ").unwrap(),
            SessionDisplayMode::Json
        );
    }

    #[test]
    fn reject_unknown_display_mode() {
        let err = parse_session_display_mode("pty").unwrap_err();
        assert_eq!(err.reason.as_deref(), Some("invalidDisplayMode"));
    }

    #[test]
    fn transport_mapping() {
        assert_eq!(
            runtime_transport(SessionDisplayMode::Json),
            RuntimeTransport::StructuredJson
        );
        assert_eq!(
            runtime_transport(SessionDisplayMode::Tui),
            RuntimeTransport::InteractiveTui
        );
    }
}
