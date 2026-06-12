use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::agent::pty_session_manager::PtyOutputEvent;
use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::connection::DatabaseConfig;

const FLUSH_AFTER_QUIET_MS: u64 = 750;
const FLUSH_MAX_LATENCY_MS: u64 = 2_000;
const LATEST_OUTPUT_MAX_CHARS: usize = 500;
const OUTPUT_BUFFER_MAX_CHARS: usize = 4_000;

#[derive(Clone)]
pub struct LatestOutputWriter {
    sender: mpsc::Sender<LatestOutputUpdate>,
}

#[derive(Debug, Clone)]
struct LatestOutputUpdate {
    session_id: i64,
    sequence: u64,
    data: Vec<u8>,
}

#[derive(Debug, Clone)]
struct PendingOutput {
    session_id: i64,
    text: String,
}

#[derive(Debug, Default)]
struct SessionOutputState {
    latest_sequence: u64,
    buffer: String,
    pending: Option<PendingOutput>,
}

impl LatestOutputWriter {
    pub fn new(data_dir: PathBuf) -> Self {
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || run_writer(data_dir, receiver));
        Self { sender }
    }

    pub fn record_terminal_output(&self, event: &PtyOutputEvent) {
        let _ = self.sender.send(LatestOutputUpdate {
            session_id: event.session_id,
            sequence: event.sequence,
            data: event.data.clone(),
        });
    }
}

fn run_writer(data_dir: PathBuf, receiver: mpsc::Receiver<LatestOutputUpdate>) {
    let mut states: HashMap<i64, SessionOutputState> = HashMap::new();
    let mut last_flush = Instant::now();

    loop {
        match receiver.recv_timeout(Duration::from_millis(FLUSH_AFTER_QUIET_MS)) {
            Ok(update) => {
                record_update(&mut states, update);
                if last_flush.elapsed() >= Duration::from_millis(FLUSH_MAX_LATENCY_MS) {
                    flush_pending(&data_dir, &mut states);
                    last_flush = Instant::now();
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if has_pending_output(&states) {
                    flush_pending(&data_dir, &mut states);
                    last_flush = Instant::now();
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                flush_pending(&data_dir, &mut states);
                break;
            }
        }
    }
}

fn record_update(states: &mut HashMap<i64, SessionOutputState>, update: LatestOutputUpdate) {
    let state = states.entry(update.session_id).or_default();
    if update.sequence <= state.latest_sequence {
        return;
    }

    let fragment = terminal_text_fragment(&update.data);
    if fragment.is_empty() {
        return;
    }

    state.latest_sequence = update.sequence;
    state.buffer.push_str(&fragment);
    truncate_output_buffer(&mut state.buffer);

    let Some(text) = latest_output_text(&state.buffer) else {
        return;
    };

    state.pending = Some(PendingOutput {
        session_id: update.session_id,
        text,
    });
}

fn flush_pending(data_dir: &PathBuf, states: &mut HashMap<i64, SessionOutputState>) {
    let updates = states
        .values_mut()
        .filter_map(|state| state.pending.take())
        .collect::<Vec<_>>();
    if updates.is_empty() {
        return;
    }

    let Ok(database) = DatabaseConfig::new(data_dir).open() else {
        return;
    };

    let updated_at = current_epoch_millis();
    let repository = AgentSessionRepository::new(&database.connection);
    for update in updates {
        let _ = repository.update_latest_output(update.session_id, &update.text, updated_at);
    }
}

fn has_pending_output(states: &HashMap<i64, SessionOutputState>) -> bool {
    states.values().any(|state| state.pending.is_some())
}

fn current_epoch_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn terminal_text_fragment(data: &[u8]) -> String {
    let raw = String::from_utf8_lossy(data);
    strip_terminal_controls(&raw).replace('\r', "\n")
}

fn latest_output_text(text: &str) -> Option<String> {
    let latest_line = text
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())?;

    let truncated = latest_line
        .chars()
        .take(LATEST_OUTPUT_MAX_CHARS)
        .collect::<String>();
    if truncated.is_empty() {
        None
    } else {
        Some(truncated)
    }
}

fn truncate_output_buffer(buffer: &mut String) {
    let char_count = buffer.chars().count();
    if char_count <= OUTPUT_BUFFER_MAX_CHARS {
        return;
    }

    *buffer = buffer
        .chars()
        .skip(char_count - OUTPUT_BUFFER_MAX_CHARS)
        .collect();
}

fn strip_terminal_controls(input: &str) -> String {
    let mut output = String::new();
    let mut chars = input.chars().peekable();

    while let Some(character) = chars.next() {
        if character == '\u{1b}' {
            match chars.peek().copied() {
                Some('[') => {
                    chars.next();
                    for next in chars.by_ref() {
                        if ('@'..='~').contains(&next) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    for next in chars.by_ref() {
                        if next == '\u{7}' {
                            break;
                        }
                    }
                }
                Some(_) => {
                    chars.next();
                }
                None => {}
            }
            continue;
        }

        if character.is_control() && character != '\n' && character != '\r' && character != '\t' {
            continue;
        }

        output.push(character);
    }

    output
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{latest_output_text, record_update, LatestOutputUpdate, SessionOutputState};

    #[test]
    fn extracts_latest_non_empty_output_line() {
        assert_eq!(
            latest_output_text("first line\nsecond line\n").as_deref(),
            Some("second line")
        );
    }

    #[test]
    fn strips_terminal_control_sequences_before_extracting_output() {
        let mut states = HashMap::<i64, SessionOutputState>::new();
        record_update(
            &mut states,
            LatestOutputUpdate {
                session_id: 42,
                sequence: 1,
                data: b"\x1b[2K\r\x1b[32mRunning tests\x1b[0m".to_vec(),
            },
        );

        assert_eq!(
            states
                .get(&42)
                .and_then(|state| state.pending.as_ref())
                .map(|pending| pending.text.as_str()),
            Some("Running tests")
        );
    }

    #[test]
    fn combines_split_terminal_output_before_selecting_latest_line() {
        let mut states = HashMap::<i64, SessionOutputState>::new();
        record_update(
            &mut states,
            LatestOutputUpdate {
                session_id: 7,
                sequence: 1,
                data: b"Running pnpm ".to_vec(),
            },
        );
        record_update(
            &mut states,
            LatestOutputUpdate {
                session_id: 7,
                sequence: 2,
                data: b"test\n".to_vec(),
            },
        );

        assert_eq!(
            states
                .get(&7)
                .and_then(|state| state.pending.as_ref())
                .map(|pending| pending.text.as_str()),
            Some("Running pnpm test")
        );
    }
}
