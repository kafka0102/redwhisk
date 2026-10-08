//! 假 ACP 对端断言出站 `session/prompt` 的内容块。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::session::{DeepSeekSessionConfig, DeepSeekSessionHandle};
use crate::agent::agent_event_broadcaster::AgentEventBroadcaster;
use crate::agent::session_handle::AgentSessionHandle;
use crate::types::agent_session::{AgentAttachmentKind, AgentMessageAttachment};
use crate::types::agent_session_stream::AgentStreamEvent;

const FAKE_ACP: &str = r#"#!/usr/bin/env bash
log="__LOG__"
printf 'ARGV:%s\n' "$*" >> "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  method=$(printf '%s' "$line" | sed -n 's/.*"method":"\([^"]*\)".*/\1/p')
  case "$method" in
    initialize)
      printf '{"jsonrpc":"2.0","id":%s,"result":__INIT__}\n' "$id"
      ;;
    session/new)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"ds-session-1"}}\n' "$id"
      ;;
    session/prompt)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$id"
      ;;
    *)
      printf '{"jsonrpc":"2.0","id":%s,"error":{"message":"unexpected method"}}\n' "$id"
      ;;
  esac
done
"#;

const PNG_BYTES: &[u8] = b"\x89PNG\r\n\x1a\n";
const PNG_BASE64: &str = "iVBORw0KGgo=";
const JPG_BYTES: &[u8] = b"\xff\xd8\xff\xd9";
const JPG_BASE64: &str = "/9j/2Q==";
const JPEG_BYTES: &[u8] = b"\xff\xd8\xff\xdb";
const JPEG_BASE64: &str = "/9j/2w==";
const WEBP_BYTES: &[u8] = b"RIFF\x00\x00\x00\x00WEBP";
const WEBP_BASE64: &str = "UklGRgAAAABXRUJQ";
const GIF_BYTES: &[u8] = b"GIF89a";
const GIF_BASE64: &str = "R0lGODlh";
const IMAGE_CAPABLE_INITIALIZE: &str =
    r#"{"protocolVersion":1,"agentCapabilities":{"promptCapabilities":{"image":true}}}"#;

#[test]
fn png_and_text_share_one_prompt_as_an_image_block() {
    let temp = tempfile::tempdir().expect("temp");
    let image_path = temp.path().join("shot.png");
    fs::write(&image_path, PNG_BYTES).expect("write png");
    let (binary, log) = write_fake_dsh(temp.path(), IMAGE_CAPABLE_INITIALIZE);
    let handle = start_session(&binary, temp.path());

    AgentSessionHandle::send_message(
        &handle,
        "请看图".into(),
        vec![attachment(
            &image_path,
            "shot.png",
            AgentAttachmentKind::Image,
        )],
    )
    .expect("send image prompt");

    let prompt = wait_for_prompt(&log);
    assert_eq!(
        prompt,
        serde_json::json!([
            { "type": "text", "text": "请看图" },
            { "type": "image", "mimeType": "image/png", "data": PNG_BASE64 }
        ]),
        "PNG 必须和文本出现在同一次 prompt"
    );
    assert_eq!(prompt_request_count(&log), 1);

    handle.shutdown();
}

#[test]
fn jpeg_webp_and_gif_share_the_prompt_with_their_mime_types() {
    let temp = tempfile::tempdir().expect("temp");
    let jpg_path = temp.path().join("photo.jpg");
    let jpeg_path = temp.path().join("photo.jpeg");
    let webp_path = temp.path().join("photo.webp");
    let gif_path = temp.path().join("photo.gif");
    fs::write(&jpg_path, JPG_BYTES).expect("write jpg");
    fs::write(&jpeg_path, JPEG_BYTES).expect("write jpeg");
    fs::write(&webp_path, WEBP_BYTES).expect("write webp");
    fs::write(&gif_path, GIF_BYTES).expect("write gif");
    let (binary, log) = write_fake_dsh(temp.path(), IMAGE_CAPABLE_INITIALIZE);
    let handle = start_session(&binary, temp.path());

    AgentSessionHandle::send_message(
        &handle,
        "三种图片".into(),
        vec![
            attachment(&jpg_path, "photo.jpg", AgentAttachmentKind::Image),
            attachment(&jpeg_path, "photo.jpeg", AgentAttachmentKind::Image),
            attachment(&webp_path, "photo.webp", AgentAttachmentKind::Image),
            attachment(&gif_path, "photo.gif", AgentAttachmentKind::Image),
        ],
    )
    .expect("send image prompt");

    let prompt = wait_for_prompt(&log);
    assert_eq!(
        prompt,
        serde_json::json!([
            { "type": "text", "text": "三种图片" },
            { "type": "image", "mimeType": "image/jpeg", "data": JPG_BASE64 },
            { "type": "image", "mimeType": "image/jpeg", "data": JPEG_BASE64 },
            { "type": "image", "mimeType": "image/webp", "data": WEBP_BASE64 },
            { "type": "image", "mimeType": "image/gif", "data": GIF_BASE64 }
        ])
    );
    assert_eq!(prompt_request_count(&log), 1);

    handle.shutdown();
}

#[test]
fn pdf_text_and_other_files_keep_path_notes_instead_of_image_blocks() {
    let temp = tempfile::tempdir().expect("temp");
    let png_path = temp.path().join("shot.png");
    let pdf_path = temp.path().join("notes.pdf");
    let text_path = temp.path().join("readme.txt");
    let other_path = temp.path().join("data.bin");
    fs::write(&png_path, PNG_BYTES).expect("write png");
    fs::write(&pdf_path, b"%PDF-1.4").expect("write pdf");
    fs::write(&text_path, b"hello").expect("write text");
    fs::write(&other_path, b"blob").expect("write other");
    let (binary, log) = write_fake_dsh(temp.path(), IMAGE_CAPABLE_INITIALIZE);
    let handle = start_session(&binary, temp.path());

    AgentSessionHandle::send_message(
        &handle,
        "混合附件".into(),
        vec![
            attachment(&png_path, "shot.png", AgentAttachmentKind::Image),
            attachment(&pdf_path, "notes.pdf", AgentAttachmentKind::Pdf),
            attachment(&text_path, "readme.txt", AgentAttachmentKind::Text),
            attachment(&other_path, "data.bin", AgentAttachmentKind::Generic),
        ],
    )
    .expect("send mixed prompt");

    let prompt = wait_for_prompt(&log);
    assert_eq!(
        prompt,
        serde_json::json!([
            { "type": "text", "text": "混合附件" },
            { "type": "image", "mimeType": "image/png", "data": PNG_BASE64 },
            { "type": "text", "text": format!("notes.pdf: {}", pdf_path.display()) },
            { "type": "text", "text": format!("readme.txt: {}", text_path.display()) },
            { "type": "text", "text": format!("data.bin: {}", other_path.display()) }
        ])
    );
    assert!(
        prompt
            .as_array()
            .expect("blocks")
            .iter()
            .filter(|block| block["type"] == "image")
            .all(|block| block["mimeType"] == "image/png"),
        "PDF、文本和其它类型不得变成 image 块：{prompt}"
    );

    handle.shutdown();
}

#[test]
fn image_send_fails_when_initialize_does_not_declare_image_input() {
    assert_image_send_is_rejected(r#"{"protocolVersion":1}"#);
}

#[test]
fn image_send_fails_when_initialize_reports_image_unsupported() {
    assert_image_send_is_rejected(
        r#"{"protocolVersion":1,"agentCapabilities":{"promptCapabilities":{"image":false}}}"#,
    );
}

fn assert_image_send_is_rejected(initialize_result: &str) {
    let temp = tempfile::tempdir().expect("temp");
    let image_path = temp.path().join("shot.png");
    let pdf_path = temp.path().join("notes.pdf");
    fs::write(&image_path, PNG_BYTES).expect("write png");
    fs::write(&pdf_path, b"%PDF-1.4").expect("write pdf");
    let (binary, log) = write_fake_dsh(temp.path(), initialize_result);
    let events = Arc::new(Mutex::new(Vec::<AgentStreamEvent>::new()));
    let handle = start_session_with_log(&binary, temp.path(), Arc::clone(&events));

    let error = AgentSessionHandle::send_message(
        &handle,
        "请看图".into(),
        vec![attachment(
            &image_path,
            "shot.png",
            AgentAttachmentKind::Image,
        )],
    )
    .expect_err("image send must fail");

    let message = error.to_string();
    assert!(
        message.contains("image input is not supported by this connection"),
        "失败原因必须说明图片不受支持，实际：{message}"
    );
    let traffic = fs::read_to_string(&log).unwrap_or_default();
    assert!(
        !traffic.contains("\"method\":\"session/prompt\""),
        "未声明图片能力时不得发出丢掉图片的 prompt：{traffic}"
    );
    assert!(
        !traffic.contains(PNG_BASE64),
        "图片数据不得出现在出站流量里：{traffic}"
    );
    let current = events.lock().expect("events").clone();
    assert!(
        current
            .iter()
            .all(|event| !matches!(event, AgentStreamEvent::TurnStarted { .. })),
        "失败的图片发送不得留下正在运行的轮次：{current:?}"
    );

    AgentSessionHandle::send_message(
        &handle,
        "只有路径".into(),
        vec![attachment(&pdf_path, "notes.pdf", AgentAttachmentKind::Pdf)],
    )
    .expect("non-image attachments still send");
    let prompt = wait_for_prompt(&log);
    assert_eq!(
        prompt,
        serde_json::json!([
            { "type": "text", "text": "只有路径" },
            { "type": "text", "text": format!("notes.pdf: {}", pdf_path.display()) }
        ])
    );

    handle.shutdown();
}

fn attachment(
    path: &Path,
    display_name: &str,
    kind: AgentAttachmentKind,
) -> AgentMessageAttachment {
    AgentMessageAttachment {
        path: path.to_string_lossy().into_owned(),
        display_name: display_name.to_string(),
        kind,
    }
}

fn start_session(binary: &Path, cwd: &Path) -> DeepSeekSessionHandle {
    start_session_with_log(binary, cwd, Arc::new(Mutex::new(Vec::new())))
}

fn start_session_with_log(
    binary: &Path,
    cwd: &Path,
    event_log: Arc<Mutex<Vec<AgentStreamEvent>>>,
) -> DeepSeekSessionHandle {
    DeepSeekSessionHandle::start(DeepSeekSessionConfig {
        project_id: 7,
        session_id: 9,
        binary: binary.to_string_lossy().into_owned(),
        cwd: cwd.to_string_lossy().into_owned(),
        dangerous: false,
        mode_id: None,
        resume_session_id: None,
        broadcaster: AgentEventBroadcaster::new(),
        event_log,
    })
    .expect("start deepseek session")
}

fn wait_for_prompt(log: &Path) -> serde_json::Value {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(prompt) = prompt_blocks(log) {
            return prompt;
        }
        if Instant::now() >= deadline {
            let traffic = fs::read_to_string(log).unwrap_or_default();
            panic!("没有看到 session/prompt：{traffic}");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn prompt_blocks(log: &Path) -> Option<serde_json::Value> {
    let traffic = fs::read_to_string(log).ok()?;
    for line in traffic.lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if value.get("method").and_then(serde_json::Value::as_str) == Some("session/prompt") {
            return value.pointer("/params/prompt").cloned();
        }
    }
    None
}

fn prompt_request_count(log: &Path) -> usize {
    fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .filter(|line| line.contains("\"method\":\"session/prompt\""))
        .count()
}

fn write_fake_dsh(dir: &Path, initialize_result: &str) -> (PathBuf, PathBuf) {
    let log_path = dir.join("acp.log");
    let script_path = dir.join("fake-dsh.sh");
    let script = FAKE_ACP
        .replace("__LOG__", &log_path.to_string_lossy())
        .replace("__INIT__", initialize_result);
    fs::write(&script_path, script).expect("write fake dsh");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&script_path).expect("meta").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script_path, permissions).expect("chmod");
    }
    (script_path, log_path)
}
