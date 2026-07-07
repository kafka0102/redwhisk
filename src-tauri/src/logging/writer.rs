use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

use chrono::{Local, TimeZone};

use crate::logging::{LogEntry, LogLevel};

/// 静默期达到该阈值即触发一次落盘。
const FLUSH_AFTER_QUIET_MS: u64 = 250;
/// 即使持续有日志，也最多间隔该阈值落盘一次，避免延迟过大。
const FLUSH_MAX_LATENCY_MS: u64 = 1_000;
/// 后台通道容量；超出时丢弃最旧的待写日志，绝不阻塞业务线程。
const CHANNEL_CAPACITY: usize = 4096;

#[derive(Clone)]
pub(crate) struct LogWriter {
    sender: mpsc::SyncSender<LogEntry>,
}

impl LogWriter {
    pub(crate) fn new(data_dir: PathBuf) -> Self {
        let (sender, receiver) = mpsc::sync_channel::<LogEntry>(CHANNEL_CAPACITY);
        thread::spawn(move || run_writer(data_dir, receiver));
        Self { sender }
    }

    pub(crate) fn log(&self, entry: LogEntry) {
        // 通道满或已断开时丢弃日志，绝不阻塞业务线程。
        let _ = self.sender.try_send(entry);
    }
}

fn run_writer(data_dir: PathBuf, receiver: mpsc::Receiver<LogEntry>) {
    let logs_dir = data_dir.join("logs");
    let _ = std::fs::create_dir_all(&logs_dir);

    let mut buffer: Vec<LogEntry> = Vec::new();
    let mut last_flush = Instant::now();

    loop {
        match receiver.recv_timeout(Duration::from_millis(FLUSH_AFTER_QUIET_MS)) {
            Ok(entry) => {
                buffer.push(entry);
                if last_flush.elapsed() >= Duration::from_millis(FLUSH_MAX_LATENCY_MS) {
                    flush(&logs_dir, &mut buffer);
                    last_flush = Instant::now();
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if !buffer.is_empty() {
                    flush(&logs_dir, &mut buffer);
                    last_flush = Instant::now();
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                flush(&logs_dir, &mut buffer);
                break;
            }
        }
    }
}

fn flush(logs_dir: &Path, buffer: &mut Vec<LogEntry>) {
    if buffer.is_empty() {
        return;
    }

    // 按月份分组，同月日志写入同一文件，跨月自然切分。
    let mut groups: HashMap<String, Vec<&LogEntry>> = HashMap::new();
    for entry in buffer.iter() {
        let month_key = month_key_from_epoch(entry.timestamp_millis);
        groups.entry(month_key).or_default().push(entry);
    }

    for (month_key, entries) in groups {
        let file_path = logs_dir.join(format!("{month_key}.log"));
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file_path)
        {
            for entry in entries {
                let _ = writeln!(file, "{}", format_entry(entry));
            }
        }
    }

    buffer.clear();
}

fn format_entry(entry: &LogEntry) -> String {
    let timestamp = Local
        .timestamp_millis_opt(entry.timestamp_millis)
        .single()
        .map(|datetime| datetime.format("%Y-%m-%d %H:%M:%S%.3f").to_string())
        .unwrap_or_else(|| entry.timestamp_millis.to_string());
    let level = match entry.level {
        LogLevel::Info => "INFO",
        LogLevel::Error => "ERROR",
    };
    let fields = if entry.fields.is_empty() {
        String::new()
    } else {
        let pairs = entry
            .fields
            .iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>()
            .join(" ");
        format!(" {pairs}")
    };
    format!(
        "{timestamp} [{level}] [{op}] {msg}{fields}",
        op = entry.operation,
        msg = entry.message,
    )
}

fn month_key_from_epoch(timestamp_millis: i64) -> String {
    Local
        .timestamp_millis_opt(timestamp_millis)
        .single()
        .map(|datetime| datetime.format("%Y-%m").to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use tempfile::TempDir;

    use super::{flush, format_entry, month_key_from_epoch};
    use crate::logging::{LogEntry, LogLevel};

    fn entry(timestamp_millis: i64, level: LogLevel, operation: &str, message: &str) -> LogEntry {
        LogEntry {
            timestamp_millis,
            level,
            operation: operation.to_string(),
            message: message.to_string(),
            fields: Vec::new(),
        }
    }

    fn entry_with_fields(
        timestamp_millis: i64,
        level: LogLevel,
        operation: &str,
        message: &str,
        fields: Vec<(&str, &str)>,
    ) -> LogEntry {
        LogEntry {
            timestamp_millis,
            level,
            operation: operation.to_string(),
            message: message.to_string(),
            fields: fields
                .into_iter()
                .map(|(key, value)| (key.to_string(), value.to_string()))
                .collect(),
        }
    }

    #[test]
    fn month_key_uses_local_year_month() {
        // 2026-07-07T12:00:00Z 的本地年月随时区变化，但一定是有效的 YYYY-MM。
        let key = month_key_from_epoch(1783195200000);
        assert!(key.len() == 7, "month key should be YYYY-MM, got {key}");
        assert_eq!(key.chars().nth(4), Some('-'));
    }

    #[test]
    fn format_entry_includes_timestamp_level_operation_and_message() {
        let entry = entry_with_fields(
            1783195200000,
            LogLevel::Info,
            "complete_issue_flow",
            "issue completed",
            vec![("issueId", "42"), ("commitHash", "abc1234")],
        );

        let line = format_entry(&entry);
        assert!(line.contains("[INFO]"), "line: {line}");
        assert!(line.contains("[complete_issue_flow]"), "line: {line}");
        assert!(line.contains("issue completed"), "line: {line}");
        assert!(line.contains("issueId=42"), "line: {line}");
        assert!(line.contains("commitHash=abc1234"), "line: {line}");
    }

    #[test]
    fn flush_writes_entries_into_monthly_file_split_by_month() {
        let temp = TempDir::new().expect("create temp dir");
        let logs_dir: PathBuf = temp.path().join("logs");
        // 生产中由 run_writer 启动时创建一次 logs 目录，测试镜像该前置条件。
        fs::create_dir_all(&logs_dir).expect("create logs dir");

        // 同月两条 + 次月一条。
        let mut buffer = vec![
            entry(1783195200000, LogLevel::Info, "op_a", "first in month"),
            entry(1783195200000, LogLevel::Error, "op_b", "second in month"),
            entry(1814731200000, LogLevel::Info, "op_c", "next month entry"),
        ];

        flush(&logs_dir, &mut buffer);

        let mut log_files: Vec<String> = fs::read_dir(&logs_dir)
            .expect("read logs dir")
            .filter_map(|entry| {
                let entry = entry.ok()?;
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".log") {
                    Some(name)
                } else {
                    None
                }
            })
            .collect();
        log_files.sort();

        // 跨两个月应切分成两个文件。
        assert_eq!(log_files.len(), 2, "log files: {log_files:?}");

        let combined: String = log_files
            .iter()
            .map(|name| fs::read_to_string(logs_dir.join(name)).expect("read log file content"))
            .collect::<Vec<_>>()
            .join("\n");

        assert!(combined.contains("first in month"), "combined: {combined}");
        assert!(combined.contains("second in month"), "combined: {combined}");
        assert!(combined.contains("[ERROR]"), "combined: {combined}");
        assert!(
            combined.contains("next month entry"),
            "combined: {combined}"
        );
        assert!(buffer.is_empty(), "buffer should be cleared after flush");
    }
}
