//! fake 语言服务脚本：按 didOpen → 加载 begin → 加载 end 的时序给出不同答案。

use std::time::Duration;

const CREATE_PROGRESS_REQUEST_ID: i64 = 900;

/// fake 语言服务的行为参数。
pub(super) struct ScriptedLsp {
    /// 项目加载完成前的答案（本文件 import 子句）。
    pub(super) stale_uri: String,
    /// 项目加载完成后的答案（跨文件定义）。
    pub(super) ready_uri: String,
    /// 若请求在加载 begin 之前到达，改答该位置（用于断言请求没有过早发出）。
    pub(super) early_uri: Option<String>,
    /// didOpen 之后多久发出加载 begin。
    pub(super) begin_after: Duration,
    /// didOpen 之后多久发出加载 end；`None` 表示永不结束。
    pub(super) finish_after: Option<Duration>,
    /// didOpen 之后多久直接退出（模拟语言服务崩溃）；`None` 表示不退出。
    pub(super) exit_after: Option<Duration>,
}

pub(super) fn scripted_lsp_script(lsp: &ScriptedLsp) -> String {
    let config = serde_json::Value::String(
        serde_json::json!({
        "staleUri": lsp.stale_uri,
        "readyUri": lsp.ready_uri,
        "earlyUri": lsp.early_uri,
        "beginAfterMs": lsp.begin_after.as_millis() as u64,
        "finishAfterMs": lsp.finish_after.map(|value| value.as_millis() as u64),
        "exitAfterMs": lsp.exit_after.map(|value| value.as_millis() as u64),
        })
        .to_string(),
    );
    format!(
        r#"
import json
import os
import select
import sys
import time

CONFIG = json.loads({config})
CREATE_REQUEST_ID = {create_id}

buffer = b""
state = {{
    "progressSupported": False,
    "createAcknowledged": False,
    "loadingSince": None,
    "beginSent": False,
    "finished": True,
}}

def write_msg(payload):
    raw = json.dumps(payload).encode("utf-8")
    os.write(1, b"Content-Length: " + str(len(raw)).encode("ascii") + b"\r\n\r\n" + raw)

def take_messages():
    global buffer
    ready, _, _ = select.select([0], [], [], 0.02)
    if ready:
        chunk = os.read(0, 65536)
        if not chunk:
            sys.exit(0)
        buffer += chunk
    messages = []
    while True:
        separator = buffer.find(b"\r\n\r\n")
        if separator < 0:
            break
        length = 0
        for line in buffer[:separator].decode("utf-8").split("\r\n"):
            if line.lower().startswith("content-length:"):
                length = int(line.split(":", 1)[1].strip())
        start = separator + 4
        if len(buffer) < start + length:
            break
        messages.append(json.loads(buffer[start:start + length]))
        buffer = buffer[start + length:]
    return messages

def location(uri):
    return [{{
        "uri": uri,
        "range": {{
            "start": {{"line": 0, "character": 0}},
            "end": {{"line": 0, "character": 1}}
        }}
    }}]

def handle(message):
    method = message.get("method")
    if method == "initialize":
        capabilities = (message.get("params") or {{}}).get("capabilities") or {{}}
        window = capabilities.get("window") or {{}}
        state["progressSupported"] = window.get("workDoneProgress") is True
        write_msg({{"jsonrpc": "2.0", "id": message["id"], "result": {{"capabilities": {{}}}}}})
        return
    if method == "initialized":
        return
    if method == "textDocument/didOpen":
        state["loadingSince"] = time.time()
        state["beginSent"] = False
        state["finished"] = False
        state["createAcknowledged"] = False
        if state["progressSupported"]:
            write_msg({{
                "jsonrpc": "2.0",
                "id": CREATE_REQUEST_ID,
                "method": "window/workDoneProgress/create",
                "params": {{"token": "load-token"}}
            }})
        return
    if method in ("textDocument/definition", "textDocument/references"):
        if state["finished"]:
            uri = CONFIG["readyUri"]
        elif CONFIG["earlyUri"] is not None and not state["beginSent"]:
            uri = CONFIG["earlyUri"]
        else:
            uri = CONFIG["staleUri"]
        write_msg({{"jsonrpc": "2.0", "id": message["id"], "result": location(uri)}})
        return
    if method == "shutdown":
        write_msg({{"jsonrpc": "2.0", "id": message["id"], "result": None}})
        return
    if method == "exit":
        sys.exit(0)
    if message.get("id") == CREATE_REQUEST_ID:
        state["createAcknowledged"] = True
        return

while True:
    now = time.time()
    if (
        CONFIG["exitAfterMs"] is not None
        and state["loadingSince"] is not None
        and (now - state["loadingSince"]) * 1000 >= CONFIG["exitAfterMs"]
    ):
        sys.exit(0)
    if (
        state["loadingSince"] is not None
        and not state["finished"]
        and state["createAcknowledged"]
    ):
        elapsed_ms = (now - state["loadingSince"]) * 1000
        if not state["beginSent"] and elapsed_ms >= CONFIG["beginAfterMs"]:
            state["beginSent"] = True
            write_msg({{
                "jsonrpc": "2.0",
                "method": "$/progress",
                "params": {{
                    "token": "load-token",
                    "value": {{
                        "kind": "begin",
                        "title": "Initializing JS/TS language features…"
                    }}
                }}
            }})
        elif (
            state["beginSent"]
            and CONFIG["finishAfterMs"] is not None
            and elapsed_ms >= CONFIG["finishAfterMs"]
        ):
            state["finished"] = True
            write_msg({{
                "jsonrpc": "2.0",
                "method": "$/progress",
                "params": {{
                    "token": "load-token",
                    "value": {{"kind": "end"}}
                }}
            }})
    for message in take_messages():
        handle(message)
"#,
        config = config,
        create_id = CREATE_PROGRESS_REQUEST_ID,
    )
}
