use std::path::{Path, PathBuf};

use crate::types::code_language::CodeLanguageUnavailableReason;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LanguageRuntime {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub tsserver_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundledLanguageRuntime {
    pub tsserver_path: PathBuf,
    pub language_server_entry: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveLanguageRuntimeError {
    Unavailable(CodeLanguageUnavailableReason),
}

pub fn resolve_bundled_runtime(resource_dir: Option<&Path>) -> Option<BundledLanguageRuntime> {
    let mut candidates = Vec::new();
    if let Some(resource_dir) = resource_dir {
        candidates.push(resource_dir.join("language-runtime"));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../node_modules"));

    candidates
        .into_iter()
        .find_map(|root| bundled_runtime_from_root(&root))
}

fn bundled_runtime_from_root(root: &Path) -> Option<BundledLanguageRuntime> {
    let tsserver_path = root.join("typescript/lib/tsserver.js");
    let language_server_entry = root.join("typescript-language-server/lib/cli.mjs");
    let language_server_manifest = root.join("typescript-language-server/package.json");
    if tsserver_path.is_file()
        && language_server_entry.is_file()
        && language_server_manifest.is_file()
    {
        Some(BundledLanguageRuntime {
            tsserver_path,
            language_server_entry,
        })
    } else {
        None
    }
}

pub fn find_project_tsserver(workspace_root: &Path) -> Option<PathBuf> {
    let mut current = workspace_root.to_path_buf();
    loop {
        let candidate = current.join("node_modules/typescript/lib/tsserver.js");
        if candidate.is_file() {
            return Some(candidate);
        }
        if !current.pop() {
            return None;
        }
    }
}

pub fn resolve_language_runtime(
    workspace_root: &Path,
    bundled: Option<&BundledLanguageRuntime>,
    lookup_node: impl FnOnce() -> Result<String, String>,
) -> Result<LanguageRuntime, ResolveLanguageRuntimeError> {
    let node_path = lookup_node().map_err(|_| {
        ResolveLanguageRuntimeError::Unavailable(CodeLanguageUnavailableReason::NodeNotFound)
    })?;
    let tsserver_path = find_project_tsserver(workspace_root)
        .or_else(|| bundled.map(|runtime| runtime.tsserver_path.clone()))
        .ok_or(ResolveLanguageRuntimeError::Unavailable(
            CodeLanguageUnavailableReason::SpawnFailed,
        ))?;
    let language_server_entry = bundled
        .map(|runtime| runtime.language_server_entry.clone())
        .ok_or(ResolveLanguageRuntimeError::Unavailable(
            CodeLanguageUnavailableReason::SpawnFailed,
        ))?;
    if !language_server_entry.is_file() {
        return Err(ResolveLanguageRuntimeError::Unavailable(
            CodeLanguageUnavailableReason::SpawnFailed,
        ));
    }

    Ok(LanguageRuntime {
        program: node_path,
        args: vec![
            language_server_entry.to_string_lossy().into_owned(),
            "--stdio".to_string(),
            "--log-level".to_string(),
            "1".to_string(),
        ],
        cwd: workspace_root.to_path_buf(),
        tsserver_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

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

    #[test]
    fn prefers_project_typescript_over_bundled() {
        let temp_dir = tempdir().expect("temp dir");
        let workspace = temp_dir.path().join("repo");
        write_file(
            &workspace.join("node_modules/typescript/lib/tsserver.js"),
            "project-tsserver",
        );
        let bundled = bundled_runtime(temp_dir.path());

        let runtime = resolve_language_runtime(&workspace, Some(&bundled), || {
            Ok("/usr/local/bin/node".to_string())
        })
        .expect("resolve");

        assert_eq!(
            runtime.tsserver_path,
            workspace.join("node_modules/typescript/lib/tsserver.js")
        );
        assert_eq!(runtime.program, "/usr/local/bin/node");
        assert_eq!(
            runtime.args[0],
            bundled.language_server_entry.to_string_lossy()
        );
        assert!(runtime.args.contains(&"--stdio".to_string()));
    }

    #[test]
    fn walks_up_from_nested_workspace_to_find_project_typescript() {
        let temp_dir = tempdir().expect("temp dir");
        let repo = temp_dir.path().join("repo");
        let workspace = repo.join("packages/app");
        write_file(
            &repo.join("node_modules/typescript/lib/tsserver.js"),
            "root-tsserver",
        );
        fs::create_dir_all(&workspace).expect("nested workspace");
        let bundled = bundled_runtime(temp_dir.path());

        let runtime = resolve_language_runtime(&workspace, Some(&bundled), || {
            Ok("/usr/local/bin/node".to_string())
        })
        .expect("resolve");

        assert_eq!(
            runtime.tsserver_path,
            repo.join("node_modules/typescript/lib/tsserver.js")
        );
    }

    #[test]
    fn falls_back_to_bundled_typescript_when_project_has_none() {
        let temp_dir = tempdir().expect("temp dir");
        let workspace = temp_dir.path().join("repo");
        fs::create_dir_all(&workspace).expect("workspace");
        let bundled = bundled_runtime(temp_dir.path());

        let runtime = resolve_language_runtime(&workspace, Some(&bundled), || {
            Ok("/usr/local/bin/node".to_string())
        })
        .expect("resolve");

        assert_eq!(runtime.tsserver_path, bundled.tsserver_path);
    }

    #[test]
    fn returns_unavailable_when_node_lookup_fails() {
        let temp_dir = tempdir().expect("temp dir");
        let workspace = temp_dir.path().join("repo");
        fs::create_dir_all(&workspace).expect("workspace");
        let bundled = bundled_runtime(temp_dir.path());

        let error = resolve_language_runtime(&workspace, Some(&bundled), || {
            Err("node not found".to_string())
        })
        .expect_err("node missing");

        assert_eq!(
            error,
            ResolveLanguageRuntimeError::Unavailable(CodeLanguageUnavailableReason::NodeNotFound)
        );
    }

    #[test]
    fn returns_spawn_failed_when_typescript_and_language_server_missing() {
        let temp_dir = tempdir().expect("temp dir");
        let workspace = temp_dir.path().join("repo");
        fs::create_dir_all(&workspace).expect("workspace");

        let error =
            resolve_language_runtime(&workspace, None, || Ok("/usr/local/bin/node".to_string()))
                .expect_err("runtime missing");

        assert_eq!(
            error,
            ResolveLanguageRuntimeError::Unavailable(CodeLanguageUnavailableReason::SpawnFailed)
        );
    }

    fn language_runtime_resource_dir(root: &Path) -> PathBuf {
        root.join("language-runtime")
    }

    fn write_incomplete_language_runtime(root: &Path) {
        write_file(
            &language_runtime_resource_dir(root).join("typescript/lib/tsserver.js"),
            "bundled-tsserver",
        );
        write_file(
            &language_runtime_resource_dir(root).join("typescript-language-server/lib/cli.mjs"),
            "bundled-language-server",
        );
    }

    #[test]
    fn bundled_runtime_rejects_language_server_without_package_json() {
        let temp_dir = tempdir().expect("temp dir");
        write_incomplete_language_runtime(temp_dir.path());

        assert_eq!(
            bundled_runtime_from_root(&language_runtime_resource_dir(temp_dir.path())),
            None
        );
    }

    #[test]
    fn bundled_runtime_accepts_language_server_with_package_json() {
        let temp_dir = tempdir().expect("temp dir");
        write_incomplete_language_runtime(temp_dir.path());
        write_file(
            &language_runtime_resource_dir(temp_dir.path())
                .join("typescript-language-server/package.json"),
            r#"{"name":"typescript-language-server","version":"6.0.0"}"#,
        );

        let bundled = bundled_runtime_from_root(&language_runtime_resource_dir(temp_dir.path()))
            .expect("complete bundle");
        assert_eq!(
            bundled.language_server_entry,
            language_runtime_resource_dir(temp_dir.path())
                .join("typescript-language-server/lib/cli.mjs")
        );
    }

    #[test]
    fn tauri_bundle_includes_language_server_package_json() {
        let conf: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tauri.conf.json"
        )))
        .expect("parse tauri.conf.json");
        let resources = conf
            .get("bundle")
            .and_then(|bundle| bundle.get("resources"))
            .and_then(|resources| resources.as_object())
            .expect("bundle.resources object");
        let has_package_json = resources.iter().any(|(source, destination)| {
            source.ends_with("typescript-language-server/package.json")
                && destination.as_str()
                    == Some("language-runtime/typescript-language-server/package.json")
        });
        assert!(
            has_package_json,
            "tauri bundle must include typescript-language-server/package.json"
        );
    }
}
