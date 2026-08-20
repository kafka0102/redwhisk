use serde_json::{json, Value};

use crate::types::code_language::{
    CodeLanguageDiagnostic, CodeLanguageDocumentInput, CodeLanguageDocumentKind,
    CodeLanguagePosition, CodeLanguageRange,
};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};

pub fn document_notification_payload(
    input: &CodeLanguageDocumentInput,
) -> Result<Value, CommandError> {
    let uri = input.uri.trim();
    if uri.is_empty() {
        return Err(document_error("documentUriRequired", "文档 URI 不能为空。"));
    }

    match input.kind {
        CodeLanguageDocumentKind::DidOpen => {
            let language_id =
                required_text(input.language_id.as_deref(), "documentLanguageRequired")?;
            let version = required_version(input.version)?;
            let text = required_owned_text(input.text.as_deref(), "documentTextRequired")?;
            Ok(json!({
                "jsonrpc": "2.0",
                "method": "textDocument/didOpen",
                "params": {
                    "textDocument": {
                        "uri": uri,
                        "languageId": language_id,
                        "version": version,
                        "text": text
                    }
                }
            }))
        }
        CodeLanguageDocumentKind::DidChange => {
            let version = required_version(input.version)?;
            let text = required_owned_text(input.text.as_deref(), "documentTextRequired")?;
            Ok(json!({
                "jsonrpc": "2.0",
                "method": "textDocument/didChange",
                "params": {
                    "textDocument": {
                        "uri": uri,
                        "version": version
                    },
                    "contentChanges": [{ "text": text }]
                }
            }))
        }
        CodeLanguageDocumentKind::DidClose => Ok(json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didClose",
            "params": {
                "textDocument": { "uri": uri }
            }
        })),
    }
}

pub fn parse_publish_diagnostics(message: &Value) -> Option<(String, Vec<CodeLanguageDiagnostic>)> {
    if message.get("method")?.as_str()? != "textDocument/publishDiagnostics" {
        return None;
    }
    let params = message.get("params")?;
    let uri = params.get("uri")?.as_str()?.to_string();
    let diagnostics = params
        .get("diagnostics")?
        .as_array()?
        .iter()
        .filter_map(parse_diagnostic)
        .collect();
    Some((uri, diagnostics))
}

fn parse_diagnostic(value: &Value) -> Option<CodeLanguageDiagnostic> {
    let range = value.get("range")?;
    Some(CodeLanguageDiagnostic {
        range: CodeLanguageRange {
            start: parse_position(range.get("start")?)?,
            end: parse_position(range.get("end")?)?,
        },
        message: value.get("message")?.as_str()?.to_string(),
        severity: value
            .get("severity")
            .and_then(Value::as_i64)
            .map(|severity| severity as i32),
        source: value
            .get("source")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        code: parse_code(value.get("code")),
    })
}

fn parse_position(value: &Value) -> Option<CodeLanguagePosition> {
    Some(CodeLanguagePosition {
        line: value.get("line")?.as_u64()? as u32,
        character: value.get("character")?.as_u64()? as u32,
    })
}

fn parse_code(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(code) => Some(code.clone()),
        Value::Number(code) => Some(code.to_string()),
        _ => None,
    }
}

fn required_text<'a>(value: Option<&'a str>, reason: &str) -> Result<&'a str, CommandError> {
    let trimmed = value.map(str::trim).filter(|value| !value.is_empty());
    trimmed.ok_or_else(|| document_error(reason, "文档同步参数不完整。"))
}

fn required_owned_text(value: Option<&str>, reason: &str) -> Result<String, CommandError> {
    value
        .ok_or_else(|| document_error(reason, "文档同步参数不完整。"))
        .map(ToOwned::to_owned)
}

fn required_version(value: Option<i32>) -> Result<i32, CommandError> {
    value.ok_or_else(|| document_error("documentVersionRequired", "文档同步参数不完整。"))
}

fn document_error(reason: &str, message: &str) -> CommandError {
    CommandError::new(CommandErrorCode::CodeLanguageValidationFailed, message)
        .with_reason(reason)
        .with_detail(ErrorDetail::new("DocumentNotification").with_value("reason", reason))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_open() -> CodeLanguageDocumentInput {
        CodeLanguageDocumentInput {
            project_id: 7,
            workspace_path: "/tmp/repo".to_string(),
            uri: "file:///tmp/repo/src/file.ts".to_string(),
            kind: CodeLanguageDocumentKind::DidOpen,
            language_id: Some("typescript".to_string()),
            version: Some(1),
            text: Some("const foo = bar;\n".to_string()),
        }
    }

    #[test]
    fn did_open_payload_requires_language_and_text() {
        let mut input = sample_open();
        input.language_id = None;
        let error = document_notification_payload(&input).expect_err("language required");
        assert_eq!(error.reason.as_deref(), Some("documentLanguageRequired"));

        input.language_id = Some("typescript".to_string());
        input.text = None;
        let error = document_notification_payload(&input).expect_err("text required");
        assert_eq!(error.reason.as_deref(), Some("documentTextRequired"));
    }

    #[test]
    fn parses_publish_diagnostics_notification() {
        let message = json!({
            "jsonrpc": "2.0",
            "method": "textDocument/publishDiagnostics",
            "params": {
                "uri": "file:///tmp/repo/src/file.ts",
                "diagnostics": [{
                    "range": {
                        "start": { "line": 0, "character": 12 },
                        "end": { "line": 0, "character": 15 }
                    },
                    "severity": 1,
                    "message": "Cannot find name 'bar'.",
                    "code": 2304,
                    "source": "typescript"
                }]
            }
        });

        let (uri, diagnostics) = parse_publish_diagnostics(&message).expect("diagnostics");
        assert_eq!(uri, "file:///tmp/repo/src/file.ts");
        assert_eq!(diagnostics[0].message, "Cannot find name 'bar'.");
        assert_eq!(diagnostics[0].severity, Some(1));
        assert_eq!(diagnostics[0].code.as_deref(), Some("2304"));
        assert_eq!(diagnostics[0].range.start.character, 12);
    }

    #[test]
    fn ignores_non_diagnostics_messages() {
        let message = json!({
            "jsonrpc": "2.0",
            "method": "window/logMessage",
            "params": { "type": 3, "message": "hi" }
        });
        assert!(parse_publish_diagnostics(&message).is_none());
    }
}
