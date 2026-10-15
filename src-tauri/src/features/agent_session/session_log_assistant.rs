//! 识别助手快照行，跳过正文分配。
//!
//! Grok 把同一条助手正文的完整快照逐帧追加。打开回放只需要最后一帧，
//! 不能为了读出 `messageId` 把每一帧正文都变成 `String`。

const MAX_SHORT_STRING: usize = 512;
const MAX_DEPTH: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct AssistantSnapshotMeta {
    pub message_id: String,
    pub subagent_id: Option<String>,
    pub turn_id: Option<String>,
    pub timestamp: i64,
}

/// 一行恰好是一个助手 `timeline` 快照时返回元数据，不读取正文。
/// 其它行、拼接 JSON、或形状对不上时返回 `None`，调用方再完整解析。
pub(super) fn assistant_snapshot_meta(line: &[u8]) -> Option<AssistantSnapshotMeta> {
    let mut scan = Scan {
        bytes: line,
        index: 0,
    };
    let mut event_type = None;
    let mut item_type = None;
    let mut message_id = None;
    let mut subagent_id = None;
    let mut turn_id = None;
    let mut timestamp = None;
    walk_object(&mut scan, 0, |scan, key| match key {
        "event" => walk_object(scan, 1, |scan, key| match key {
            "type" => {
                event_type = Some(read_short_string(scan)?);
                Some(())
            }
            "turnId" => {
                turn_id = read_optional_string(scan)?;
                Some(())
            }
            "timestamp" => {
                timestamp = Some(read_i64(scan)?);
                Some(())
            }
            "item" => walk_object(scan, 2, |scan, key| match key {
                "type" => {
                    let value = read_short_string(scan)?;
                    if value != "assistant_message" {
                        return None;
                    }
                    item_type = Some(value);
                    Some(())
                }
                "messageId" => {
                    message_id = read_optional_string(scan)?;
                    Some(())
                }
                "subagentId" => {
                    subagent_id = read_optional_string(scan)?;
                    Some(())
                }
                _ => skip_value(scan, 3),
            }),
            _ => skip_value(scan, 2),
        }),
        _ => skip_value(scan, 1),
    })?;
    scan.skip_ws();
    if scan.index != scan.bytes.len() {
        return None;
    }
    if event_type.as_deref() != Some("timeline")
        || item_type.as_deref() != Some("assistant_message")
    {
        return None;
    }
    Some(AssistantSnapshotMeta {
        message_id: message_id?,
        subagent_id,
        turn_id,
        timestamp: timestamp?,
    })
}

struct Scan<'a> {
    bytes: &'a [u8],
    index: usize,
}

impl Scan<'_> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.index).copied()
    }

    fn next(&mut self) -> Option<u8> {
        let byte = self.peek()?;
        self.index += 1;
        Some(byte)
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.index += 1;
        }
    }

    fn skip_string(&mut self) -> bool {
        if self.next() != Some(b'"') {
            return false;
        }
        while let Some(byte) = self.next() {
            match byte {
                b'\\' => {
                    if self.next().is_none() {
                        return false;
                    }
                }
                b'"' => return true,
                _ => {}
            }
        }
        false
    }
}

fn walk_object(
    scan: &mut Scan<'_>,
    depth: usize,
    mut on_field: impl FnMut(&mut Scan<'_>, &str) -> Option<()>,
) -> Option<()> {
    if depth > MAX_DEPTH {
        return None;
    }
    scan.skip_ws();
    if scan.next()? != b'{' {
        return None;
    }
    loop {
        scan.skip_ws();
        match scan.peek()? {
            b'}' => {
                scan.next();
                return Some(());
            }
            b',' => {
                scan.next();
            }
            b'"' => {
                let key = read_short_string(scan)?;
                scan.skip_ws();
                if scan.next()? != b':' {
                    return None;
                }
                on_field(scan, &key)?;
            }
            _ => return None,
        }
    }
}

fn read_short_string(scan: &mut Scan<'_>) -> Option<String> {
    scan.skip_ws();
    if scan.peek()? != b'"' {
        return None;
    }
    let start = scan.index;
    if !scan.skip_string() {
        return None;
    }
    let raw = &scan.bytes[start + 1..scan.index - 1];
    if raw.len() > MAX_SHORT_STRING {
        return None;
    }
    unescape(raw)
}

fn read_optional_string(scan: &mut Scan<'_>) -> Option<Option<String>> {
    scan.skip_ws();
    if scan.bytes[scan.index..].starts_with(b"null") {
        scan.index += 4;
        return Some(None);
    }
    Some(Some(read_short_string(scan)?))
}

fn read_i64(scan: &mut Scan<'_>) -> Option<i64> {
    scan.skip_ws();
    let start = scan.index;
    if scan.peek() == Some(b'-') {
        scan.next();
    }
    let digits = scan.index;
    while matches!(scan.peek(), Some(b'0'..=b'9')) {
        scan.next();
    }
    if scan.index == digits || matches!(scan.peek(), Some(b'.' | b'e' | b'E')) {
        return None;
    }
    std::str::from_utf8(&scan.bytes[start..scan.index])
        .ok()?
        .parse()
        .ok()
}

fn skip_value(scan: &mut Scan<'_>, depth: usize) -> Option<()> {
    if depth > MAX_DEPTH {
        return None;
    }
    scan.skip_ws();
    match scan.peek()? {
        b'"' => scan.skip_string().then_some(()),
        b'{' => walk_object(scan, depth, |scan, _| skip_value(scan, depth + 1)),
        b'[' => skip_array(scan, depth),
        b't' => consume(scan, b"true"),
        b'f' => consume(scan, b"false"),
        b'n' => consume(scan, b"null"),
        b'-' | b'0'..=b'9' => skip_number(scan),
        _ => None,
    }
}

fn skip_array(scan: &mut Scan<'_>, depth: usize) -> Option<()> {
    if scan.next()? != b'[' {
        return None;
    }
    loop {
        scan.skip_ws();
        match scan.peek()? {
            b']' => {
                scan.next();
                return Some(());
            }
            b',' => {
                scan.next();
            }
            _ => skip_value(scan, depth + 1)?,
        }
    }
}

fn skip_number(scan: &mut Scan<'_>) -> Option<()> {
    if scan.peek() == Some(b'-') {
        scan.next();
    }
    let digits = scan.index;
    while matches!(scan.peek(), Some(b'0'..=b'9')) {
        scan.next();
    }
    if scan.index == digits {
        return None;
    }
    if scan.peek() == Some(b'.') {
        scan.next();
        while matches!(scan.peek(), Some(b'0'..=b'9')) {
            scan.next();
        }
    }
    if matches!(scan.peek(), Some(b'e' | b'E')) {
        scan.next();
        if matches!(scan.peek(), Some(b'+' | b'-')) {
            scan.next();
        }
        while matches!(scan.peek(), Some(b'0'..=b'9')) {
            scan.next();
        }
    }
    Some(())
}

fn consume(scan: &mut Scan<'_>, literal: &[u8]) -> Option<()> {
    if scan.bytes[scan.index..].starts_with(literal) {
        scan.index += literal.len();
        Some(())
    } else {
        None
    }
}

fn unescape(raw: &[u8]) -> Option<String> {
    if !raw.contains(&b'\\') {
        return String::from_utf8(raw.to_vec()).ok();
    }
    let mut out = Vec::with_capacity(raw.len());
    let mut index = 0;
    while index < raw.len() {
        if raw[index] != b'\\' {
            out.push(raw[index]);
            index += 1;
            continue;
        }
        index += 1;
        match *raw.get(index)? {
            byte @ (b'"' | b'\\' | b'/') => out.push(byte),
            b'n' => out.push(b'\n'),
            b'r' => out.push(b'\r'),
            b't' => out.push(b'\t'),
            b'u' => {
                let hex = raw.get(index + 1..index + 5)?;
                let code = u32::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()?;
                let ch = char::from_u32(code)?;
                let mut buf = [0u8; 4];
                out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                index += 4;
            }
            _ => return None,
        }
        index += 1;
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::assistant_snapshot_meta;
    use crate::types::agent_session_stream::{
        AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem,
    };

    #[test]
    fn reads_ids_after_escaped_assistant_text_without_keeping_the_text() {
        let line = b"{\"projectId\":1,\"event\":{\"type\":\"timeline\",\"item\":{\"type\":\"assistant_message\",\"text\":\"a\\\"b\\n\xe4\xb8\xad\",\"messageId\":\"m1\",\"subagentId\":\"sub-1\"},\"turnId\":\"turn-9\",\"seq\":3,\"timestamp\":42}}";
        let meta = assistant_snapshot_meta(line).expect("meta");
        assert_eq!(meta.message_id, "m1");
        assert_eq!(meta.subagent_id.as_deref(), Some("sub-1"));
        assert_eq!(meta.turn_id.as_deref(), Some("turn-9"));
        assert_eq!(meta.timestamp, 42);
    }

    #[test]
    fn matches_serialized_assistant_envelopes_and_rejects_other_events() {
        let assistant = AgentStreamEventEnvelope {
            project_id: 1,
            session_id: 2,
            seq: 3,
            epoch: "epoch".to_string(),
            event: AgentStreamEvent::Timeline {
                item: AgentTimelineItem::AssistantMessage {
                    text: "结论".into(),
                    message_id: Some("msg".to_string()),
                    subagent_id: None,
                },
                turn_id: Some("turn".to_string()),
                seq: 4,
                timestamp: 5,
            },
            log_offset: None,
        };
        let line = serde_json::to_vec(&assistant).expect("json");
        let meta = assistant_snapshot_meta(&line).expect("meta");
        assert_eq!(meta.message_id, "msg");
        assert_eq!(meta.subagent_id, None);
        assert_eq!(meta.turn_id.as_deref(), Some("turn"));
        assert_eq!(meta.timestamp, 5);

        let tool = AgentStreamEventEnvelope {
            event: AgentStreamEvent::Timeline {
                item: AgentTimelineItem::ToolCall {
                    call_id: "c".to_string(),
                    name: "shell".to_string(),
                    detail: crate::types::agent_session_stream::ToolCallDetail::Shell {
                        command: "echo".to_string(),
                        output: Some("a\\\"b".to_string()),
                        exit_code: Some(0),
                    },
                    status: crate::types::agent_session_stream::ToolCallStatus::Completed,
                    error: None,
                    subagent_id: None,
                },
                turn_id: Some("turn".to_string()),
                seq: 1,
                timestamp: 2,
            },
            ..assistant
        };
        let tool_line = serde_json::to_vec(&tool).expect("json");
        assert!(assistant_snapshot_meta(&tool_line).is_none());
        assert!(
            assistant_snapshot_meta(br#"{"event":{"type":"turn_started","turnId":"t"}}"#).is_none()
        );
    }
}
