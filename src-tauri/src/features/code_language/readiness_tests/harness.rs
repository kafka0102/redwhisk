//! 就绪时序测试的装配：工作区、bundled 运行时与 fake 宿主。

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;

use super::super::host::{LanguageHost, SpawnLanguageHostError};
use super::super::protocol::document_notification_payload;
use super::super::readiness::ReadinessConfig;
use super::super::registry::CodeLanguageHostRegistry;
use super::super::resolver::{BundledLanguageRuntime, LanguageRuntime};
use super::super::rpc::file_uri;
use super::scripted_lsp::{scripted_lsp_script, ScriptedLsp};
use crate::types::code_language::{
    CodeLanguageDocumentInput, CodeLanguageDocumentKind, CodeLanguageHostStatus,
    CodeLanguageLocation, CodeLanguagePosition,
};

pub(super) const PROJECT_ID: i64 = 7;

fn write_file(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create parent");
    }
    std::fs::write(path, contents).expect("write file");
}

fn bundled_runtime(root: &Path) -> BundledLanguageRuntime {
    let tsserver_path = root.join("bundled/typescript/lib/tsserver.js");
    let language_server_entry = root.join("bundled/typescript-language-server/lib/cli.mjs");
    write_file(&tsserver_path, "bundled-tsserver");
    write_file(&language_server_entry, "bundled-language-server");
    BundledLanguageRuntime {
        tsserver_path,
        language_server_entry,
    }
}

fn spawn_scripted(
    runtime: &LanguageRuntime,
    script: &str,
    config: ReadinessConfig,
) -> Result<LanguageHost, SpawnLanguageHostError> {
    let script_path = runtime.cwd.join("fake_lsp.py");
    write_file(&script_path, script);
    let mut fake_runtime = runtime.clone();
    fake_runtime.program = "python3".to_string();
    fake_runtime.args = vec![script_path.to_string_lossy().into_owned()];
    LanguageHost::spawn_with_readiness(&fake_runtime, Arc::new(|_, _| {}), config)
}

/// 准备工作区：`src/file.ts` 是打开的文件，`src/lib.ts` 是它 import 的目标。
pub(super) fn prepare_workspace(temp: &Path, name: &str) -> (PathBuf, BundledLanguageRuntime) {
    let root = temp.join(name);
    write_file(
        &root.join("src/file.ts"),
        "import { lib } from \"./lib\";\nlib();\n",
    );
    write_file(&root.join("src/lib.ts"), "export const lib = 1;\n");
    write_file(&root.join("src/early.ts"), "export const early = 1;\n");
    write_file(
        &root.join("node_modules/typescript/lib/tsserver.js"),
        "project-tsserver",
    );
    (root, bundled_runtime(temp))
}

pub(super) fn ensure_scripted(
    registry: &CodeLanguageHostRegistry,
    project_id: i64,
    root: &Path,
    bundled: &BundledLanguageRuntime,
    lsp: &ScriptedLsp,
    config: ReadinessConfig,
) -> CodeLanguageHostStatus {
    let script = scripted_lsp_script(lsp);
    registry.ensure(
        project_id,
        root.to_str().expect("utf8"),
        Some(bundled),
        || Ok("/usr/local/bin/node".to_string()),
        move |runtime| spawn_scripted(runtime, &script, config),
    )
}

/// 等待类测试用的参数：宽限窗足够宽，避免机器调度抖动影响判定。
pub(super) fn waiting_config() -> ReadinessConfig {
    ReadinessConfig {
        wait_limit: Duration::from_secs(5),
        grace_window: Duration::from_secs(2),
    }
}

/// fake 的默认加载时序：didOpen 后 300ms 发 begin、800ms 发 end；用例按需覆盖单项。
pub(super) fn loading_scripted(root: &Path) -> ScriptedLsp {
    ScriptedLsp {
        stale_uri: file_uri(&root.join("src/file.ts")),
        ready_uri: file_uri(&root.join("src/lib.ts")),
        early_uri: None,
        begin_after: Duration::from_millis(300),
        finish_after: Some(Duration::from_millis(800)),
        exit_after: None,
    }
}

pub(super) fn did_open_payload(root: &Path) -> Value {
    document_notification_payload(&CodeLanguageDocumentInput {
        project_id: PROJECT_ID,
        workspace_path: root.to_string_lossy().into_owned(),
        uri: file_uri(&root.join("src/file.ts")),
        kind: CodeLanguageDocumentKind::DidOpen,
        language_id: Some("typescript".to_string()),
        version: Some(1),
        text: Some("import { lib } from \"./lib\";\nlib();\n".to_string()),
    })
    .expect("didOpen payload")
}

pub(super) fn position() -> CodeLanguagePosition {
    CodeLanguagePosition {
        line: 1,
        character: 0,
    }
}

pub(super) fn file_paths(locations: &[CodeLanguageLocation]) -> Vec<String> {
    locations
        .iter()
        .map(|location| location.file_path.clone())
        .collect()
}
