use std::collections::HashMap;
use std::env;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;

const RESTORE_BUFFER_MAX_BYTES: usize = 1_048_576;

#[derive(Clone)]
pub struct PtySessionManager {
    store: Arc<PtySessionStore>,
}

struct PtySessionStore {
    sessions: Mutex<HashMap<i64, Arc<PtySessionHandle>>>,
    output_sink: Mutex<Option<Arc<dyn Fn(PtyOutputEvent) + Send + Sync>>>,
}

struct PtySessionHandle {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    restore_buffer: Mutex<PtyRestoreBuffer>,
}

pub struct PtySpawnRequest {
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
        Self {
            store: Arc::new(PtySessionStore {
                sessions: Mutex::new(HashMap::new()),
                output_sink: Mutex::new(None),
            }),
        }
    }

    pub fn set_output_sink<F>(&self, sink: F)
    where
        F: Fn(PtyOutputEvent) + Send + Sync + 'static,
    {
        if let Ok(mut output_sink) = self.store.output_sink.lock() {
            *output_sink = Some(Arc::new(sink));
        }
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

        let mut command =
            build_command_builder(&request.command, request.initial_prompt.as_deref());
        command.cwd(&request.working_dir);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");

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

        let handle = Arc::new(PtySessionHandle {
            master: Mutex::new(pending.master),
            writer: Mutex::new(pending.writer),
            killer: Mutex::new(pending.killer),
            restore_buffer: Mutex::new(PtyRestoreBuffer::new()),
        });

        sessions.insert(session_id, Arc::clone(&handle));
        drop(sessions);

        let reader_store = Arc::clone(&self.store);
        let reader_handle = Arc::clone(&handle);
        let log_path = pending.log_path.clone();
        let mut reader = pending.reader;
        thread::spawn(move || {
            let file = OpenOptions::new().create(true).append(true).open(log_path);
            let mut file = match file {
                Ok(file) => file,
                Err(_) => return,
            };
            let mut buffer = [0_u8; 4096];
            let mut sequence = 0_u64;

            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        let data = &buffer[..count];
                        let _ = file.write_all(data);
                        let _ = file.flush();
                        sequence = sequence.saturating_add(1);
                        if let Ok(mut restore_buffer) = reader_handle.restore_buffer.lock() {
                            restore_buffer.push(sequence, data);
                        }
                        if let Some(output_sink) = reader_store
                            .output_sink
                            .lock()
                            .ok()
                            .and_then(|sink| sink.clone())
                        {
                            output_sink(PtyOutputEvent {
                                project_id,
                                session_id,
                                sequence,
                                data: data.to_vec(),
                            });
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let store = Arc::clone(&self.store);
        let mut child = pending.child;
        thread::spawn(move || {
            let exit_code = child
                .wait()
                .ok()
                .and_then(|status| i32::try_from(status.exit_code()).ok());
            if let Ok(mut sessions) = store.sessions.lock() {
                sessions.remove(&session_id);
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
        if !self.is_complete {
            return;
        }

        if self.total_bytes.saturating_add(data.len()) > RESTORE_BUFFER_MAX_BYTES {
            self.chunks.clear();
            self.total_bytes = 0;
            self.is_complete = false;
            return;
        }

        self.total_bytes += data.len();
        self.chunks.push(data.to_vec());
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
    let mut command_line = format!("exec {}", shell_quote(command));
    if let Some(prompt) = prompt {
        command_line.push(' ');
        command_line.push_str(&shell_quote(prompt));
    }
    format!("{command_line} || exit $?")
}

fn build_command_builder(command: &str, prompt: Option<&str>) -> CommandBuilder {
    #[cfg(unix)]
    {
        let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut builder = CommandBuilder::new(shell);
        builder.arg("-lc");
        builder.arg(build_shell_command_line(command, prompt));
        builder
    }

    #[cfg(not(unix))]
    {
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
