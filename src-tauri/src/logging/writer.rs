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

    // 正常日志按月分组：包含全部条目（Info + Error），写入 `{YYYY-MM}.log`。
    let mut normal_groups: HashMap<String, Vec<&LogEntry>> = HashMap::new();
    // error 日志按月分组：仅 Error 条目，写入 `{YYYY-MM}.error.log`。
    // Error 条目因此同时落在正常日志与 error 日志，便于独立排查。
    let mut error_groups: HashMap<String, Vec<&LogEntry>> = HashMap::new();
    for entry in buffer.iter() {
        let month_key = month_key_from_epoch(entry.timestamp_millis);
        normal_groups.entry(month_key.clone()).or_default().push(entry);
        if entry.level == LogLevel::Error {
            error_groups.entry(month_key).or_default().push(entry);
        }
    }

    for (month_key, entries) in normal_groups {
        write_entries(logs_dir, &format!("{month_key}.log"), &entries);
    }
    for (month_key, entries) in error_groups {
        write_entries(logs_dir, &format!("{month_key}.error.log"), &entries);
    }

    buffer.clear();
}

/// 将条目追加写入 `logs_dir/<file_name>`；打开失败时静默跳过，绝不阻塞后台线程。
fn write_entries(logs_dir: &Path, file_name: &str, entries: &[&LogEntry]) {
    let file_path = logs_dir.join(file_name);
    let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
    else {
        return;
    };
    for entry in entries {
        let _ = writeln!(file, "{}", format_entry(entry));
    }
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

        // 同月两条（Info + Error）+ 次月一条（Info）。
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

        // 正常日志跨两个月各一个 + 同月 error 日志一个 = 3 个 `.log` 文件。
        assert_eq!(log_files.len(), 3, "log files: {log_files:?}");

        let combined: String = log_files
            .iter()
            .map(|name| fs::read_to_string(logs_dir.join(name)).expect("read log file content"))
            .collect::<Vec<_>>()
            .join("\n");

        // 正常日志含全部条目（Info + Error）。
        assert!(combined.contains("first in month"), "combined: {combined}");
        assert!(combined.contains("second in month"), "combined: {combined}");
        assert!(combined.contains("[ERROR]"), "combined: {combined}");
        assert!(
            combined.contains("next month entry"),
            "combined: {combined}"
        );

        // error 日志仅一个（同月那条 Error），且只含 Error 条目。
        let error_files: Vec<&String> = log_files
            .iter()
            .filter(|name| name.ends_with(".error.log"))
            .collect();
        assert_eq!(error_files.len(), 1, "error files: {error_files:?}");
        let error_content =
            fs::read_to_string(logs_dir.join(error_files[0])).expect("read error log file content");
        assert!(
            error_content.contains("second in month"),
            "error_content: {error_content}"
        );
        assert!(
            error_content.contains("[ERROR]"),
            "error_content: {error_content}"
        );
        assert!(
            !error_content.contains("first in month"),
            "error file should not include info entry: {error_content}"
        );
        assert!(
            !error_content.contains("next month entry"),
            "error file should not include next month entry: {error_content}"
        );

        assert!(buffer.is_empty(), "buffer should be cleared after flush");
    }

    #[test]
    fn error_entries_written_to_both_normal_and_error_file() {
        let temp = TempDir::new().expect("create temp dir");
        let logs_dir: PathBuf = temp.path().join("logs");
        fs::create_dir_all(&logs_dir).expect("create logs dir");

        // 同月 1 Info + 1 Error。
        let mut buffer = vec![
            entry(1783195200000, LogLevel::Info, "op_info", "info only"),
            entry(1783195200000, LogLevel::Error, "op_err", "error duplicated"),
        ];

        flush(&logs_dir, &mut buffer);

        let mut names: Vec<String> = fs::read_dir(&logs_dir)
            .expect("read logs dir")
            .filter_map(|entry| entry.ok().map(|entry| entry.file_name().to_string_lossy().to_string()))
            .collect();
        names.sort();

        // 同月应产生正好两个文件：正常日志 + error 日志。
        assert_eq!(names.len(), 2, "files: {names:?}");

        let normal_name = names
            .iter()
            .find(|name| name.ends_with(".log") && !name.ends_with(".error.log"))
            .expect("normal log file should exist");
        let error_name = names
            .iter()
            .find(|name| name.ends_with(".error.log"))
            .expect("error log file should exist");

        let normal = fs::read_to_string(logs_dir.join(normal_name)).expect("read normal log");
        let error = fs::read_to_string(logs_dir.join(error_name)).expect("read error log");

        // 正常日志同时含 Info 与 Error。
        assert!(normal.contains("info only"), "normal: {normal}");
        assert!(normal.contains("error duplicated"), "normal: {normal}");
        assert!(normal.contains("[INFO]"), "normal: {normal}");
        assert!(normal.contains("[ERROR]"), "normal: {normal}");

        // error 日志只含 Error，不含 Info。
        assert!(error.contains("error duplicated"), "error: {error}");
        assert!(error.contains("[ERROR]"), "error: {error}");
        assert!(
            !error.contains("info only"),
            "error file should not include info entry: {error}"
        );
        assert!(
            !error.contains("[INFO]"),
            "error file should not include info level: {error}"
        );
    }
}
