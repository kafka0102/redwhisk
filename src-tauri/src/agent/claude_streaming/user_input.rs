//! Claude stream-json 用户消息编码（含图片 base64 内容块）。

use std::fs;
use std::path::Path;

use base64::Engine;
use serde_json::{json, Value};

use crate::types::agent_session::{AgentAttachmentKind, AgentMessageAttachment};

/// 构造写入 Claude stdin 的单条 user 事件（`--input-format stream-json`）。
///
/// 图片附件读盘后编码为 Anthropic `image` content block；非图片仍退回文本路径说明。
pub fn build_stream_json_user_event(
    text: &str,
    attachments: &[AgentMessageAttachment],
) -> Result<Value, String> {
    let mut content = Vec::new();
    if !text.trim().is_empty() {
        content.push(json!({
            "type": "text",
            "text": text,
        }));
    }

    for attachment in attachments {
        match attachment.kind {
            AgentAttachmentKind::Image => {
                content.push(encode_image_content_block(attachment)?);
            }
            _ => {
                content.push(json!({
                    "type": "text",
                    "text": format!(
                        "[附件] {}: {}",
                        attachment.display_name, attachment.path
                    ),
                }));
            }
        }
    }

    if content.is_empty() {
        content.push(json!({
            "type": "text",
            "text": text,
        }));
    }

    Ok(json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": content,
        }
    }))
}

fn encode_image_content_block(attachment: &AgentMessageAttachment) -> Result<Value, String> {
    let path = Path::new(attachment.path.trim());
    if !path.is_file() {
        return Err(format!(
            "图片附件不存在：{} ({})",
            attachment.display_name, attachment.path
        ));
    }
    let bytes = fs::read(path).map_err(|error| {
        format!(
            "读取图片附件失败：{} ({}): {error}",
            attachment.display_name, attachment.path
        )
    })?;
    let media_type = image_media_type(path, attachment);
    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(json!({
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": data,
        }
    }))
}

fn image_media_type(path: &Path, attachment: &AgentMessageAttachment) -> &'static str {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "png" => "image/png",
        _ => {
            // 未知扩展名时按 PNG 兜底；Issue 图片附件通常已是 png。
            let _ = attachment;
            "image/png"
        }
    }
}

/// 附件中是否含图片（决定是否切换 stream-json 输入路径）。
pub fn has_image_attachment(attachments: &[AgentMessageAttachment]) -> bool {
    attachments
        .iter()
        .any(|attachment| attachment.kind == AgentAttachmentKind::Image)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn builds_text_only_content_when_no_images() {
        let event = build_stream_json_user_event("hello", &[]).expect("ok");
        assert_eq!(event["type"], "user");
        assert_eq!(event["message"]["content"][0]["text"], "hello");
    }

    #[test]
    fn encodes_png_attachment_as_base64_image_block() {
        let mut file = NamedTempFile::new().expect("temp");
        // 最小合法 PNG 头 + 少量数据即可验证编码路径。
        file.write_all(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
            .expect("write");
        let path = file.path().to_string_lossy().to_string();
        let attachments = vec![AgentMessageAttachment {
            path: path.clone(),
            display_name: "shot.png".into(),
            kind: AgentAttachmentKind::Image,
        }];
        let event = build_stream_json_user_event("请看图", &attachments).expect("ok");
        let content = event["message"]["content"].as_array().expect("array");
        assert_eq!(content.len(), 2);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[1]["type"], "image");
        assert_eq!(content[1]["source"]["type"], "base64");
        assert_eq!(content[1]["source"]["media_type"], "image/png");
        assert!(content[1]["source"]["data"].as_str().unwrap().len() > 8);
    }

    #[test]
    fn non_image_attachments_remain_text_paths() {
        let attachments = vec![AgentMessageAttachment {
            path: "/tmp/a.pdf".into(),
            display_name: "a.pdf".into(),
            kind: AgentAttachmentKind::Pdf,
        }];
        let event = build_stream_json_user_event("hi", &attachments).expect("ok");
        let content = event["message"]["content"].as_array().expect("array");
        assert_eq!(content[1]["type"], "text");
        assert!(content[1]["text"].as_str().unwrap().contains("/tmp/a.pdf"));
    }
}
