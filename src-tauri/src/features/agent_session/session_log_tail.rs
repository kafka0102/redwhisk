//! 按 Turn 从 session log 末尾开窗。
//!
//! Grok 会把同一条正文的完整快照逐帧追加，整文件可达几十 GB。
//! 打开回放和交付评论都不能把整份日志读进内存。

use std::cell::Cell;
use std::fs::File;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

#[cfg(test)]
thread_local! {
    static TAIL_PEAK: Cell<usize> = const { Cell::new(0) };
}

fn note_tail_peak(len: usize) {
    #[cfg(test)]
    TAIL_PEAK.with(|peak| {
        if len > peak.get() {
            peak.set(len);
        }
    });
    #[cfg(not(test))]
    let _ = len;
}

#[cfg(test)]
pub(super) fn reset_tail_peak() {
    TAIL_PEAK.with(|peak| peak.set(0));
}

#[cfg(test)]
pub(super) fn tail_peak_bytes() -> usize {
    TAIL_PEAK.with(|peak| peak.get())
}

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

const SESSION_LOG_LINE_MAX_BYTES: usize = 32 * 1024 * 1024;

/// 逐行访问打开回放窗口。回调里的行字节只在本次调用期间有效。
/// 倒序定位 Turn 时只保留当前块和跨块的半行，不会把整份日志留在内存里。
pub(super) fn for_each_session_log_line_in_turn_window(
    path: &Path,
    turn_limit: usize,
    visit: impl FnMut(u64, &[u8]) -> io::Result<()>,
) -> io::Result<()> {
    for_each_session_log_line_in_turn_window_chunked(path, turn_limit, TAIL_CHUNK_START, visit)
}

fn read_session_log_turn_window_chunked(
    path: &Path,
    turn_limit: usize,
    chunk_start: u64,
) -> io::Result<Vec<SessionLogLine>> {
    let mut lines = Vec::new();
    let mut retained = 0usize;
    for_each_session_log_line_in_turn_window_chunked(
        path,
        turn_limit,
        chunk_start,
        |offset, line| {
            let text = std::str::from_utf8(line)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
            retained = retained.saturating_add(text.len());
            note_tail_peak(retained);
            lines.push(SessionLogLine {
                offset,
                text: text.to_owned(),
            });
            Ok(())
        },
    )?;
    Ok(lines)
}

fn for_each_session_log_line_in_turn_window_chunked(
    path: &Path,
    turn_limit: usize,
    chunk_start: u64,
    mut visit: impl FnMut(u64, &[u8]) -> io::Result<()>,
) -> io::Result<()> {
    if turn_limit == 0 {
        return Ok(());
    }
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    if len == 0 {
        return Ok(());
    }
    let start = find_turn_window_start(&mut file, len, turn_limit, chunk_start.max(1))?;
    read_lines_forward(&mut file, start, &mut visit)
}

/// 从文件末尾按块倒序数 `turn_started`。凑满 `turn_limit` 时返回该行起点；
/// 不足则返回 0。完整行数完即丢，内存只留下一块和至多一行的跨块残余。
fn find_turn_window_start(
    file: &mut File,
    len: u64,
    turn_limit: usize,
    mut chunk_size: u64,
) -> io::Result<u64> {
    let mut end = len;
    let mut carry: Vec<u8> = Vec::new();
    let mut seen = 0usize;
    while end > 0 {
        let read_size = chunk_size.min(end);
        let start = end - read_size;
        file.seek(SeekFrom::Start(start))?;
        let mut buf = vec![0u8; read_size as usize];
        file.read_exact(&mut buf)?;
        buf.append(&mut carry);
        note_tail_peak(buf.len());
        if let Some(offset) = take_turn_window_start(&buf, start, start == 0, turn_limit, &mut seen)
        {
            return Ok(offset);
        }
        if start == 0 {
            return Ok(0);
        }
        let prefix_len = buf
            .iter()
            .position(|byte| *byte == b'\n')
            .unwrap_or(buf.len());
        if prefix_len > SESSION_LOG_LINE_MAX_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "session log line exceeds read limit",
            ));
        }
        carry = buf[..prefix_len].to_vec();
        end = start;
        chunk_size = chunk_size.saturating_mul(2).min(TAIL_CHUNK_MAX);
    }
    Ok(0)
}

fn take_turn_window_start(
    data: &[u8],
    data_offset: u64,
    at_file_start: bool,
    turn_limit: usize,
    seen: &mut usize,
) -> Option<u64> {
    let mut line_start = if at_file_start {
        0
    } else {
        match data.iter().position(|byte| *byte == b'\n') {
            Some(index) => index + 1,
            None => return None,
        }
    };
    let mut ranges = Vec::new();
    for (index, byte) in data.iter().enumerate().skip(line_start) {
        if *byte == b'\n' {
            ranges.push((line_start, index));
            line_start = index + 1;
        }
    }
    if line_start < data.len() {
        ranges.push((line_start, data.len()));
    }
    for (start, end) in ranges.into_iter().rev() {
        if !line_is_turn_started(&data[start..end]) {
            continue;
        }
        *seen += 1;
        if *seen == turn_limit {
            return Some(data_offset + start as u64);
        }
    }
    None
}

fn read_lines_forward(
    file: &mut File,
    start: u64,
    visit: &mut impl FnMut(u64, &[u8]) -> io::Result<()>,
) -> io::Result<()> {
    file.seek(SeekFrom::Start(start))?;
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    let mut offset = start;
    loop {
        line.clear();
        let read = reader.read_until(b'\n', &mut line)?;
        if read == 0 {
            break;
        }
        if line.last() == Some(&b'\n') {
            line.pop();
        }
        if line.len() > SESSION_LOG_LINE_MAX_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "session log line exceeds read limit",
            ));
        }
        note_tail_peak(line.len());
        if !line.is_empty() {
            visit(offset, &line)?;
        }
        offset += read as u64;
    }
    Ok(())
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
