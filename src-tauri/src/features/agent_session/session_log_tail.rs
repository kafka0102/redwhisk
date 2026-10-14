//! 按 Turn 从 session log 末尾开窗。
//!
//! Grok 会把同一条正文的完整快照逐帧追加，整文件可达几十 GB。
//! 打开回放和交付评论都不能把整份日志读进内存。

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

/// 打开回放与交付评论保留的 Turn 数（以 `turn_started` 计，含未结束的当前 Turn）。
pub(super) const OPEN_REPLAY_TURN_LIMIT: usize = 50;

const TAIL_CHUNK_START: u64 = 64 * 1024;
const TAIL_CHUNK_MAX: u64 = 1024 * 1024;

/// 会话日志一行，以及它在文件中的起始字节。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SessionLogLine {
    pub offset: u64,
    pub text: String,
}

/// 从文件末尾倒序凑满 `turn_limit` 个 `turn_started`，返回该起点到文件末尾的行。
/// 不足则返回全部可读行。起点落在一行中间时从下一行开始。
#[cfg(test)]
pub(super) fn read_session_log_turn_window(
    path: &Path,
    turn_limit: usize,
) -> io::Result<Vec<String>> {
    Ok(read_session_log_turn_window_located(path, turn_limit)?
        .into_iter()
        .map(|line| line.text)
        .collect())
}

pub(super) fn read_session_log_turn_window_located(
    path: &Path,
    turn_limit: usize,
) -> io::Result<Vec<SessionLogLine>> {
    read_session_log_turn_window_chunked(path, turn_limit, TAIL_CHUNK_START)
}

fn read_session_log_turn_window_chunked(
    path: &Path,
    turn_limit: usize,
    chunk_start: u64,
) -> io::Result<Vec<SessionLogLine>> {
    if turn_limit == 0 {
        return Ok(Vec::new());
    }
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    if len == 0 {
        return Ok(Vec::new());
    }

    let mut offset = len;
    let mut buffer: Vec<u8> = Vec::new();
    let mut chunk_size = chunk_start.max(1);

    while offset > 0 {
        let read_size = chunk_size.min(offset);
        offset -= read_size;
        file.seek(SeekFrom::Start(offset))?;
        let mut chunk = vec![0u8; read_size as usize];
        file.read_exact(&mut chunk)?;
        chunk.append(&mut buffer);
        buffer = chunk;

        if let Some(relative) = turn_window_start_in_buffer(&buffer, offset == 0, turn_limit) {
            if relative > 0 {
                buffer.drain(..relative);
            }
            return decode_located_lines(&buffer, offset + relative as u64);
        }
        chunk_size = chunk_size.saturating_mul(2).min(TAIL_CHUNK_MAX);
    }

    decode_located_lines(&buffer, 0)
}

/// 在已倒读的字节里定位窗口起点。
/// 凑满 `turn_limit` 个 `turn_started` 时返回该行在 buffer 内的起点。
/// 块开头可能是半行，不参与计数；尚未凑满时返回 `None`。
fn turn_window_start_in_buffer(
    buffer: &[u8],
    at_file_start: bool,
    turn_limit: usize,
) -> Option<usize> {
    let mut ranges = Vec::new();
    let mut line_start = if at_file_start {
        0
    } else {
        match buffer.iter().position(|byte| *byte == b'\n') {
            Some(index) => index + 1,
            None => return None,
        }
    };
    for (index, byte) in buffer.iter().enumerate().skip(line_start) {
        if *byte == b'\n' {
            ranges.push((line_start, index));
            line_start = index + 1;
        }
    }
    if line_start < buffer.len() {
        ranges.push((line_start, buffer.len()));
    }

    let mut seen = 0usize;
    for (start, end) in ranges.iter().rev() {
        if !line_is_turn_started(&buffer[*start..*end]) {
            continue;
        }
        seen += 1;
        if seen == turn_limit {
            return Some(*start);
        }
    }
    None
}

fn line_is_turn_started(line: &[u8]) -> bool {
    let trimmed = trim_ascii(line);
    if trimmed.is_empty() {
        return false;
    }
    const MARKER: &[u8] = b"\"turn_started\"";
    trimmed.windows(MARKER.len()).any(|window| window == MARKER)
}

fn trim_ascii(bytes: &[u8]) -> &[u8] {
    let start = bytes
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(bytes.len());
    let end = bytes
        .iter()
        .rposition(|byte| !byte.is_ascii_whitespace())
        .map(|index| index + 1)
        .unwrap_or(start);
    &bytes[start..end]
}

fn decode_located_lines(bytes: &[u8], start_offset: u64) -> io::Result<Vec<SessionLogLine>> {
    let text = String::from_utf8(bytes.to_vec())
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let mut lines = Vec::new();
    let mut cursor = 0usize;
    for raw in text.split('\n') {
        let next = cursor + raw.len();
        if !raw.is_empty() {
            lines.push(SessionLogLine {
                offset: start_offset + cursor as u64,
                text: raw.to_owned(),
            });
        }
        cursor = next + 1;
    }
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_log(lines: &[String], trailing_newline: bool) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("temp dir");
        let mut body = lines.join("\n");
        if trailing_newline {
            body.push('\n');
        }
        fs::write(dir.path().join("session.jsonl"), body).expect("write log");
        dir
    }

    fn turn_line(index: usize) -> String {
        format!(r#"{{"event":{{"type":"turn_started","turnId":"t{index}"}}}}"#)
    }

    fn message_line(index: usize) -> String {
        format!(r#"{{"event":{{"type":"timeline","item":{{"text":"正文{index}-汉"}}}}}}"#)
    }

    #[test]
    fn turn_window_starts_at_the_50th_turn_from_the_end() {
        let mut lines = Vec::new();
        for index in 0..60 {
            lines.push(turn_line(index));
            lines.push(message_line(index));
        }
        for trailing_newline in [true, false] {
            for chunk in [1u64, 7, 64, 65_536] {
                let dir = write_log(&lines, trailing_newline);
                let path = dir.path().join("session.jsonl");
                let got = read_session_log_turn_window_chunked(&path, 50, chunk).expect("window");
                assert_eq!(got.len(), 100, "chunk={chunk} trailing={trailing_newline}");
                assert_eq!(got[0].text, turn_line(10));
                assert!(got[0].offset > 0 || !trailing_newline);
                assert_eq!(
                    got.last().map(|line| line.text.as_str()),
                    Some(message_line(59).as_str())
                );
            }
        }
    }

    #[test]
    fn turn_window_reads_the_whole_file_when_fewer_than_limit() {
        let lines = vec![message_line(0), turn_line(1), message_line(1)];
        let dir = write_log(&lines, true);
        let path = dir.path().join("session.jsonl");
        let got = read_session_log_turn_window(&path, 50).expect("window");
        assert_eq!(got, lines);
    }

    #[test]
    fn turn_window_counts_an_unfinished_turn() {
        let lines = vec![turn_line(0), message_line(0), turn_line(1), message_line(1)];
        let dir = write_log(&lines, false);
        let path = dir.path().join("session.jsonl");
        let got = read_session_log_turn_window(&path, 2).expect("window");
        assert_eq!(got, lines);
        let one = read_session_log_turn_window(&path, 1).expect("window");
        assert_eq!(one, vec![turn_line(1), message_line(1)]);
    }
}
