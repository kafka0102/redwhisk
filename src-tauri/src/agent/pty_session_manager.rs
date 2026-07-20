use std::collections::HashMap;
#[cfg(test)]
use std::collections::HashSet;
use std::env;
use std::ffi::OsString;
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Read, Write};
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};

const RESTORE_BUFFER_MAX_BYTES: usize = 1_048_576;
const LOG_MAX_BYTES: usize = 32 * 1024 * 1024;
const LOG_FLUSH_EVERY_BYTES: usize = 64 * 1024;
const LOG_TRIM_CHECK_EVERY_BYTES: usize = 8 * 1024 * 1024;
const EMIT_COALESCE_MAX_BYTES: usize = 64 * 1024;
// 交互回显优先：合并窗口过大会让 TUI 输入（如 grok）感觉“粘滞”。
const EMIT_COALESCE_MAX_MS: u64 = 4;
const COALESCE_TICK_MS: u64 = 2;

#[derive(Clone)]
pub struct PtySessionManager {
    store: Arc<PtySessionStore>,
}

struct PtySessionStore {
    sessions: Mutex<HashMap<i64, Arc<PtySessionHandle>>>,
    output_sink: Mutex<Option<Arc<dyn Fn(PtyOutputEvent) + Send + Sync>>>,
    subscribers: Mutex<HashMap<i64, usize>>,
    pending_emits: Mutex<HashMap<i64, PendingEmit>>,
    app_theme: Mutex<TerminalBackgroundTheme>,
    interactive_path: Mutex<Option<OsString>>,
    #[cfg(test)]
    kill_failures: Mutex<HashSet<i64>>,
}

struct PtySessionHandle {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    restore_buffer: Mutex<PtyRestoreBuffer>,
    log: Mutex<PtyLogWriter>,
}

struct PtyLogWriter {
    path: std::path::PathBuf,
    file: Option<BufWriter<File>>,
    unflushed_bytes: usize,
    bytes_since_trim_check: usize,
}

struct PendingEmit {
    project_id: i64,
    session_id: i64,
    sequence: u64,
    data: Vec<u8>,
    first_at: Instant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PtyCommandMode {
    /// 以 `exec <command> [prompt] || exit $?` 启动：命令替换 shell，退出即结束 session。
    ExecReplace,
    /// 命令在非交互 login shell 中执行，结束后 `exec $SHELL -li` 落到交互式 login shell。
    InteractiveRun,
}

/// 应用终端背景主题，用于在 spawn 时向 PTY 子进程声明背景深浅（注入 `COLORFGBG`），
/// 使 Claude Code / Codex 等 CLI 能按终端实际背景选择匹配的配色，避免深色背景上深色
/// 输出不可见（或反之）。值由前端解析 `light` / `dark`（含 system 跟随）后同步。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalBackgroundTheme {
    Light,
    Dark,
}

impl TerminalBackgroundTheme {
    /// 返回 `COLORFGBG` 取值（`"fg;bg"`）。CLI 按 bg 索引判定深浅：
    /// bg 0–6/8 判为 dark，7/9–15 判为 light。dark 取近黑背景(0)，light 取近白背景(15)，
    /// fg 取与该主题默认前景对应的反色索引。
    fn color_fgbg(self) -> &'static str {
        match self {
            TerminalBackgroundTheme::Dark => "15;0",
            TerminalBackgroundTheme::Light => "0;15",
        }
    }
}

pub struct PtySpawnRequest {
    pub mode: PtyCommandMode,
    pub command: String,
    pub working_dir: String,
    pub log_path: String,
    pub initial_prompt: Option<String>,
    pub rows: u16,
    pub cols: u16,
    pub startup_check_total_ms: u64,
    pub startup_check_interval_ms: u64,
}

pub struct PendingPtySession {
    child: Box<dyn Child + Send + Sync>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    log_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyOutputEvent {
    pub project_id: i64,
    pub session_id: i64,
    pub sequence: u64,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyRestoreSnapshot {
    pub session_id: i64,
    pub sequence: u64,
    pub chunks: Vec<Vec<u8>>,
    pub is_complete: bool,
}

struct PtyRestoreBuffer {
    chunks: Vec<Vec<u8>>,
    total_bytes: usize,
    latest_sequence: u64,
    is_complete: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PtyExitStatus {
    pub exit_code: Option<i32>,
}

pub struct PtyRegisterError {
    pub message: String,
    pub pending: PendingPtySession,
}

impl std::fmt::Debug for PtyRegisterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PtyRegisterError")
            .field("message", &self.message)
            .finish()
    }
}

impl PtySessionManager {
    pub fn new() -> Self {
        let store = Arc::new(PtySessionStore {
            sessions: Mutex::new(HashMap::new()),
            output_sink: Mutex::new(None),
            subscribers: Mutex::new(HashMap::new()),
            pending_emits: Mutex::new(HashMap::new()),
            // 前端未同步前的保守默认：与无 COLORFGBG 时多数 CLI 的 dark fallback 等价，
            // 避免极端时序下误判为 light 导致深色背景上输出不可见。
            app_theme: Mutex::new(TerminalBackgroundTheme::Dark),
            interactive_path: Mutex::new(None),
            #[cfg(test)]
            kill_failures: Mutex::new(HashSet::new()),
        });
        spawn_coalesce_thread(Arc::clone(&store));
        Self { store }
    }

    /// 更新终端背景主题；后续 spawn 的 PTY 会据此注入 `COLORFGBG`。
    /// 已运行的 session 不会回溯更新（子进程仅在启动时读取一次该变量）。
    pub fn set_theme(&self, theme: TerminalBackgroundTheme) {
        if let Ok(mut app_theme) = self.store.app_theme.lock() {
            *app_theme = theme;
        }
    }

    /// 解析并缓存「login+interactive shell」的完整 `$PATH`，供 PTY 子进程注入。
    ///
    /// 命中缓存直接返回；否则以用户首选 shell 的 `-lic` 解析一次（加载 `.zshrc` 等
    /// 交互式配置，得到含 nvm/fnm 等目录的完整 PATH），成功后缓存供后续 spawn 复用。
    /// 解析在释放锁的状态下进行，避免持锁 fork 子进程阻塞并发 spawn。
    /// 解析失败不缓存、返回 `None`，调用方回退到继承的 PATH（与历史行为一致）。
    fn resolved_interactive_path(&self) -> Option<OsString> {
        if let Ok(guard) = self.store.interactive_path.lock() {
            if let Some(cached) = guard.as_ref() {
                return Some(cached.clone());
            }
        }

        let resolved = crate::agent::command_detector::resolve_interactive_shell_path();
        if let Some(resolved) = resolved.as_ref() {
            if let Ok(mut guard) = self.store.interactive_path.lock() {
                *guard = Some(resolved.clone());
            }
        }
        resolved
    }

    pub fn set_output_sink<F>(&self, sink: F)
    where
        F: Fn(PtyOutputEvent) + Send + Sync + 'static,
    {
        if let Ok(mut output_sink) = self.store.output_sink.lock() {
            *output_sink = Some(Arc::new(sink));
        }
    }

    /// 增加可见订阅计数；`count > 0` 时才会向 output_sink 推送 live 输出。
    /// 订阅前先 flush log，保证随后的 catch-up 能读到最新尾部。
    pub fn add_output_subscriber(&self, session_id: i64) {
        let _ = self.flush_log(session_id);
        if let Ok(mut subscribers) = self.store.subscribers.lock() {
            let count = subscribers.entry(session_id).or_insert(0);
            *count = count.saturating_add(1);
        }
    }

    /// 减少可见订阅计数；归零时丢弃 pending emit（不向 sink 推送）。
    pub fn remove_output_subscriber(&self, session_id: i64) {
        let should_discard_pending = {
            let Ok(mut subscribers) = self.store.subscribers.lock() else {
                return;
            };
            let Some(count) = subscribers.get_mut(&session_id) else {
                return;
            };
            *count = count.saturating_sub(1);
            if *count == 0 {
                subscribers.remove(&session_id);
                true
            } else {
                false
            }
        };
        if should_discard_pending {
            discard_pending_session(&self.store, session_id);
        }
    }

    /// 将 session 终端 log 刷到 OS（catch-up / 外部读之前调用）。
    pub fn flush_log(&self, session_id: i64) -> Result<(), String> {
        let session = self.lookup(session_id)?;
        let mut log = session
            .log
            .lock()
            .map_err(|_| "failed to lock PTY log writer".to_string())?;
        log.flush().map_err(|error| error.to_string())
    }

    pub fn spawn_pending(&self, request: &PtySpawnRequest) -> Result<PendingPtySession, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: request.rows,
                cols: request.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string())?;

        let mut command = build_command_builder(
            &request.command,
            request.initial_prompt.as_deref(),
            request.mode,
        );
        command.cwd(&request.working_dir);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        // 声明终端背景深浅，供 Claude Code / Codex 等 CLI 选择匹配的配色方案。
        if let Ok(theme) = self.store.app_theme.lock() {
            command.env("COLORFGBG", theme.color_fgbg());
        }
        // 注入 login+interactive 解析出的完整 PATH：GUI 启动的进程继承 launchd 极简
        // PATH，缺少 nvm/fnm 等交互式配置（.zshrc）写入的目录，PTY 子进程用非交互
        // `-lc` 执行用户命令（如 pnpm）会 command not found。解析失败回退继承 PATH。
        if let Some(resolved_path) = self.resolved_interactive_path() {
            command.env("PATH", resolved_path);
        }

        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| error.to_string())?;
        ensure_child_started(
            child.as_mut(),
            &request.command,
            request.startup_check_total_ms,
            request.startup_check_interval_ms,
        )?;

        File::create(&request.log_path).map_err(|error| error.to_string())?;

        let master = pair.master;
        let reader = master
            .try_clone_reader()
            .map_err(|error| error.to_string())?;
        let writer = master.take_writer().map_err(|error| error.to_string())?;
        let killer = child.clone_killer();

        Ok(PendingPtySession {
            child,
            killer,
            master,
            reader,
            writer,
            log_path: request.log_path.clone(),
        })
    }

    pub fn register<F>(
        &self,
        session_id: i64,
        pending: PendingPtySession,
        on_exit: F,
    ) -> Result<(), PtyRegisterError>
    where
        F: FnOnce(PtyExitStatus) + Send + 'static,
    {
        self.register_for_project(0, session_id, pending, on_exit)
    }

    pub fn register_for_project<F>(
        &self,
        project_id: i64,
        session_id: i64,
        pending: PendingPtySession,
        on_exit: F,
    ) -> Result<(), PtyRegisterError>
    where
        F: FnOnce(PtyExitStatus) + Send + 'static,
    {
        let mut sessions = match self.store.sessions.lock() {
            Ok(sessions) => sessions,
            Err(_) => {
                return Err(PtyRegisterError {
                    message: "failed to lock PTY sessions".to_string(),
                    pending,
                });
            }
        };

        let log_writer = match PtyLogWriter::open(Path::new(&pending.log_path)) {
            Ok(log_writer) => log_writer,
            Err(error) => {
                return Err(PtyRegisterError {
                    message: error,
                    pending,
                });
            }
        };

        let handle = Arc::new(PtySessionHandle {
            master: Mutex::new(pending.master),
            writer: Mutex::new(pending.writer),
            killer: Mutex::new(pending.killer),
            restore_buffer: Mutex::new(PtyRestoreBuffer::new()),
            log: Mutex::new(log_writer),
        });

        sessions.insert(session_id, Arc::clone(&handle));
        drop(sessions);

        let reader_store = Arc::clone(&self.store);
        let reader_handle = Arc::clone(&handle);
        let mut reader = pending.reader;
        thread::spawn(move || {
            run_reader_loop(
                reader_store,
                reader_handle,
                project_id,
                session_id,
                &mut reader,
            );
        });

        let store = Arc::clone(&self.store);
        let mut child = pending.child;
        thread::spawn(move || {
            let exit_code = child
                .wait()
                .ok()
                .and_then(|status| i32::try_from(status.exit_code()).ok());
            let had_subscribers = has_output_subscribers(&store, session_id);
            if let Ok(mut sessions) = store.sessions.lock() {
                sessions.remove(&session_id);
            }
            if let Ok(mut subscribers) = store.subscribers.lock() {
                subscribers.remove(&session_id);
            }
            // 退出前若仍有可见订阅，冲刷最后一包；否则丢弃 pending。
            if had_subscribers {
                flush_pending_session(&store, session_id);
            } else {
                discard_pending_session(&store, session_id);
            }
            on_exit(PtyExitStatus { exit_code });
        });

        Ok(())
    }

    pub fn write_input(&self, session_id: i64, data: &str) -> Result<(), String> {
        let session = self.lookup(session_id)?;
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| "failed to lock PTY writer".to_string())?;
        writer
            .write_all(data.as_bytes())
            .map_err(|error| error.to_string())?;
        writer.flush().map_err(|error| error.to_string())
    }

    pub fn resize(&self, session_id: i64, rows: u16, cols: u16) -> Result<(), String> {
        let session = self.lookup(session_id)?;
        let result = session
            .master
            .lock()
            .map_err(|_| "failed to lock PTY master".to_string())?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string());
        result
    }

    pub fn kill(&self, session_id: i64) -> Result<(), String> {
        #[cfg(test)]
        {
            let should_fail = self
                .store
                .kill_failures
                .lock()
                .map_err(|_| "failed to lock PTY kill failures".to_string())?
                .remove(&session_id);
            if should_fail {
                return Err("failed to kill PTY session".to_string());
            }
        }

        let session = self.lookup(session_id)?;
        let result = session
            .killer
            .lock()
            .map_err(|_| "failed to lock PTY killer".to_string())?
            .kill()
            .map_err(|error| error.to_string());
        result
    }

    pub fn contains(&self, session_id: i64) -> bool {
        self.store
            .sessions
            .lock()
            .map(|sessions| sessions.contains_key(&session_id))
            .unwrap_or(false)
    }

    pub fn restore_snapshot(&self, session_id: i64) -> Result<PtyRestoreSnapshot, String> {
        let session = self.lookup(session_id)?;
        let restore_buffer = session
            .restore_buffer
            .lock()
            .map_err(|_| "failed to lock PTY restore buffer".to_string())?;
        Ok(restore_buffer.snapshot(session_id))
    }

    /// 查询 PTY 前台进程组 leader 的当前工作目录。
    ///
    /// 通过 `MasterPty::process_group_leader()` 获取前台进程 PID，再读取其 cwd。
    /// macOS 用 `lsof -a -d cwd -p {pid} -Fn`，Linux 读 `/proc/{pid}/cwd` 符号链接。
    /// 这是 best-effort：拿不到 PID 或读取失败时返回 `Ok(None)`，不阻断渲染。
    pub fn current_cwd(&self, session_id: i64) -> Result<Option<String>, String> {
        let session = self.lookup(session_id)?;
        let master = session
            .master
            .lock()
            .map_err(|_| "failed to lock PTY master".to_string())?;
        let pid = master.process_group_leader();
        drop(master);

        let pid = match pid {
            Some(pid) if pid > 0 => pid,
            _ => return Ok(None),
        };

        Ok(read_cwd_for_pid(pid))
    }

    fn lookup(&self, session_id: i64) -> Result<Arc<PtySessionHandle>, String> {
        self.store
            .sessions
            .lock()
            .map_err(|_| "failed to lock PTY sessions".to_string())?
            .get(&session_id)
            .cloned()
            .ok_or_else(|| "session not found".to_string())
    }

    #[cfg(test)]
    pub(crate) fn poison_sessions_for_test(&self) {
        let store = Arc::clone(&self.store);
        let _ = thread::spawn(move || {
            let _guard = store.sessions.lock().expect("poison PTY session store");
            panic!("poison PTY session store");
        })
        .join();
    }

    #[cfg(test)]
    pub(crate) fn fail_kill_for_session_for_test(&self, session_id: i64) {
        self.store
            .kill_failures
            .lock()
            .expect("lock kill failures")
            .insert(session_id);
    }
}

fn run_reader_loop(
    store: Arc<PtySessionStore>,
    handle: Arc<PtySessionHandle>,
    project_id: i64,
    session_id: i64,
    reader: &mut Box<dyn Read + Send>,
) {
    let mut buffer = [0_u8; 4096];
    let mut sequence = 0_u64;
    // Codex / Claude TUI 启动时的 OSC 10/11/12 颜色查询：在前端挂载前即时应答，
    // 避免 restore 抑制 onData 导致 composer 背景与输出区无法区分。
    let mut osc_color_scanner = crate::agent::pty_osc_color_reply::OscColorQueryScanner::new();

    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => {
                let data = &buffer[..count];
                if let Ok(mut log) = handle.log.lock() {
                    if log.write_all(data).is_err() {
                        break;
                    }
                } else {
                    break;
                }

                let theme = store
                    .app_theme
                    .lock()
                    .map(|theme| *theme)
                    .unwrap_or(TerminalBackgroundTheme::Dark);
                let osc_replies = osc_color_scanner.push(data, theme);
                if !osc_replies.is_empty() {
                    if let Ok(mut writer) = handle.writer.lock() {
                        let _ = writer.write_all(&osc_replies);
                        let _ = writer.flush();
                    }
                }

                sequence = sequence.saturating_add(1);
                if let Ok(mut restore_buffer) = handle.restore_buffer.lock() {
                    restore_buffer.push(sequence, data);
                }

                if has_output_subscribers(&store, session_id) {
                    queue_output_chunk(&store, project_id, session_id, sequence, data);
                }
            }
            Err(_) => break,
        }
    }

    if let Ok(mut log) = handle.log.lock() {
        let _ = log.flush();
        let _ = log.trim_if_needed(true);
    }
    if has_output_subscribers(&store, session_id) {
        flush_pending_session(&store, session_id);
    } else {
        discard_pending_session(&store, session_id);
    }
}

fn spawn_coalesce_thread(store: Arc<PtySessionStore>) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(COALESCE_TICK_MS));
        flush_due_pending(&store);
    });
}

fn has_output_subscribers(store: &PtySessionStore, session_id: i64) -> bool {
    store
        .subscribers
        .lock()
        .ok()
        .map(|subscribers| subscribers.get(&session_id).copied().unwrap_or(0) > 0)
        .unwrap_or(false)
}

fn queue_output_chunk(
    store: &PtySessionStore,
    project_id: i64,
    session_id: i64,
    sequence: u64,
    data: &[u8],
) {
    let should_flush = {
        let Ok(mut pending_emits) = store.pending_emits.lock() else {
            return;
        };
        let entry = pending_emits.entry(session_id).or_insert_with(|| PendingEmit {
            project_id,
            session_id,
            sequence,
            data: Vec::new(),
            first_at: Instant::now(),
        });
        entry.project_id = project_id;
        entry.session_id = session_id;
        entry.sequence = sequence;
        entry.data.extend_from_slice(data);
        entry.data.len() >= EMIT_COALESCE_MAX_BYTES
            || entry.first_at.elapsed() >= Duration::from_millis(EMIT_COALESCE_MAX_MS)
    };

    if should_flush {
        flush_pending_session(store, session_id);
    }
}

fn flush_due_pending(store: &PtySessionStore) {
    let due_sessions = {
        let Ok(pending_emits) = store.pending_emits.lock() else {
            return;
        };
        pending_emits
            .iter()
            .filter(|(_, pending)| {
                pending.first_at.elapsed() >= Duration::from_millis(EMIT_COALESCE_MAX_MS)
                    || pending.data.len() >= EMIT_COALESCE_MAX_BYTES
            })
            .map(|(session_id, _)| *session_id)
            .collect::<Vec<_>>()
    };

    for session_id in due_sessions {
        flush_pending_session(store, session_id);
    }
}

fn flush_pending_session(store: &PtySessionStore, session_id: i64) {
    let pending = {
        let Ok(mut pending_emits) = store.pending_emits.lock() else {
            return;
        };
        pending_emits.remove(&session_id)
    };
    let Some(pending) = pending else {
        return;
    };
    if pending.data.is_empty() {
        return;
    }
    if let Some(output_sink) = store
        .output_sink
        .lock()
        .ok()
        .and_then(|sink| sink.clone())
    {
        output_sink(PtyOutputEvent {
            project_id: pending.project_id,
            session_id: pending.session_id,
            sequence: pending.sequence,
            data: pending.data,
        });
    }
}

fn discard_pending_session(store: &PtySessionStore, session_id: i64) {
    if let Ok(mut pending_emits) = store.pending_emits.lock() {
        pending_emits.remove(&session_id);
    }
}

impl PtyLogWriter {
    fn open(path: &Path) -> Result<Self, String> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|error| error.to_string())?;
        Ok(Self {
            path: path.to_path_buf(),
            file: Some(BufWriter::with_capacity(LOG_FLUSH_EVERY_BYTES, file)),
            unflushed_bytes: 0,
            bytes_since_trim_check: 0,
        })
    }

    fn write_all(&mut self, data: &[u8]) -> Result<(), String> {
        let Some(file) = self.file.as_mut() else {
            return Err("log writer closed".to_string());
        };
        file.write_all(data).map_err(|error| error.to_string())?;
        self.unflushed_bytes = self.unflushed_bytes.saturating_add(data.len());
        self.bytes_since_trim_check = self.bytes_since_trim_check.saturating_add(data.len());

        if self.unflushed_bytes >= LOG_FLUSH_EVERY_BYTES {
            self.flush()?;
        }
        self.trim_if_needed(false)?;
        Ok(())
    }

    fn flush(&mut self) -> Result<(), String> {
        if let Some(file) = self.file.as_mut() {
            file.flush().map_err(|error| error.to_string())?;
        }
        self.unflushed_bytes = 0;
        Ok(())
    }

    fn trim_if_needed(&mut self, force: bool) -> Result<(), String> {
        if !force && self.bytes_since_trim_check < LOG_TRIM_CHECK_EVERY_BYTES {
            return Ok(());
        }
        self.flush()?;
        // 关闭句柄后再裁剪，避免与追加写竞争。
        self.file = None;
        trim_log_file(&self.path, LOG_MAX_BYTES)?;
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|error| error.to_string())?;
        self.file = Some(BufWriter::with_capacity(LOG_FLUSH_EVERY_BYTES, file));
        self.bytes_since_trim_check = 0;
        Ok(())
    }
}

pub(crate) fn trim_log_file(path: &Path, max_bytes: usize) -> Result<(), String> {
    if max_bytes == 0 || !path.exists() {
        return Ok(());
    }

    let content = std::fs::read(path).map_err(|error| error.to_string())?;
    if content.len() <= max_bytes {
        return Ok(());
    }

    let start = content.len().saturating_sub(max_bytes);
    let mut cut = start;
    if let Some(relative) = content[start..].iter().position(|byte| *byte == b'\n') {
        cut = start.saturating_add(relative).saturating_add(1);
        if cut >= content.len() {
            cut = start;
        }
    }

    std::fs::write(path, &content[cut..]).map_err(|error| error.to_string())
}

impl PtyRestoreBuffer {
    fn new() -> Self {
        Self {
            chunks: Vec::new(),
            total_bytes: 0,
            latest_sequence: 0,
            is_complete: true,
        }
    }

    fn push(&mut self, sequence: u64, data: &[u8]) {
        self.latest_sequence = sequence;
        if data.is_empty() {
            return;
        }

        // 单 chunk 超过上限时只保留尾部，并标记起点历史已丢失。
        if data.len() > RESTORE_BUFFER_MAX_BYTES {
            let start = data.len() - RESTORE_BUFFER_MAX_BYTES;
            self.chunks.clear();
            self.chunks.push(data[start..].to_vec());
            self.total_bytes = RESTORE_BUFFER_MAX_BYTES;
            self.is_complete = false;
            return;
        }

        self.chunks.push(data.to_vec());
        self.total_bytes = self.total_bytes.saturating_add(data.len());

        // 环形裁剪：丢掉最旧 chunk，始终保留最近 RESTORE_BUFFER_MAX_BYTES。
        while self.total_bytes > RESTORE_BUFFER_MAX_BYTES && !self.chunks.is_empty() {
            let removed = self.chunks.remove(0);
            self.total_bytes = self.total_bytes.saturating_sub(removed.len());
            self.is_complete = false;
        }
    }

    fn snapshot(&self, session_id: i64) -> PtyRestoreSnapshot {
        PtyRestoreSnapshot {
            session_id,
            sequence: self.latest_sequence,
            chunks: self.chunks.clone(),
            is_complete: self.is_complete,
        }
    }
}

impl PendingPtySession {
    pub fn write_input(&mut self, data: &str) -> Result<(), String> {
        self.writer
            .write_all(data.as_bytes())
            .map_err(|error| error.to_string())?;
        self.writer.flush().map_err(|error| error.to_string())
    }

    pub fn terminate(mut self) {
        let _ = self.killer.kill();
        let _ = self.child.wait();
    }
}

pub fn read_terminal_snapshot(path: &Path, max_bytes: usize) -> Result<String, String> {
    if !path.exists() {
        return Ok(String::new());
    }

    let content = std::fs::read(path).map_err(|error| error.to_string())?;
    if content.len() <= max_bytes {
        return Ok(String::from_utf8_lossy(&content).to_string());
    }

    let start = content.len().saturating_sub(max_bytes);
    Ok(String::from_utf8_lossy(&content[start..]).to_string())
}

/// 读取指定 PID 的当前工作目录。best-effort：失败返回 `None`。
fn read_cwd_for_pid(pid: i32) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        return std::fs::read_link(format!("/proc/{pid}/cwd"))
            .ok()
            .and_then(|path| path.to_str().map(|s| s.to_string()));
    }

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("lsof")
            .args(["-a", "-d", "cwd", "-p", &pid.to_string(), "-Fn"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        // lsof -Fn 输出每行以单个字符前缀开头，cwd 路径行前缀为 'n'。
        for line in stdout.lines() {
            if let Some(path) = line.strip_prefix('n') {
                if !path.is_empty() {
                    return Some(path.to_string());
                }
            }
        }
        None
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = pid;
        None
    }
}

fn ensure_child_started(
    child: &mut dyn Child,
    command: &str,
    total_ms: u64,
    interval_ms: u64,
) -> Result<(), String> {
    let iterations = total_ms / interval_ms;

    for _ in 0..iterations {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Err(format!(
                "Agent 进程启动失败: {command} exited early with code {}",
                status.exit_code()
            ));
        }

        thread::sleep(Duration::from_millis(interval_ms));
    }

    Ok(())
}

pub(crate) fn build_shell_command_line(command: &str, prompt: Option<&str>) -> String {
    let mut command_line = format!("exec {command}");
    if let Some(prompt) = prompt {
        command_line.push(' ');
        command_line.push_str(&shell_quote(prompt));
    }
    format!("{command_line} || exit $?")
}

/// 构造「执行 command 后落到交互式 login shell」的 `-lc` 命令串。
/// command 为空或就是 shell 本身时，直接进入纯交互式 login shell。
/// 用 `-lc`（而非 `-lic`）执行 command：zsh 的 `-i -c` 组合在有 `.zshrc`（如
/// powerlevel10k）时不会可靠执行 `-c` 命令，因此先以非交互 login shell 跑完 command，
/// 再 `exec $SHELL -li` 进入交互式 login shell，命令退出后保留 shell。
///
/// 非交互 `-lc` 包装 shell 不开启作业控制，与前台 command 共处同一前台进程组；
/// 用户 Ctrl+C 中断 command 时，SIGINT 会同时发给包装 shell 把它一起杀死，导致永远
/// 到不了 `exec $SHELL -li`，PTY 退出、session 失活。因此运行 command 前给包装 shell
/// 装一个 no-op INT trap 让它存活（被捕获的信号在派生外部命令子进程时会被复位为默认
/// 动作，故 command 仍会正常收到 SIGINT 被中断），exec 前再复位。
fn build_shell_keepalive_command_line(command: &str, shell: &str) -> String {
    let trimmed = command.trim();
    if trimmed.is_empty() || trimmed == shell {
        format!("exec {shell} -li")
    } else {
        format!("trap ':' INT; {trimmed}; trap - INT; exec {shell} -li")
    }
}

fn build_command_builder(
    command: &str,
    prompt: Option<&str>,
    mode: PtyCommandMode,
) -> CommandBuilder {
    #[cfg(unix)]
    {
        let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        match mode {
            PtyCommandMode::ExecReplace => {
                let mut builder = CommandBuilder::new(shell);
                builder.arg("-lc");
                builder.arg(build_shell_command_line(command, prompt));
                builder
            }
            PtyCommandMode::InteractiveRun => {
                let keepalive = build_shell_keepalive_command_line(command, &shell);
                let mut builder = CommandBuilder::new(shell);
                builder.arg("-lc");
                builder.arg(keepalive);
                builder
            }
        }
    }

    #[cfg(not(unix))]
    {
        let _ = mode;
        let mut builder = CommandBuilder::new(command);
        if let Some(prompt) = prompt {
            builder.arg(prompt);
        }
        builder
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[cfg(test)]
mod tests {
    use super::{
        build_shell_keepalive_command_line, build_shell_command_line, trim_log_file,
        TerminalBackgroundTheme,
    };
    use std::io::Write;

    #[test]
    fn terminal_background_theme_color_fgbg_matches_palette() {
        assert_eq!(TerminalBackgroundTheme::Dark.color_fgbg(), "15;0");
        assert_eq!(TerminalBackgroundTheme::Light.color_fgbg(), "0;15");
    }

    #[test]
    fn restore_buffer_starts_complete_and_empty() {
        let buffer = super::PtyRestoreBuffer::new();
        let snapshot = buffer.snapshot(1);
        assert!(snapshot.is_complete);
        assert_eq!(snapshot.sequence, 0);
        assert!(snapshot.chunks.is_empty());
    }

    #[test]
    fn restore_buffer_marks_incomplete_but_keeps_recent_tail() {
        let mut buffer = super::PtyRestoreBuffer::new();
        // 超过 1MiB 后应裁掉前缀，并继续接受新数据。
        let chunk = vec![b'a'; 600_000];
        buffer.push(1, &chunk);
        buffer.push(2, &chunk);
        buffer.push(3, b"tail");
        assert!(!buffer.is_complete);
        assert_eq!(buffer.latest_sequence, 3);
        assert!(buffer.total_bytes <= super::RESTORE_BUFFER_MAX_BYTES);
        assert!(buffer.total_bytes > 0);
        let snapshot = buffer.snapshot(9);
        assert!(!snapshot.is_complete);
        assert_eq!(snapshot.sequence, 3);
        assert!(!snapshot.chunks.is_empty());
        let joined: Vec<u8> = snapshot.chunks.iter().flatten().copied().collect();
        assert!(joined.ends_with(b"tail"));
    }

    #[test]
    fn build_shell_command_line_preserves_command_arguments() {
        assert_eq!(
            build_shell_command_line("claude --permission-mode bypassPermissions", None),
            "exec claude --permission-mode bypassPermissions || exit $?"
        );
    }

    #[test]
    fn build_shell_command_line_quotes_prompt_argument() {
        assert_eq!(
            build_shell_command_line(
                "codex --dangerously-bypass-approvals-and-sandbox",
                Some("fix 'bug'")
            ),
            "exec codex --dangerously-bypass-approvals-and-sandbox 'fix '\"'\"'bug'\"'\"'' || exit $?"
        );
    }

    #[test]
    fn build_shell_keepalive_command_line_runs_command_then_interactive_shell() {
        assert_eq!(
            build_shell_keepalive_command_line("grok", "/bin/zsh"),
            "trap ':' INT; grok; trap - INT; exec /bin/zsh -li"
        );
        assert_eq!(
            build_shell_keepalive_command_line("grok --model x", "/bin/zsh"),
            "trap ':' INT; grok --model x; trap - INT; exec /bin/zsh -li"
        );
    }

    #[test]
    fn build_shell_keepalive_command_line_plain_shell_for_empty_or_shell() {
        assert_eq!(
            build_shell_keepalive_command_line("", "/bin/zsh"),
            "exec /bin/zsh -li"
        );
        assert_eq!(
            build_shell_keepalive_command_line("   ", "/bin/zsh"),
            "exec /bin/zsh -li"
        );
        assert_eq!(
            build_shell_keepalive_command_line("/bin/zsh", "/bin/zsh"),
            "exec /bin/zsh -li"
        );
    }

    #[test]
    fn trim_log_file_keeps_tail_within_max_bytes() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().join("terminal.log");
        let mut file = std::fs::File::create(&path).expect("create log");
        write!(file, "aaaa\nbbbb\ncccc\ndddd\n").expect("write log");
        drop(file);

        trim_log_file(&path, 10).expect("trim log");
        let content = std::fs::read_to_string(&path).expect("read trimmed");
        assert!(content.len() <= 10);
        assert!(content.contains("dddd") || content.ends_with("dddd\n") || content.contains("ccc"));
    }
}
