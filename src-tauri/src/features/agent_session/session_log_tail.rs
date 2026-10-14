//! 从 session log 末尾读取有限行。
//!
//! Grok 子代理会把同一条正文的完整快照逐帧追加，整文件可达几十 GB。
//! 打开会话、归档和轮次评论只需要最近一段，不能从文件头顺序读完全文。

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

/// 结构化 session log 回放的最大行数。
pub(super) const SESSION_LOG_TAIL_LINES: usize = 100;

const TAIL_CHUNK_START: u64 = 64 * 1024;
const TAIL_CHUNK_MAX: u64 = 1024 * 1024;

pub(super) fn read_session_log_tail_lines(path: &Path, limit: usize) -> io::Result<Vec<String>> {
    read_session_log_tail_lines_chunked(path, limit, TAIL_CHUNK_START)
}

fn read_session_log_tail_lines_chunked(
    path: &Path,
    limit: usize,
    chunk_start: u64,
) -> io::Result<Vec<String>> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    if len == 0 {
        return Ok(Vec::new());
    }

    let mut offset = len;
    let mut newline_count = 0usize;
    let mut buffer: Vec<u8> = Vec::new();
    let mut chunk_size = chunk_start.max(1);

    while offset > 0 && newline_count <= limit {
        let read_size = chunk_size.min(offset);
        offset -= read_size;
        file.seek(SeekFrom::Start(offset))?;
        let mut chunk = vec![0u8; read_size as usize];
        file.read_exact(&mut chunk)?;
        newline_count += chunk.iter().filter(|byte| **byte == b'\n').count();
        chunk.append(&mut buffer);
        buffer = chunk;
        chunk_size = chunk_size.saturating_mul(2).min(TAIL_CHUNK_MAX);
    }

    // 倒读的起点可能落在一行中间，甚至落在多字节字符中间。只解码第一个换行之后的字节。
    let start = if offset > 0 {
        buffer
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|index| index + 1)
            .unwrap_or(buffer.len())
    } else {
        0
    };
    let text = String::from_utf8(buffer[start..].to_vec())
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let mut lines: Vec<String> = text.split('\n').map(ToOwned::to_owned).collect();
    if lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    lines.retain(|line| !line.is_empty());
    if lines.len() > limit {
        lines = lines.split_off(lines.len() - limit);
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

    fn line(index: usize) -> String {
        format!("L{index}-汉")
    }

    #[test]
    fn tail_matches_last_lines_across_chunk_sizes_and_trailing_newline() {
        for count in [0usize, 1, 2, 5, 100, 101, 150] {
            for trailing_newline in [true, false] {
                for chunk in [1u64, 2, 3, 5, 8, 64, 65_536] {
                    let lines = (0..count).map(line).collect::<Vec<_>>();
                    let dir = write_log(&lines, trailing_newline);
                    let path = dir.path().join("session.jsonl");
                    for limit in [1usize, 2, 100] {
                        let got =
                            read_session_log_tail_lines_chunked(&path, limit, chunk).expect("tail");
                        let start = count.saturating_sub(limit);
                        assert_eq!(
                            got,
                            lines[start..],
                            "count={count} limit={limit} chunk={chunk} trailing={trailing_newline}"
                        );
                    }
                }
            }
        }
    }
}
