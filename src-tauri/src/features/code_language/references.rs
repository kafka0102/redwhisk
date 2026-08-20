use std::path::Path;
use std::time::Duration;

use serde_json::json;

use super::host::LanguageHost;
use super::locations::filter_workspace_locations;
use super::protocol::parse_definition_result;
use crate::types::code_language::{CodeLanguageLocation, CodeLanguagePosition};

const REFERENCES_TIMEOUT: Duration = Duration::from_secs(8);

pub fn request_references(
    host: &LanguageHost,
    workspace_path: &Path,
    uri: &str,
    position: &CodeLanguagePosition,
) -> Vec<CodeLanguageLocation> {
    let params = json!({
        "textDocument": { "uri": uri },
        "position": {
            "line": position.line,
            "character": position.character
        },
        "context": { "includeDeclaration": true }
    });
    let response = match host.request("textDocument/references", params, REFERENCES_TIMEOUT) {
        Ok(response) => response,
        Err(_) => return Vec::new(),
    };
    if response.get("error").is_some() {
        return Vec::new();
    }
    let Some(result) = response.get("result") else {
        return Vec::new();
    };
    filter_workspace_locations(workspace_path, &parse_definition_result(result))
}

#[cfg(test)]
mod tests {
    use super::super::resolver::LanguageRuntime;
    use super::super::rpc::file_uri;
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, contents).expect("write file");
    }

    fn fake_references_script(in_root: &str, out_root: &str, in_root_link: &str) -> String {
        format!(
            r#"
import json
import sys

IN_ROOT = {in_root}
OUT_ROOT = {out_root}
IN_ROOT_LINK = {in_root_link}

def read_msg():
    headers = {{}}
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        if line in (b"\r\n", b"\n"):
            break
        key, value = line.decode("utf-8").split(":", 1)
        headers[key.strip().lower()] = value.strip()
    length = int(headers.get("content-length", "0"))
    body = sys.stdin.buffer.read(length)
    return json.loads(body)

def write_msg(payload):
    raw = json.dumps(payload).encode("utf-8")
    sys.stdout.buffer.write(f"Content-Length: {{len(raw)}}\r\n\r\n".encode("ascii") + raw)
    sys.stdout.buffer.flush()

while True:
    message = read_msg()
    if message is None:
        break
    method = message.get("method")
    if method == "initialize":
        write_msg({{"jsonrpc": "2.0", "id": message["id"], "result": {{"capabilities": {{}}}}}})
    elif method == "textDocument/references":
        params = message.get("params") or {{}}
        context = params.get("context") or {{}}
        if context.get("includeDeclaration") is not True:
            write_msg({{"jsonrpc": "2.0", "id": message["id"], "result": []}})
            continue
        write_msg({{
            "jsonrpc": "2.0",
            "id": message["id"],
            "result": [
                {{
                    "uri": IN_ROOT,
                    "range": {{
                        "start": {{"line": 2, "character": 4}},
                        "end": {{"line": 2, "character": 7}}
                    }}
                }},
                {{
                    "uri": OUT_ROOT,
                    "range": {{
                        "start": {{"line": 0, "character": 0}},
                        "end": {{"line": 0, "character": 1}}
                    }}
                }},
                {{
                    "targetUri": IN_ROOT_LINK,
                    "targetRange": {{
                        "start": {{"line": 0, "character": 0}},
                        "end": {{"line": 8, "character": 1}}
                    }},
                    "targetSelectionRange": {{
                        "start": {{"line": 0, "character": 13}},
                        "end": {{"line": 0, "character": 16}}
                    }}
                }}
            ]
        }})
    elif method == "shutdown":
        write_msg({{"jsonrpc": "2.0", "id": message["id"], "result": None}})
    elif method == "exit":
        break
"#,
            in_root = json!(in_root),
            out_root = json!(out_root),
            in_root_link = json!(in_root_link),
        )
    }

    fn runtime_with_script(workspace: &Path, script: &str) -> LanguageRuntime {
        let script_path = workspace.join("fake_lsp.py");
        write_file(&script_path, script);
        write_file(&workspace.join("tsserver.js"), "fake-tsserver");
        LanguageRuntime {
            program: "python3".to_string(),
            args: vec![script_path.to_string_lossy().into_owned()],
            cwd: workspace.to_path_buf(),
            tsserver_path: workspace.join("tsserver.js"),
        }
    }

    #[test]
    fn fake_stdio_references_keeps_in_root_and_drops_outside() {
        let temp_dir = tempdir().expect("temp dir");
        let workspace = temp_dir.path().join("repo");
        let usage = workspace.join("src/usage.ts");
        let dts = workspace.join("node_modules/foo/index.d.ts");
        write_file(&usage, "foo();\n");
        write_file(&dts, "export const foo: number;\n");
        let in_root = file_uri(&usage);
        let in_root_link = file_uri(&dts);
        let out_root = "file:///tmp/redwhisk-outside-not-in-workspace/lib.ts";
        let runtime = runtime_with_script(
            &workspace,
            &fake_references_script(&in_root, out_root, &in_root_link),
        );
        let host = LanguageHost::spawn(&runtime).expect("spawn fake host");

        let locations = request_references(
            &host,
            &workspace,
            &file_uri(&workspace.join("src/file.ts")),
            &CodeLanguagePosition {
                line: 0,
                character: 6,
            },
        );

        assert_eq!(
            locations
                .iter()
                .map(|location| location.file_path.as_str())
                .collect::<Vec<_>>(),
            vec!["src/usage.ts", "node_modules/foo/index.d.ts"]
        );
        assert_eq!(locations[0].range.start.line, 2);
        assert_eq!(locations[1].range.start.character, 13);
        host.stop();
    }
}
