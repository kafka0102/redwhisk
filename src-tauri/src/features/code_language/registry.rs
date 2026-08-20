use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::host::{LanguageHost, SpawnLanguageHostError};
use super::resolver::{
    resolve_language_runtime, BundledLanguageRuntime, LanguageRuntime, ResolveLanguageRuntimeError,
};
use crate::types::code_language::CodeLanguageHostStatus;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct HostKey {
    project_id: i64,
    workspace_path: String,
}

struct HostSlot {
    status: CodeLanguageHostStatus,
    host: Option<Arc<LanguageHost>>,
}

#[derive(Clone)]
pub struct CodeLanguageHostRegistry {
    inner: Arc<Mutex<HashMap<HostKey, HostSlot>>>,
}

impl Default for CodeLanguageHostRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl CodeLanguageHostRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn ensure(
        &self,
        project_id: i64,
        workspace_path: &str,
        bundled: Option<&BundledLanguageRuntime>,
        lookup_node: impl FnOnce() -> Result<String, String>,
        spawn_host: impl FnOnce(&LanguageRuntime) -> Result<LanguageHost, SpawnLanguageHostError>,
    ) -> CodeLanguageHostStatus {
        let key = HostKey {
            project_id,
            workspace_path: workspace_path.to_string(),
        };

        if let Some(status) = self.ready_status(&key) {
            return status;
        }

        self.stop_other_workspaces(project_id, workspace_path);

        let runtime = match resolve_language_runtime(
            std::path::Path::new(workspace_path),
            bundled,
            lookup_node,
        ) {
            Ok(runtime) => runtime,
            Err(ResolveLanguageRuntimeError::Unavailable(reason)) => {
                let status = CodeLanguageHostStatus::unavailable(reason);
                self.insert_status(key, status.clone(), None);
                return status;
            }
        };

        match spawn_host(&runtime) {
            Ok(host) => {
                let status = CodeLanguageHostStatus::ready();
                self.insert_status(key, status.clone(), Some(host));
                status
            }
            Err(SpawnLanguageHostError::Unavailable(reason)) => {
                let status = CodeLanguageHostStatus::unavailable(reason);
                self.insert_status(key, status.clone(), None);
                status
            }
        }
    }

    pub fn stop(&self, project_id: i64, workspace_path: &str) {
        let key = HostKey {
            project_id,
            workspace_path: workspace_path.to_string(),
        };
        if let Ok(mut hosts) = self.inner.lock() {
            if let Some(mut slot) = hosts.remove(&key) {
                if let Some(host) = slot.host.take() {
                    host.stop();
                }
            }
        }
    }

    pub fn stop_project(&self, project_id: i64) {
        if let Ok(mut hosts) = self.inner.lock() {
            let keys: Vec<HostKey> = hosts
                .keys()
                .filter(|key| key.project_id == project_id)
                .cloned()
                .collect();
            for key in keys {
                if let Some(mut slot) = hosts.remove(&key) {
                    if let Some(host) = slot.host.take() {
                        host.stop();
                    }
                }
            }
        }
    }

    pub fn request_definition(
        &self,
        project_id: i64,
        workspace_path: &str,
        uri: &str,
        position: &crate::types::code_language::CodeLanguagePosition,
    ) -> Vec<crate::types::code_language::CodeLanguageLocation> {
        let key = HostKey {
            project_id,
            workspace_path: workspace_path.to_string(),
        };
        let host = {
            let hosts = match self.inner.lock() {
                Ok(hosts) => hosts,
                Err(_) => return Vec::new(),
            };
            match hosts.get(&key).and_then(|slot| slot.host.clone()) {
                Some(host) => host,
                None => return Vec::new(),
            }
        };
        super::definition::request_definition(
            &host,
            std::path::Path::new(workspace_path),
            uri,
            position,
        )
    }

    pub fn notify_document(
        &self,
        project_id: i64,
        workspace_path: &str,
        payload: &serde_json::Value,
    ) -> bool {
        let key = HostKey {
            project_id,
            workspace_path: workspace_path.to_string(),
        };
        let mut hosts = match self.inner.lock() {
            Ok(hosts) => hosts,
            Err(_) => return false,
        };
        let Some(slot) = hosts.get_mut(&key) else {
            return false;
        };
        let Some(host) = slot.host.as_ref() else {
            return false;
        };
        host.write_message(payload).is_ok()
    }

    fn ready_status(&self, key: &HostKey) -> Option<CodeLanguageHostStatus> {
        let mut hosts = self.inner.lock().ok()?;
        let slot = hosts.get_mut(key)?;
        if slot.status.status == crate::types::code_language::CodeLanguageHostStatusKind::Ready {
            if let Some(host) = slot.host.as_ref() {
                if host.is_alive() {
                    return Some(slot.status.clone());
                }
            }
        }
        None
    }

    fn stop_other_workspaces(&self, project_id: i64, workspace_path: &str) {
        if let Ok(mut hosts) = self.inner.lock() {
            let keys: Vec<HostKey> = hosts
                .keys()
                .filter(|key| key.project_id == project_id && key.workspace_path != workspace_path)
                .cloned()
                .collect();
            for key in keys {
                if let Some(mut slot) = hosts.remove(&key) {
                    if let Some(host) = slot.host.take() {
                        host.stop();
                    }
                }
            }
        }
    }

    fn insert_status(
        &self,
        key: HostKey,
        status: CodeLanguageHostStatus,
        host: Option<LanguageHost>,
    ) {
        if let Ok(mut hosts) = self.inner.lock() {
            if let Some(mut previous) = hosts.insert(
                key,
                HostSlot {
                    status,
                    host: host.map(Arc::new),
                },
            ) {
                if let Some(host) = previous.host.take() {
                    host.stop();
                }
            }
        }
    }
}

impl CodeLanguageHostRegistry {
    #[cfg(test)]
    fn stored_reason(
        &self,
        project_id: i64,
        workspace_path: &str,
    ) -> Option<crate::types::code_language::CodeLanguageUnavailableReason> {
        let hosts = self.inner.lock().ok()?;
        hosts
            .get(&HostKey {
                project_id,
                workspace_path: workspace_path.to_string(),
            })?
            .status
            .reason
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tempfile::tempdir;

    use crate::features::code_language::host::LanguageHost;
    use crate::types::code_language::{CodeLanguageHostStatusKind, CodeLanguageUnavailableReason};

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, contents).expect("write file");
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

    fn fake_lsp_script() -> &'static str {
        r#"
import json
import sys

def read_msg():
    headers = {}
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
    sys.stdout.buffer.write(f"Content-Length: {len(raw)}\r\n\r\n".encode("ascii") + raw)
    sys.stdout.buffer.flush()

while True:
    message = read_msg()
    if message is None:
        break
    method = message.get("method")
    if method == "initialize":
        write_msg({"jsonrpc": "2.0", "id": message["id"], "result": {"capabilities": {}}})
    elif method == "shutdown":
        write_msg({"jsonrpc": "2.0", "id": message["id"], "result": None})
    elif method == "exit":
        break
"#
    }

    fn spawn_fake(runtime: &LanguageRuntime) -> Result<LanguageHost, SpawnLanguageHostError> {
        let mut fake_runtime = runtime.clone();
        fake_runtime.program = "python3".to_string();
        fake_runtime.args = vec![runtime
            .cwd
            .join("fake_lsp.py")
            .to_string_lossy()
            .into_owned()];
        LanguageHost::spawn(&fake_runtime)
    }

    #[test]
    fn ensure_returns_unavailable_when_node_is_missing() {
        let temp_dir = tempdir().expect("temp dir");
        let workspace = temp_dir.path().join("repo");
        fs::create_dir_all(&workspace).expect("workspace");
        let bundled = bundled_runtime(temp_dir.path());
        let registry = CodeLanguageHostRegistry::new();
        let spawn_count = Arc::new(AtomicUsize::new(0));
        let spawn_count_for_spawn = Arc::clone(&spawn_count);

        let status = registry.ensure(
            7,
            workspace.to_str().expect("utf8"),
            Some(&bundled),
            || Err("missing node".to_string()),
            move |_| {
                spawn_count_for_spawn.fetch_add(1, Ordering::SeqCst);
                Err(SpawnLanguageHostError::Unavailable(
                    CodeLanguageUnavailableReason::SpawnFailed,
                ))
            },
        );

        assert_eq!(status.status, CodeLanguageHostStatusKind::Unavailable);
        assert_eq!(
            status.reason,
            Some(CodeLanguageUnavailableReason::NodeNotFound)
        );
        assert_eq!(spawn_count.load(Ordering::SeqCst), 0);
        assert_eq!(
            registry.stored_reason(7, workspace.to_str().expect("utf8")),
            Some(CodeLanguageUnavailableReason::NodeNotFound)
        );
    }

    #[test]
    fn ensure_reuses_ready_host_and_stop_clears_it() {
        let temp_dir = tempdir().expect("temp dir");
        let workspace = temp_dir.path().join("repo");
        write_file(&workspace.join("fake_lsp.py"), fake_lsp_script());
        write_file(
            &workspace.join("node_modules/typescript/lib/tsserver.js"),
            "project-tsserver",
        );
        let bundled = bundled_runtime(temp_dir.path());
        let registry = CodeLanguageHostRegistry::new();
        let spawn_count = Arc::new(AtomicUsize::new(0));

        let first = registry.ensure(
            7,
            workspace.to_str().expect("utf8"),
            Some(&bundled),
            || Ok("/usr/local/bin/node".to_string()),
            {
                let spawn_count = Arc::clone(&spawn_count);
                move |runtime| {
                    spawn_count.fetch_add(1, Ordering::SeqCst);
                    spawn_fake(runtime)
                }
            },
        );
        assert_eq!(first.status, CodeLanguageHostStatusKind::Ready);

        let second = registry.ensure(
            7,
            workspace.to_str().expect("utf8"),
            Some(&bundled),
            || Ok("/usr/local/bin/node".to_string()),
            {
                let spawn_count = Arc::clone(&spawn_count);
                move |runtime| {
                    spawn_count.fetch_add(1, Ordering::SeqCst);
                    spawn_fake(runtime)
                }
            },
        );
        assert_eq!(second.status, CodeLanguageHostStatusKind::Ready);
        assert_eq!(spawn_count.load(Ordering::SeqCst), 1);

        registry.stop(7, workspace.to_str().expect("utf8"));
        let third = registry.ensure(
            7,
            workspace.to_str().expect("utf8"),
            Some(&bundled),
            || Ok("/usr/local/bin/node".to_string()),
            {
                let spawn_count = Arc::clone(&spawn_count);
                move |runtime| {
                    spawn_count.fetch_add(1, Ordering::SeqCst);
                    spawn_fake(runtime)
                }
            },
        );
        assert_eq!(third.status, CodeLanguageHostStatusKind::Ready);
        assert_eq!(spawn_count.load(Ordering::SeqCst), 2);
        registry.stop(7, workspace.to_str().expect("utf8"));
    }

    #[test]
    fn notify_document_returns_false_when_host_missing() {
        let registry = CodeLanguageHostRegistry::new();
        assert!(!registry.notify_document(7, "/tmp/missing", &serde_json::json!({})));
    }
}
