use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::json;

use super::host::LanguageHost;
use super::protocol::parse_definition_result;
use super::rpc::path_from_file_uri;
use crate::types::code_language::{CodeLanguageLocation, CodeLanguagePosition, CodeLanguageRange};

const DEFINITION_TIMEOUT: Duration = Duration::from_secs(8);

pub fn request_definition(
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
        }
    });
    let response = match host.request("textDocument/definition", params, DEFINITION_TIMEOUT) {
        Ok(response) => response,
        Err(_) => return Vec::new(),
    };
    if response.get("error").is_some() {
        return Vec::new();
    }
    let Some(result) = response.get("result") else {
        return Vec::new();
    };
    filter_definition_locations(workspace_path, &parse_definition_result(result))
}

pub fn filter_definition_locations(
    workspace_path: &Path,
    locations: &[(String, CodeLanguageRange)],
) -> Vec<CodeLanguageLocation> {
    locations
        .iter()
        .filter_map(|(uri, range)| {
            let path = path_from_file_uri(uri)?;
            let file_path = relative_workspace_path(workspace_path, &path)?;
            if file_path.is_empty() {
                return None;
            }
            Some(CodeLanguageLocation {
                file_path,
                range: range.clone(),
            })
        })
        .collect()
}

fn relative_workspace_path(workspace_path: &Path, path: &Path) -> Option<String> {
    let workspace = canonicalize_or_owned(workspace_path);
    let candidate = canonicalize_or_owned(path);
    let relative = candidate.strip_prefix(&workspace).ok()?;
    Some(relative.to_string_lossy().replace('\\', "/"))
}

fn canonicalize_or_owned(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
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

    fn range(line: u32, character: u32) -> CodeLanguageRange {
        CodeLanguageRange {
            start: CodeLanguagePosition { line, character },
            end: CodeLanguagePosition {
                line,
                character: character + 3,
            },
        }
    }

    fn fake_definition_script(in_root: &str, out_root: &str) -> String {
        format!(
            r#"
import json
import sys

IN_ROOT = {in_root}
OUT_ROOT = {out_root}

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
    elif method == "textDocument/definition":
        write_msg({{
            "jsonrpc": "2.0",
            "id": message["id"],
            "result": [
                {{
                    "uri": IN_ROOT,
                    "range": {{
                        "start": {{"line": 1, "character": 0}},
                        "end": {{"line": 1, "character": 3}}
                    }}
                }},
                {{
                    "uri": OUT_ROOT,
                    "range": {{
                        "start": {{"line": 0, "character": 0}},
                        "end": {{"line": 0, "character": 1}}
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
    fn keeps_in_root_locations_including_node_modules() {
        let temp_dir = tempdir().expect("temp dir");
        let workspace = temp_dir.path().join("repo");
        let lib = workspace.join("src/lib.ts");
        let dts = workspace.join("node_modules/foo/index.d.ts");
        write_file(&lib, "export const foo = 1;\n");
        write_file(&dts, "export const foo: number;\n");

        let locations = filter_definition_locations(
            &workspace,
            &[
                (file_uri(&lib), range(0, 0)),
                (file_uri(&dts), range(0, 13)),
                (
                    "file:///tmp/redwhisk-outside-not-in-workspace/lib.ts".to_string(),
                    range(0, 0),
                ),
            ],
        );

        assert_eq!(
            locations
                .iter()
                .map(|location| location.file_path.as_str())
                .collect::<Vec<_>>(),
            vec!["src/lib.ts", "node_modules/foo/index.d.ts"]
        );
    }

    #[test]
    fn fake_stdio_definition_keeps_in_root_and_drops_outside() {
        let temp_dir = tempdir().expect("temp dir");
        let workspace = temp_dir.path().join("repo");
        let lib = workspace.join("src/lib.ts");
        write_file(&lib, "export const foo = 1;\n");
        let in_root = file_uri(&lib);
        let out_root = "file:///tmp/redwhisk-outside-not-in-workspace/lib.ts";
        let runtime = runtime_with_script(&workspace, &fake_definition_script(&in_root, out_root));
        let host = LanguageHost::spawn(&runtime).expect("spawn fake host");

        let locations = request_definition(
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
            vec!["src/lib.ts"]
        );
        assert_eq!(locations[0].range.start.line, 1);
        host.stop();
    }
}
