use std::io::{BufReader, Read};
use std::process::ChildStdin;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

use super::protocol::parse_publish_diagnostics;
use super::rpc::{read_rpc, write_rpc};
use crate::types::code_language::{CodeLanguageDiagnostic, CodeLanguageUnavailableReason};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(8);

pub type DiagnosticsListener = Arc<dyn Fn(String, Vec<CodeLanguageDiagnostic>) + Send + Sync>;

pub fn handshake_and_listen(
    stdin: Arc<Mutex<ChildStdin>>,
    stdout: impl Read + Send + 'static,
    initialize: Value,
    on_diagnostics: DiagnosticsListener,
) -> Result<(), CodeLanguageUnavailableReason> {
    let (sender, receiver) = mpsc::channel();
    let reader_stdin = Arc::clone(&stdin);
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let handshake = read_initialize_result(&mut reader);
        let ok = handshake.is_ok();
        let _ = sender.send(handshake);
        if ok {
            dispatch_loop(&mut reader, reader_stdin, on_diagnostics);
        }
    });

    write_locked(&stdin, &initialize)?;

    match receiver.recv_timeout(HANDSHAKE_TIMEOUT) {
        Ok(Ok(_)) => {}
        _ => return Err(CodeLanguageUnavailableReason::SpawnFailed),
    }

    write_locked(
        &stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "initialized",
            "params": {}
        }),
    )?;

    Ok(())
}

fn dispatch_loop(
    reader: &mut BufReader<impl Read>,
    stdin: Arc<Mutex<ChildStdin>>,
    on_diagnostics: DiagnosticsListener,
) {
    loop {
        let message = match read_rpc(reader) {
            Ok(message) => message,
            Err(_) => break,
        };
        if let Some((uri, diagnostics)) = parse_publish_diagnostics(&message) {
            on_diagnostics(uri, diagnostics);
            continue;
        }
        if let (Some(id), Some(_)) = (message.get("id"), message.get("method")) {
            let _ = write_locked(
                &stdin,
                &json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": null
                }),
            );
        }
    }
}

fn read_initialize_result(reader: &mut BufReader<impl Read>) -> Result<Value, ()> {
    loop {
        let message = read_rpc(reader).map_err(|_| ())?;
        if message.get("id") == Some(&json!(1)) {
            if message.get("error").is_some() {
                return Err(());
            }
            if message.get("result").is_some() {
                return Ok(message);
            }
        }
    }
}

fn write_locked(
    stdin: &Mutex<ChildStdin>,
    value: &Value,
) -> Result<(), CodeLanguageUnavailableReason> {
    let mut stdin = stdin
        .lock()
        .map_err(|_| CodeLanguageUnavailableReason::SpawnFailed)?;
    write_rpc(&mut *stdin, value).map_err(|_| CodeLanguageUnavailableReason::SpawnFailed)
}
