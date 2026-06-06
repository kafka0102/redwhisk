use std::collections::HashMap;
use std::env;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};

#[derive(Clone)]
pub struct PtySessionManager {
    store: Arc<PtySessionStore>,
}

struct PtySessionStore {
    sessions: Mutex<HashMap<i64, Arc<PtySessionHandle>>>,
}

struct PtySessionHandle {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

pub struct PtySpawnRequest {
    pub command: String,
    pub working_dir: String,
    pub log_path: String,
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

impl PtySessionManager {
    pub fn new() -> Self {
        Self {
            store: Arc::new(PtySessionStore {
                sessions: Mutex::new(HashMap::new()),
            }),
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

        let mut command = build_command_builder(&request.command);
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

    pub fn register(&self, session_id: i64, pending: PendingPtySession) {
        let handle = Arc::new(PtySessionHandle {
            master: Mutex::new(pending.master),
            writer: Mutex::new(pending.writer),
            killer: Mutex::new(pending.killer),
        });

        if let Ok(mut sessions) = self.store.sessions.lock() {
            sessions.insert(session_id, Arc::clone(&handle));
        }

        let store = Arc::clone(&self.store);
        let log_path = pending.log_path.clone();
        let mut reader = pending.reader;
        thread::spawn(move || {
            let file = OpenOptions::new().create(true).append(true).open(log_path);
            let mut file = match file {
                Ok(file) => file,
                Err(_) => return,
            };
            let mut buffer = [0_u8; 4096];

            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        let _ = file.write_all(&buffer[..count]);
                        let _ = file.flush();
                    }
                    Err(_) => break,
                }
            }
        });

        let store = Arc::clone(&store);
        let mut child = pending.child;
        thread::spawn(move || {
            let _ = child.wait();
            if let Ok(mut sessions) = store.sessions.lock() {
                sessions.remove(&session_id);
            }
        });
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

    fn lookup(&self, session_id: i64) -> Result<Arc<PtySessionHandle>, String> {
        self.store
            .sessions
            .lock()
            .map_err(|_| "failed to lock PTY sessions".to_string())?
            .get(&session_id)
            .cloned()
            .ok_or_else(|| "session not found".to_string())
    }
}

impl PendingPtySession {
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

fn build_command_builder(command: &str) -> CommandBuilder {
    #[cfg(unix)]
    {
        let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut builder = CommandBuilder::new(shell);
        builder.arg("-lc");
        builder.arg(format!("exec {}", shell_quote(command)));
        builder
    }

    #[cfg(not(unix))]
    {
        CommandBuilder::new(command)
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}
