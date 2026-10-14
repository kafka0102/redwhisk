//! 按字节偏移只读会话日志的一行。

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

/// 折叠项回读：`offset` 指向会话日志行的起始字节，只读这一行。
pub(super) fn read_session_log_line_at(path: &Path, offset: u64) -> io::Result<String> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    if offset > len {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "session log offset is past end of file",
        ));
    }
    file.seek(SeekFrom::Start(offset))?;
    let mut line = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        let read = file.read(&mut byte)?;
        if read == 0 || byte[0] == b'\n' {
            break;
        }
        line.push(byte[0]);
        if line.len() > 32 * 1024 * 1024 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "session log line exceeds read limit",
            ));
        }
    }
    if offset < len && line_starts_mid_record(&line) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "session log offset is not at a line start",
        ));
    }
    String::from_utf8(line).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn line_starts_mid_record(line: &[u8]) -> bool {
    let start = line
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(line.len());
    let trimmed = &line[start..];
    trimmed
        .first()
        .is_some_and(|byte| *byte != b'{' && *byte != b'[')
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn line_at_offset_reads_only_that_line() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("session.jsonl");
        let first = r#"{"event":{"type":"turn_started","turnId":"t0"}}"#;
        let target = r#"{"event":{"type":"timeline","item":{"text":"正文-汉"}}}"#;
        let last = r#"{"event":{"type":"turn_started","turnId":"t2"}}"#;
        fs::write(&path, format!("{first}\n{target}\n{last}\n")).expect("write");
        let body = fs::read(&path).expect("read");
        let offset = body
            .windows(target.len())
            .position(|window| window == target.as_bytes())
            .expect("offset") as u64;
        assert_eq!(
            read_session_log_line_at(&path, offset).expect("line"),
            target
        );
        let error = read_session_log_line_at(&path, offset + 3).expect_err("mid line");
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        let past = read_session_log_line_at(&path, body.len() as u64 + 1).expect_err("past end");
        assert_eq!(past.kind(), io::ErrorKind::InvalidInput);
    }
}
