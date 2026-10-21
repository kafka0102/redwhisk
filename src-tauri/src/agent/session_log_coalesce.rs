//! 助手 / 推理快照落盘合并。
//!
//! Grok 每一帧都带上当前完整正文。逐帧追加会让一份几十万字节的回复写成十几 GB。
//! 同一条快照只在正文至少增长一个步长、或被下一条别的事件打断时才追加一行。

use std::fs::File;
use std::io::{self, Seek, SeekFrom, Write};

use crate::types::agent_session_stream::{
    AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem,
};

/// 同一条快照再次落盘前，正文至少要增长这么多字节。
const SNAPSHOT_PERSIST_STRIDE: usize = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
enum SnapshotKey {
    Assistant {
        message_id: String,
        subagent_id: Option<String>,
    },
    Reasoning {
        subagent_id: Option<String>,
    },
}

#[derive(Debug)]
struct PendingSnapshot {
    key: SnapshotKey,
    persisted_len: usize,
    envelope: AgentStreamEventEnvelope,
}

#[derive(Debug, Default)]
pub(crate) struct SnapshotLogState {
    log_path: Option<String>,
    pending: Option<PendingSnapshot>,
}

impl SnapshotLogState {
    pub(crate) fn reset_for_path(&mut self, log_path: String) {
        self.log_path = Some(log_path);
        self.pending = None;
    }

    pub(crate) fn log_path(&self) -> Option<&str> {
        self.log_path.as_deref()
    }

    /// 写入 `envelope`。跳过中间帧时返回 `None`；真正落盘时返回该行起始偏移。
    pub(crate) fn write_envelope(
        &mut self,
        file: &mut File,
        envelope: &AgentStreamEventEnvelope,
    ) -> io::Result<Option<u64>> {
        let Some(key) = snapshot_key(&envelope.event) else {
            self.flush_pending(file)?;
            return append_line(file, envelope).map(Some);
        };
        if self
            .pending
            .as_ref()
            .is_some_and(|pending| pending.key != key)
        {
            self.flush_pending(file)?;
        }
        let persisted_len = self
            .pending
            .as_ref()
            .filter(|pending| pending.key == key)
            .map(|pending| pending.persisted_len)
            .unwrap_or(0);
        self.pending = Some(PendingSnapshot {
            key,
            persisted_len,
            envelope: envelope.clone(),
        });
        let text_len = snapshot_text_len(&envelope.event);
        if persisted_len == 0 || text_len.saturating_sub(persisted_len) >= SNAPSHOT_PERSIST_STRIDE {
            return self.flush_pending(file);
        }
        Ok(None)
    }

    fn flush_pending(&mut self, file: &mut File) -> io::Result<Option<u64>> {
        let Some(pending) = self.pending.as_mut() else {
            return Ok(None);
        };
        let text_len = snapshot_text_len(&pending.envelope.event);
        if pending.persisted_len > 0 && text_len <= pending.persisted_len {
            return Ok(None);
        }
        let offset = append_line(file, &pending.envelope)?;
        pending.persisted_len = text_len;
        Ok(Some(offset))
    }
}

fn snapshot_key(event: &AgentStreamEvent) -> Option<SnapshotKey> {
    match event {
        AgentStreamEvent::Timeline {
            item:
                AgentTimelineItem::AssistantMessage {
                    message_id: Some(message_id),
                    subagent_id,
                    ..
                },
            ..
        } => Some(SnapshotKey::Assistant {
            message_id: message_id.clone(),
            subagent_id: subagent_id.clone(),
        }),
        AgentStreamEvent::Timeline {
            item: AgentTimelineItem::Reasoning { subagent_id, .. },
            ..
        } => Some(SnapshotKey::Reasoning {
            subagent_id: subagent_id.clone(),
        }),
        _ => None,
    }
}

fn snapshot_text_len(event: &AgentStreamEvent) -> usize {
    match event {
        AgentStreamEvent::Timeline {
            item: AgentTimelineItem::AssistantMessage { text, .. },
            ..
        }
        | AgentStreamEvent::Timeline {
            item: AgentTimelineItem::Reasoning { text, .. },
            ..
        } => text.as_str().len(),
        _ => 0,
    }
}

fn append_line(file: &mut File, envelope: &AgentStreamEventEnvelope) -> io::Result<u64> {
    let offset = file.seek(SeekFrom::End(0))?;
    let line = serde_json::to_string(envelope)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    file.write_all(line.as_bytes())?;
    file.write_all(b"\n")?;
    file.flush()?;
    Ok(offset)
}

#[cfg(test)]
mod tests {
    use super::{SnapshotLogState, SNAPSHOT_PERSIST_STRIDE};
    use crate::types::agent_session_stream::{
        AgentStreamEvent, AgentStreamEventEnvelope, AgentTimelineItem,
    };
    use std::fs::OpenOptions;

    fn assistant(seq: u64, text: &str) -> AgentStreamEventEnvelope {
        AgentStreamEventEnvelope {
            project_id: 1,
            session_id: 9,
            seq,
            epoch: "epoch".to_string(),
            event: AgentStreamEvent::Timeline {
                item: AgentTimelineItem::AssistantMessage {
                    text: text.into(),
                    message_id: Some("same".to_string()),
                    subagent_id: Some("child".to_string()),
                },
                turn_id: Some("turn".to_string()),
                seq,
                timestamp: seq as i64,
            },
            log_offset: None,
        }
    }

    fn turn_started(seq: u64) -> AgentStreamEventEnvelope {
        AgentStreamEventEnvelope {
            project_id: 1,
            session_id: 9,
            seq,
            epoch: "epoch".to_string(),
            event: AgentStreamEvent::TurnStarted {
                turn_id: Some("turn".to_string()),
            },
            log_offset: None,
        }
    }

    #[test]
    fn repeated_assistant_snapshots_do_not_append_every_frame() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("session.jsonl");
        let mut file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(&path)
            .expect("open");
        let mut state = SnapshotLogState::default();
        let frames = 40;
        for index in 1..=frames {
            let text = "a".repeat(index * 1_000);
            state
                .write_envelope(&mut file, &assistant(index as u64, &text))
                .expect("write");
        }
        let written = file.metadata().expect("meta").len();
        let all_frames = (1..=frames).map(|index| index * 1_000).sum::<usize>();
        assert!(
            written < (all_frames / 4) as u64,
            "log grew to {written} bytes across {frames} snapshots (naive sum {all_frames})"
        );
        let body = std::fs::read_to_string(&path).expect("read");
        let lines = body.lines().count();
        assert!(lines <= 4, "persisted {lines} snapshot lines");
        assert!(
            body.contains(&"a".repeat(SNAPSHOT_PERSIST_STRIDE)),
            "missing a persisted stride"
        );
    }

    #[test]
    fn following_event_flushes_the_latest_snapshot() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("session.jsonl");
        let mut file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(&path)
            .expect("open");
        let mut state = SnapshotLogState::default();
        state
            .write_envelope(&mut file, &assistant(1, "短回复"))
            .expect("snapshot");
        state
            .write_envelope(&mut file, &turn_started(2))
            .expect("turn");
        let body = std::fs::read_to_string(&path).expect("read");
        assert!(body.contains("短回复"), "{body}");
        assert!(body.contains("turn_started"), "{body}");
    }
}
