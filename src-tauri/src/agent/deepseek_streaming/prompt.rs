//! 出站 `session/prompt` 内容块。
//!
//! 受支持的图片读盘后成为 ACP image 块；其它附件只留路径说明。
//! 连接未声明图片能力时，带图片的发送直接失败，不把图片换成路径。

use std::fs;
use std::path::Path;

use base64::Engine;
use serde_json::{json, Value};

use crate::agent::deepseek_streaming::transport::DeepSeekStreamingError;
use crate::types::agent_session::AgentMessageAttachment;

const IMAGE_UNSUPPORTED: &str = "image input is not supported by this connection";

/// `initialize` 只有显式 `promptCapabilities.image == true` 才算声明了图片能力。
pub(crate) fn declares_image_input(initialize_result: &Value) -> bool {
    initialize_result
        .pointer("/agentCapabilities/promptCapabilities/image")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// 文本与附件放进同一次 prompt。图片能力不足时返回英文协议错误。
pub(crate) fn build_prompt_blocks(
    text: &str,
    attachments: &[AgentMessageAttachment],
    images_supported: bool,
) -> Result<Vec<Value>, DeepSeekStreamingError> {
    if !images_supported
        && attachments
            .iter()
            .any(|attachment| supported_image_mime(&attachment.path).is_some())
    {
        return Err(DeepSeekStreamingError::Protocol(IMAGE_UNSUPPORTED.into()));
    }

    let mut blocks = vec![json!({ "type": "text", "text": text })];
    for attachment in attachments {
        if let Some(mime) = supported_image_mime(&attachment.path) {
            blocks.push(image_block(attachment, mime)?);
        } else {
            blocks.push(json!({
                "type": "text",
                "text": format!("{}: {}", attachment.display_name, attachment.path),
            }));
        }
    }
    Ok(blocks)
}

fn supported_image_mime(path: &str) -> Option<&'static str> {
    let extension = Path::new(path.trim())
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        _ => None,
    }
}

fn image_block(
    attachment: &AgentMessageAttachment,
    mime: &str,
) -> Result<Value, DeepSeekStreamingError> {
    let path = Path::new(attachment.path.trim());
    let bytes = fs::read(path).map_err(|error| {
        DeepSeekStreamingError::Protocol(format!(
            "failed to read image attachment {}: {error}",
            attachment.path
        ))
    })?;
    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(json!({
        "type": "image",
        "mimeType": mime,
        "data": data,
    }))
}
