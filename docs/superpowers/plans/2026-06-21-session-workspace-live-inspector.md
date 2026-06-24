# Session Workspace Live Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Agents Session side-panel placeholders with real uncommitted Git changes, a real repository file tree, per-session in-memory workspace cache, and read-only Monaco file/diff viewers.

**Architecture:** Rust owns repository access, Git diff extraction, workspace-root resolution, and path safety through Tauri commands. React owns polling, per-session runtime cache, UI state, and rendering via `@monaco-editor/react` and `react-arborist`.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Tauri 2, Rust 2021, `git` CLI, `@monaco-editor/react`, `monaco-editor`, `react-arborist`, lucide-react.

## Global Constraints

- Default explanatory text is Simplified Chinese; code identifiers, commands, API names, file paths, and protocol fields remain untranslated.
- Before implementation, read `docs/README.md`, `docs/architecture-design/agent-development-rules.md`, `docs/standards/engineering-spec.md`, `docs/standards/coding-style.md`, and `docs/architecture-design/design-guide.md`.
- Frontend command wrappers must use `invokeCommand` and camelCase TypeScript DTOs matching Rust DTOs.
- Rust Tauri commands must use snake_case command names, camelCase serde DTOs, and structured `CommandError`.
- React must not read the filesystem or run shell commands directly; repository data comes through Tauri commands.
- Workspace file access must reject absolute paths, `..` traversal, and symlink escapes outside the selected workspace root.
- Session workspace cache is runtime memory only; do not add SQLite tables or persistence.
- The `已提交` changes filter remains an explicit placeholder; do not implement commit history.
- UI must stay RedWhisk-style: quiet, compact, 13px body text, no marketing hero, gradients, decorative shadows, or large rounded cards.
- Changed-file state cannot be communicated only by color or strikethrough; use text labels such as `新增`, `修改`, `删除`, `重命名`.
- No file editing, saving, staging, unstaging, committing, renaming, deleting, or drag-moving.
- Poll uncommitted changes about every `2s` while the changes tab is visible in an open side panel.
- Poll the file tree about every `5s` while the file tree tab is active.
- Use `@monaco-editor/react` + `monaco-editor` for read-only file/diff viewing and `react-arborist` for the repository tree.
- Follow TDD: write or update the failing test first, run it and verify the expected failure, then implement.
- Verification commands after implementation: `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `cd src-tauri && cargo test`, and `openspec validate session-workspace-live-inspector --strict`.

---

## File Structure

- Create `src-tauri/src/types/session_workspace.rs`: Rust DTOs for workspace changes, file tree nodes, file contents, diff contents, and command inputs/responses.
- Create `src-tauri/src/core/session_workspace_service.rs`: workspace root resolution, safe path normalization, Git status/diff reading, file tree scanning, file reading, and command-facing service functions.
- Create `src-tauri/src/commands/session_workspace_commands.rs`: Tauri command adapters and local data initialization.
- Modify `src-tauri/src/types/mod.rs`, `src-tauri/src/core/mod.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/types/errors.rs`: module registration, invoke handler registration, and workspace error code if needed.
- Create `src/features/agents/session-workspace-commands.ts`: TypeScript DTOs and command wrappers for the new commands.
- Create `src/features/agents/use-session-workspace-cache.ts`: per-session cache, polling, refresh handlers, open file/diff commands, and tab state coordination.
- Modify `src/features/agents/session-workspace-types.ts`: replace placeholder-only types with workspace-aware file/change tab types.
- Modify `src/features/agents/agents-activity.tsx`, `src/features/agents/agents-session-pane.tsx`, `src/features/agents/session-side-panel.tsx`, `src/features/agents/session-changes-panel.tsx`, `src/features/agents/session-file-tree-panel.tsx`, `src/features/agents/session-workspace-tabs.tsx`: wire real data and callbacks.
- Replace or supersede `src/features/agents/session-diff-placeholder.tsx` and `src/features/agents/session-file-preview-placeholder.tsx` with real viewer components.
- Create `src/features/agents/session-diff-viewer.tsx` and `src/features/agents/session-file-viewer.tsx`: Monaco read-only diff/file renderers with binary/too-large fallback states.
- Modify `src/app/app.css`: compact tree rows, changed-file labels, Monaco host sizing, loading/error states.
- Modify `src/features/agents/agents-activity.test.tsx` and add focused tests if needed for workspace cache/viewer behavior.
- Modify `package.json` and `pnpm-lock.yaml`: add `@monaco-editor/react`, `monaco-editor`, and `react-arborist`.
- Remove `src/features/agents/session-mock-files.ts` only after all imports are gone.

---

### Task 1: Rust Workspace Commands

**Files:**
- Create: `src-tauri/src/types/session_workspace.rs`
- Create: `src-tauri/src/core/session_workspace_service.rs`
- Create: `src-tauri/src/commands/session_workspace_commands.rs`
- Modify: `src-tauri/src/types/mod.rs`
- Modify: `src-tauri/src/core/mod.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/types/errors.rs`

**Interfaces:**
- Produces command names:
  - `get_project_worktree_changes`
  - `get_project_worktree_file_tree`
  - `read_project_worktree_file`
  - `read_project_worktree_diff`
- Produces Rust/TS-compatible DTO fields:
  - `WorkspaceChangedFile { file_path, old_path, file_name, kind, status, additions, deletions, is_binary, content_hash, metadata_signature }`
  - `WorkspaceFileTreeNode { id, name, path, kind, children, size_bytes, modified_at }`
  - `WorkspaceFileContent { file_path, language, content, modified_at, size_bytes, is_binary, is_too_large }`
  - `WorkspaceDiffContent { file_path, old_path, kind, language, original_content, modified_content, is_binary, is_too_large }`
- Later tasks consume these via `src/features/agents/session-workspace-commands.ts`.

- [ ] **Step 1: Add failing Rust tests for path safety**

Add tests inside `src-tauri/src/core/session_workspace_service.rs` while creating the module. Include this initial test block before implementation:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn safe_relative_path_rejects_absolute_and_parent_segments() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();

        assert!(resolve_workspace_relative_path(root, "/etc/passwd").is_err());
        assert!(resolve_workspace_relative_path(root, "../outside.txt").is_err());
        assert!(resolve_workspace_relative_path(root, "nested/../../outside.txt").is_err());
    }

    #[test]
    fn safe_relative_path_allows_files_inside_workspace() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        fs::create_dir_all(root.join("src")).expect("create src");
        fs::write(root.join("src/main.rs"), "fn main() {}\n").expect("write file");

        let resolved = resolve_workspace_relative_path(root, "src/main.rs").expect("resolve");

        assert_eq!(resolved, root.join("src/main.rs"));
    }
}
```

- [ ] **Step 2: Run Rust test and verify RED**

Run:

```bash
cd src-tauri && cargo test session_workspace_service::tests::safe_relative_path -- --nocapture
```

Expected: FAIL or compile error because `resolve_workspace_relative_path` and module registrations do not exist yet.

- [ ] **Step 3: Add DTOs and module registrations**

Create `src-tauri/src/types/session_workspace.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Binary,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspaceInput {
    pub project_id: i64,
    pub session_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspacePathInput {
    pub project_id: i64,
    pub session_id: Option<i64>,
    pub file_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChangedFile {
    pub file_path: String,
    pub old_path: Option<String>,
    pub file_name: String,
    pub kind: WorkspaceChangeKind,
    pub status: String,
    pub additions: i64,
    pub deletions: i64,
    pub is_binary: bool,
    pub content_hash: String,
    pub metadata_signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorktreeChangesResponse {
    pub files: Vec<WorkspaceChangedFile>,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceFileTreeNodeKind {
    Directory,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileTreeNode {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: WorkspaceFileTreeNodeKind,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<WorkspaceFileTreeNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorktreeFileTreeResponse {
    pub nodes: Vec<WorkspaceFileTreeNode>,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileContent {
    pub file_path: String,
    pub language: Option<String>,
    pub content: String,
    pub modified_at: Option<i64>,
    pub size_bytes: u64,
    pub is_binary: bool,
    pub is_too_large: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiffContent {
    pub file_path: String,
    pub old_path: Option<String>,
    pub kind: WorkspaceChangeKind,
    pub language: Option<String>,
    pub original_content: String,
    pub modified_content: String,
    pub is_binary: bool,
    pub is_too_large: bool,
}
```

Update:

```rust
// src-tauri/src/types/mod.rs
pub mod session_workspace;

// src-tauri/src/core/mod.rs
pub mod session_workspace_service;

// src-tauri/src/commands/mod.rs
pub mod session_workspace_commands;
```

- [ ] **Step 4: Implement minimal service with safe path**

In `src-tauri/src/core/session_workspace_service.rs`, implement:

```rust
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;

use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::project_repository::ProjectRepository;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::session_workspace::{
    ProjectWorkspaceInput, ProjectWorkspacePathInput, ProjectWorktreeChangesResponse,
    ProjectWorktreeFileTreeResponse, WorkspaceChangeKind, WorkspaceChangedFile,
    WorkspaceDiffContent, WorkspaceFileContent, WorkspaceFileTreeNode,
    WorkspaceFileTreeNodeKind,
};

const MAX_TEXT_FILE_BYTES: u64 = 1_000_000;
const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".vite",
];

pub struct SessionWorkspaceService<'connection> {
    project_repository: ProjectRepository<'connection>,
    agent_session_repository: AgentSessionRepository<'connection>,
}

impl<'connection> SessionWorkspaceService<'connection> {
    pub fn new(
        project_repository: ProjectRepository<'connection>,
        agent_session_repository: AgentSessionRepository<'connection>,
    ) -> Self {
        Self {
            project_repository,
            agent_session_repository,
        }
    }

    pub fn get_changes(
        &self,
        input: ProjectWorkspaceInput,
    ) -> Result<ProjectWorktreeChangesResponse, CommandError> {
        let root = self.resolve_workspace_root(input.project_id, input.session_id)?;
        read_workspace_changes(&root)
    }

    pub fn get_file_tree(
        &self,
        input: ProjectWorkspaceInput,
    ) -> Result<ProjectWorktreeFileTreeResponse, CommandError> {
        let root = self.resolve_workspace_root(input.project_id, input.session_id)?;
        read_workspace_file_tree(&root)
    }

    pub fn read_file(
        &self,
        input: ProjectWorkspacePathInput,
    ) -> Result<WorkspaceFileContent, CommandError> {
        let root = self.resolve_workspace_root(input.project_id, input.session_id)?;
        read_workspace_file(&root, &input.file_path)
    }

    pub fn read_diff(
        &self,
        input: ProjectWorkspacePathInput,
    ) -> Result<WorkspaceDiffContent, CommandError> {
        let root = self.resolve_workspace_root(input.project_id, input.session_id)?;
        read_workspace_diff(&root, &input.file_path)
    }

    fn resolve_workspace_root(
        &self,
        project_id: i64,
        session_id: Option<i64>,
    ) -> Result<PathBuf, CommandError> {
        let project = self
            .project_repository
            .find_by_id(project_id)
            .map_err(workspace_persistence_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            })?;

        if let Some(session_id) = session_id {
            if let Some(session) = self
                .agent_session_repository
                .find_by_id(session_id)
                .map_err(workspace_persistence_error)?
            {
                if session.project_id == project_id {
                    if let Some(workspace_path) = session.workspace_path {
                        return canonical_workspace_root(&workspace_path);
                    }
                }
            }
        }

        canonical_workspace_root(&project.repo_path)
    }
}

pub fn resolve_workspace_relative_path(
    root: &Path,
    file_path: &str,
) -> Result<PathBuf, CommandError> {
    let relative_path = Path::new(file_path);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(workspace_validation_error("路径必须是仓库内相对路径。", file_path));
    }

    let joined_path = root.join(relative_path);
    let parent = joined_path.parent().unwrap_or(root);
    let canonical_parent = parent.canonicalize().map_err(|error| {
        workspace_validation_error(&format!("文件路径不可访问：{error}"), file_path)
    })?;

    if !canonical_parent.starts_with(root) {
        return Err(workspace_validation_error("文件路径不能离开仓库目录。", file_path));
    }

    Ok(joined_path)
}

fn canonical_workspace_root(path: &str) -> Result<PathBuf, CommandError> {
    let root = Path::new(path).canonicalize().map_err(|error| {
        CommandError::new(CommandErrorCode::AgentSessionValidationFailed, "仓库路径不可访问。")
            .with_detail(ErrorDetail::new("WorkspaceRoot").with_value("path", path.to_string()))
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    if !root.is_dir() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "仓库路径不是目录。",
        )
        .with_detail(ErrorDetail::new("WorkspaceRoot").with_value("path", path.to_string())));
    }

    Ok(root)
}
```

Continue in the same file with functions described in Steps 5-7.

- [ ] **Step 5: Implement changed-file listing and numstat**

Add:

```rust
fn read_workspace_changes(root: &Path) -> Result<ProjectWorktreeChangesResponse, CommandError> {
    let status_output = run_git_bytes(root, &["status", "--porcelain=v1", "-z"])?;
    let entries = parse_status_entries(&status_output)?;
    let mut files = Vec::new();

    for entry in entries {
        let (additions, deletions, is_binary) = read_numstat(root, &entry.path);
        let metadata_signature = file_metadata_signature(root, &entry.path);
        let content_hash = hash_string(&format!(
            "{}:{}:{}:{}:{}",
            entry.status, entry.path, additions, deletions, metadata_signature
        ));

        files.push(WorkspaceChangedFile {
            file_name: file_name_from_path(&entry.path),
            file_path: entry.path,
            old_path: entry.old_path,
            kind: entry.kind,
            status: entry.status,
            additions,
            deletions,
            is_binary,
            content_hash,
            metadata_signature,
        });
    }

    files.sort_by(|left, right| left.file_path.cmp(&right.file_path));
    let signature = hash_string(&format!("{files:?}"));

    Ok(ProjectWorktreeChangesResponse { files, signature })
}

#[derive(Debug, Clone)]
struct StatusEntry {
    status: String,
    path: String,
    old_path: Option<String>,
    kind: WorkspaceChangeKind,
}

fn parse_status_entries(output: &[u8]) -> Result<Vec<StatusEntry>, CommandError> {
    let mut records = output
        .split(|byte| *byte == b'\0')
        .filter(|record| !record.is_empty());
    let mut entries = Vec::new();

    while let Some(record) = records.next() {
        if record.len() < 4 || record[2] != b' ' {
            return Err(CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Git status 输出无法解析。",
            ));
        }

        let status = String::from_utf8_lossy(&record[..2]).to_string();
        let path = String::from_utf8_lossy(&record[3..]).to_string();
        let old_path = if status.bytes().any(|byte| matches!(byte, b'R' | b'C')) {
            records
                .next()
                .map(|value| String::from_utf8_lossy(value).to_string())
        } else {
            None
        };
        let kind = change_kind_from_status(&status);

        entries.push(StatusEntry {
            status,
            path,
            old_path,
            kind,
        });
    }

    Ok(entries)
}

fn change_kind_from_status(status: &str) -> WorkspaceChangeKind {
    let bytes = status.as_bytes();
    if bytes.contains(&b'R') {
        WorkspaceChangeKind::Renamed
    } else if bytes.contains(&b'C') {
        WorkspaceChangeKind::Copied
    } else if bytes.contains(&b'D') {
        WorkspaceChangeKind::Deleted
    } else if status == "??" {
        WorkspaceChangeKind::Untracked
    } else if bytes.contains(&b'A') {
        WorkspaceChangeKind::Added
    } else {
        WorkspaceChangeKind::Modified
    }
}

fn read_numstat(root: &Path, path: &str) -> (i64, i64, bool) {
    let output = run_git(root, &["diff", "--numstat", "HEAD", "--", path]).unwrap_or_default();
    if let Some(line) = output.lines().next() {
        let mut parts = line.split('\t');
        let added = parts.next().unwrap_or("0");
        let deleted = parts.next().unwrap_or("0");
        if added == "-" || deleted == "-" {
            return (0, 0, true);
        }
        return (
            added.parse::<i64>().unwrap_or(0),
            deleted.parse::<i64>().unwrap_or(0),
            false,
        );
    }

    let absolute_path = root.join(path);
    if absolute_path.is_file() {
        let additions = fs::read_to_string(absolute_path)
            .map(|content| content.lines().count() as i64)
            .unwrap_or(0);
        return (additions, 0, false);
    }

    (0, 0, false)
}
```

- [ ] **Step 6: Implement file tree and file content reading**

Add:

```rust
fn read_workspace_file_tree(root: &Path) -> Result<ProjectWorktreeFileTreeResponse, CommandError> {
    let mut nodes = read_directory_nodes(root, root)?;
    nodes.sort_by(compare_tree_nodes);
    let signature = hash_string(&format!("{nodes:?}"));

    Ok(ProjectWorktreeFileTreeResponse { nodes, signature })
}

fn read_directory_nodes(root: &Path, dir: &Path) -> Result<Vec<WorkspaceFileTreeNode>, CommandError> {
    let mut nodes = Vec::new();
    let entries = fs::read_dir(dir).map_err(|error| {
        CommandError::new(CommandErrorCode::AgentSessionValidationFailed, "文件树读取失败。")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    for entry in entries {
        let entry = entry.map_err(workspace_io_error)?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() && IGNORED_DIRS.contains(&name.as_str()) {
            continue;
        }

        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let metadata = entry.metadata().map_err(workspace_io_error)?;

        if metadata.is_dir() {
            let mut children = read_directory_nodes(root, &path)?;
            children.sort_by(compare_tree_nodes);
            nodes.push(WorkspaceFileTreeNode {
                id: relative_path.clone(),
                name,
                path: relative_path,
                kind: WorkspaceFileTreeNodeKind::Directory,
                children,
                size_bytes: None,
                modified_at: modified_at_millis(&metadata),
            });
        } else if metadata.is_file() {
            nodes.push(WorkspaceFileTreeNode {
                id: relative_path.clone(),
                name,
                path: relative_path,
                kind: WorkspaceFileTreeNodeKind::File,
                children: Vec::new(),
                size_bytes: Some(metadata.len()),
                modified_at: modified_at_millis(&metadata),
            });
        }
    }

    Ok(nodes)
}

fn read_workspace_file(root: &Path, file_path: &str) -> Result<WorkspaceFileContent, CommandError> {
    let absolute_path = resolve_workspace_relative_path(root, file_path)?;
    let metadata = fs::metadata(&absolute_path).map_err(workspace_io_error)?;
    let size_bytes = metadata.len();
    let language = language_from_path(file_path);
    if size_bytes > MAX_TEXT_FILE_BYTES {
        return Ok(WorkspaceFileContent {
            file_path: file_path.to_string(),
            language,
            content: String::new(),
            modified_at: modified_at_millis(&metadata),
            size_bytes,
            is_binary: false,
            is_too_large: true,
        });
    }

    let bytes = fs::read(&absolute_path).map_err(workspace_io_error)?;
    if bytes.contains(&0) {
        return Ok(WorkspaceFileContent {
            file_path: file_path.to_string(),
            language,
            content: String::new(),
            modified_at: modified_at_millis(&metadata),
            size_bytes,
            is_binary: true,
            is_too_large: false,
        });
    }

    Ok(WorkspaceFileContent {
        file_path: file_path.to_string(),
        language,
        content: String::from_utf8_lossy(&bytes).to_string(),
        modified_at: modified_at_millis(&metadata),
        size_bytes,
        is_binary: false,
        is_too_large: false,
    })
}
```

- [ ] **Step 7: Implement diff content and helpers**

Add:

```rust
fn read_workspace_diff(root: &Path, file_path: &str) -> Result<WorkspaceDiffContent, CommandError> {
    let changes = read_workspace_changes(root)?;
    let change = changes
        .files
        .into_iter()
        .find(|file| file.file_path == file_path)
        .ok_or_else(|| workspace_validation_error("文件没有未提交变更。", file_path))?;

    if change.is_binary {
        return Ok(WorkspaceDiffContent {
            file_path: change.file_path,
            old_path: change.old_path,
            kind: WorkspaceChangeKind::Binary,
            language: language_from_path(file_path),
            original_content: String::new(),
            modified_content: String::new(),
            is_binary: true,
            is_too_large: false,
        });
    }

    let original_content = match change.kind {
        WorkspaceChangeKind::Added | WorkspaceChangeKind::Untracked => String::new(),
        _ => {
            let original_path = change.old_path.as_deref().unwrap_or(&change.file_path);
            run_git(root, &["show", &format!("HEAD:{original_path}")]).unwrap_or_default()
        }
    };

    let modified_content = match change.kind {
        WorkspaceChangeKind::Deleted => String::new(),
        _ => read_workspace_file(root, &change.file_path)?.content,
    };

    Ok(WorkspaceDiffContent {
        file_path: change.file_path,
        old_path: change.old_path,
        kind: change.kind,
        language: language_from_path(file_path),
        original_content,
        modified_content,
        is_binary: false,
        is_too_large: false,
    })
}

fn run_git(root: &Path, args: &[&str]) -> Result<String, CommandError> {
    let output = run_git_bytes(root, args)?;
    String::from_utf8(output).map_err(|error| {
        CommandError::new(CommandErrorCode::AgentSessionValidationFailed, "Git 输出不是 UTF-8。")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })
}

fn run_git_bytes(root: &Path, args: &[&str]) -> Result<Vec<u8>, CommandError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|error| {
            CommandError::new(CommandErrorCode::AgentSessionValidationFailed, "Git 命令执行失败。")
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;
    if !output.status.success() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "Git 命令执行失败。",
        )
        .with_detail(
            ErrorDetail::new("Cause")
                .with_value("message", String::from_utf8_lossy(&output.stderr).to_string()),
        ));
    }
    Ok(output.stdout)
}

fn workspace_persistence_error(error: rusqlite::Error) -> CommandError {
    CommandError::new(CommandErrorCode::AgentSessionPersistenceFailed, "工作区查询失败。")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

fn workspace_io_error(error: std::io::Error) -> CommandError {
    CommandError::new(CommandErrorCode::AgentSessionValidationFailed, "工作区文件读取失败。")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

fn workspace_validation_error(message: &str, file_path: &str) -> CommandError {
    CommandError::new(CommandErrorCode::AgentSessionValidationFailed, message)
        .with_detail(ErrorDetail::new("WorkspacePath").with_value("filePath", file_path.to_string()))
}

fn file_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn file_metadata_signature(root: &Path, path: &str) -> String {
    let absolute_path = root.join(path);
    fs::metadata(absolute_path)
        .map(|metadata| {
            format!(
                "{}:{}",
                metadata.len(),
                modified_at_millis(&metadata).unwrap_or_default()
            )
        })
        .unwrap_or_else(|_| "missing".to_string())
}

fn modified_at_millis(metadata: &fs::Metadata) -> Option<i64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
}

fn compare_tree_nodes(left: &WorkspaceFileTreeNode, right: &WorkspaceFileTreeNode) -> std::cmp::Ordering {
    match (&left.kind, &right.kind) {
        (WorkspaceFileTreeNodeKind::Directory, WorkspaceFileTreeNodeKind::File) => std::cmp::Ordering::Less,
        (WorkspaceFileTreeNodeKind::File, WorkspaceFileTreeNodeKind::Directory) => std::cmp::Ordering::Greater,
        _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
    }
}

fn hash_string(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn language_from_path(path: &str) -> Option<String> {
    match Path::new(path).extension().and_then(|value| value.to_str()) {
        Some("css") => Some("css".to_string()),
        Some("html") => Some("html".to_string()),
        Some("js") | Some("mjs") | Some("cjs") => Some("javascript".to_string()),
        Some("json") => Some("json".to_string()),
        Some("md") => Some("markdown".to_string()),
        Some("rs") => Some("rust".to_string()),
        Some("ts") => Some("typescript".to_string()),
        Some("tsx") => Some("typescript".to_string()),
        Some("vue") => Some("html".to_string()),
        Some("yaml") | Some("yml") => Some("yaml".to_string()),
        _ => None,
    }
}
```

- [ ] **Step 8: Add command adapters and invoke handler**

Create `src-tauri/src/commands/session_workspace_commands.rs`:

```rust
use tauri::State;

use crate::app_state::AppState;
use crate::core::session_workspace_service::SessionWorkspaceService;
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::session_workspace::{
    ProjectWorkspaceInput, ProjectWorkspacePathInput, ProjectWorktreeChangesResponse,
    ProjectWorktreeFileTreeResponse, WorkspaceDiffContent, WorkspaceFileContent,
};

#[tauri::command]
pub fn get_project_worktree_changes(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ProjectWorkspaceInput,
) -> Result<ProjectWorktreeChangesResponse, CommandError> {
    with_session_workspace_service(app, state, |service| service.get_changes(input))
}

#[tauri::command]
pub fn get_project_worktree_file_tree(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ProjectWorkspaceInput,
) -> Result<ProjectWorktreeFileTreeResponse, CommandError> {
    with_session_workspace_service(app, state, |service| service.get_file_tree(input))
}

#[tauri::command]
pub fn read_project_worktree_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ProjectWorkspacePathInput,
) -> Result<WorkspaceFileContent, CommandError> {
    with_session_workspace_service(app, state, |service| service.read_file(input))
}

#[tauri::command]
pub fn read_project_worktree_diff(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ProjectWorkspacePathInput,
) -> Result<WorkspaceDiffContent, CommandError> {
    with_session_workspace_service(app, state, |service| service.read_diff(input))
}

fn with_session_workspace_service<T>(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    action: impl FnOnce(SessionWorkspaceService<'_>) -> Result<T, CommandError>,
) -> Result<T, CommandError> {
    let data_dir = crate::local_data_path::redwhisk_data_dir(&app).map_err(|error| {
        CommandError::new(CommandErrorCode::AgentSessionPersistenceFailed, "工作区读取失败。")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    {
        let mut local_data = state.local_data.lock().map_err(|_| {
            CommandError::new(CommandErrorCode::AgentSessionPersistenceFailed, "工作区读取失败。")
        })?;
        local_data.initialize(&data_dir).map_err(CommandError::from)?;
    }

    let database = crate::db::connection::DatabaseConfig::new(&data_dir)
        .open()
        .map_err(CommandError::from)?;
    crate::db::migrations::MigrationRunner::default()
        .run(&database.connection)
        .map_err(|error| {
            CommandError::new(CommandErrorCode::AgentSessionPersistenceFailed, "工作区读取失败。")
                .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;

    let service = SessionWorkspaceService::new(
        crate::db::project_repository::ProjectRepository::new(&database.connection),
        crate::db::agent_session_repository::AgentSessionRepository::new(&database.connection),
    );
    action(service)
}
```

Register commands in `src-tauri/src/lib.rs`:

```rust
commands::session_workspace_commands::get_project_worktree_changes,
commands::session_workspace_commands::get_project_worktree_file_tree,
commands::session_workspace_commands::read_project_worktree_file,
commands::session_workspace_commands::read_project_worktree_diff,
```

- [ ] **Step 9: Run Rust test and fix lifetime/style issues**

Run:

```bash
cd src-tauri && cargo test session_workspace_service -- --nocapture
```

Expected: PASS. If lifetime errors arise in command adapters, refactor `session_workspace_service` into repeated command-local database setup, mirroring existing command patterns and without leaking memory.

- [ ] **Step 10: Commit Task 1**

Run:

```bash
git add src-tauri/src/types/session_workspace.rs src-tauri/src/core/session_workspace_service.rs src-tauri/src/commands/session_workspace_commands.rs src-tauri/src/types/mod.rs src-tauri/src/core/mod.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/src/types/errors.rs
git commit -m "feat: 添加 Session 工作区读取命令"
```

---

### Task 2: Frontend Command Wrappers and Dependencies

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/features/agents/session-workspace-commands.ts`

**Interfaces:**
- Consumes Tauri commands from Task 1.
- Produces typed functions:
  - `getProjectWorktreeChanges(input: ProjectWorkspaceInput): Promise<ProjectWorktreeChangesResponse>`
  - `getProjectWorktreeFileTree(input: ProjectWorkspaceInput): Promise<ProjectWorktreeFileTreeResponse>`
  - `readProjectWorktreeFile(input: ProjectWorkspacePathInput): Promise<WorkspaceFileContent>`
  - `readProjectWorktreeDiff(input: ProjectWorkspacePathInput): Promise<WorkspaceDiffContent>`

- [ ] **Step 1: Install dependencies**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm add @monaco-editor/react monaco-editor react-arborist
```

Expected: `package.json` and `pnpm-lock.yaml` updated.

- [ ] **Step 2: Add failing wrapper import test**

Create or extend `src/features/agents/session-workspace-commands.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import {
  getProjectWorktreeChanges,
  getProjectWorktreeFileTree,
  readProjectWorktreeDiff,
  readProjectWorktreeFile,
} from "./session-workspace-commands";

vi.mock("../../shared/commands/command-client", () => ({
  invokeCommand: vi.fn(async (command: string) => ({ command })),
}));

describe("session workspace commands", () => {
  it("invokes workspace commands with input envelope", async () => {
    await expect(
      getProjectWorktreeChanges({ projectId: 1, sessionId: 2 }),
    ).resolves.toEqual({ command: "get_project_worktree_changes" });
    await expect(
      getProjectWorktreeFileTree({ projectId: 1, sessionId: 2 }),
    ).resolves.toEqual({ command: "get_project_worktree_file_tree" });
    await expect(
      readProjectWorktreeFile({
        projectId: 1,
        sessionId: 2,
        filePath: "src/main.ts",
      }),
    ).resolves.toEqual({ command: "read_project_worktree_file" });
    await expect(
      readProjectWorktreeDiff({
        projectId: 1,
        sessionId: 2,
        filePath: "src/main.ts",
      }),
    ).resolves.toEqual({ command: "read_project_worktree_diff" });
  });
});
```

- [ ] **Step 3: Run wrapper test and verify RED**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm vitest run src/features/agents/session-workspace-commands.test.ts
```

Expected: FAIL because `session-workspace-commands.ts` does not exist.

- [ ] **Step 4: Implement wrapper module**

Create `src/features/agents/session-workspace-commands.ts`:

```ts
import { invokeCommand } from "../../shared/commands/command-client";

export type WorkspaceChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "binary";

export interface ProjectWorkspaceInput {
  projectId: number;
  sessionId?: number | null;
}

export interface ProjectWorkspacePathInput extends ProjectWorkspaceInput {
  filePath: string;
}

export interface WorkspaceChangedFile {
  filePath: string;
  oldPath?: string | null;
  fileName: string;
  kind: WorkspaceChangeKind;
  status: string;
  additions: number;
  deletions: number;
  isBinary: boolean;
  contentHash: string;
  metadataSignature: string;
}

export interface ProjectWorktreeChangesResponse {
  files: WorkspaceChangedFile[];
  signature: string;
}

export interface WorkspaceFileTreeNode {
  id: string;
  name: string;
  path: string;
  kind: "directory" | "file";
  children?: WorkspaceFileTreeNode[];
  sizeBytes?: number;
  modifiedAt?: number;
}

export interface ProjectWorktreeFileTreeResponse {
  nodes: WorkspaceFileTreeNode[];
  signature: string;
}

export interface WorkspaceFileContent {
  filePath: string;
  language?: string | null;
  content: string;
  modifiedAt?: number | null;
  sizeBytes: number;
  isBinary: boolean;
  isTooLarge: boolean;
}

export interface WorkspaceDiffContent {
  filePath: string;
  oldPath?: string | null;
  kind: WorkspaceChangeKind;
  language?: string | null;
  originalContent: string;
  modifiedContent: string;
  isBinary: boolean;
  isTooLarge: boolean;
}

export function getProjectWorktreeChanges(
  input: ProjectWorkspaceInput,
): Promise<ProjectWorktreeChangesResponse> {
  return invokeCommand<ProjectWorktreeChangesResponse>(
    "get_project_worktree_changes",
    { input },
  );
}

export function getProjectWorktreeFileTree(
  input: ProjectWorkspaceInput,
): Promise<ProjectWorktreeFileTreeResponse> {
  return invokeCommand<ProjectWorktreeFileTreeResponse>(
    "get_project_worktree_file_tree",
    { input },
  );
}

export function readProjectWorktreeFile(
  input: ProjectWorkspacePathInput,
): Promise<WorkspaceFileContent> {
  return invokeCommand<WorkspaceFileContent>("read_project_worktree_file", {
    input,
  });
}

export function readProjectWorktreeDiff(
  input: ProjectWorkspacePathInput,
): Promise<WorkspaceDiffContent> {
  return invokeCommand<WorkspaceDiffContent>("read_project_worktree_diff", {
    input,
  });
}
```

- [ ] **Step 5: Run wrapper test and verify GREEN**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm vitest run src/features/agents/session-workspace-commands.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add package.json pnpm-lock.yaml src/features/agents/session-workspace-commands.ts src/features/agents/session-workspace-commands.test.ts
git commit -m "feat: 添加 Session 工作区前端命令"
```

---

### Task 3: Session Workspace Cache and Polling

**Files:**
- Create: `src/features/agents/use-session-workspace-cache.ts`
- Modify: `src/features/agents/session-workspace-types.ts`
- Modify: `src/features/agents/agents-activity.tsx`
- Modify: `src/features/agents/agents-session-pane.tsx`
- Modify: `src/features/agents/session-side-panel.tsx`
- Modify: `src/features/agents/agents-activity.test.tsx`

**Interfaces:**
- Consumes wrappers from Task 2.
- Produces hook:
  - `useSessionWorkspaceCache({ projectId, sessionId, isSidePanelOpen, sidePanelTab })`
  - returns `changes`, `fileTree`, `openedFile`, `openedDiff`, `activeWorkspaceTab`, `fileTab`, `changeTab`, loading/error state, `setSidePanelTab`, `openFile`, `openChange`, `refreshChanges`, `closeWorkspaceTab`, `selectWorkspaceTab`.

- [ ] **Step 1: Add failing React tests for polling and session cache**

In `src/features/agents/agents-activity.test.tsx`, add mocks for `./session-workspace-commands`:

```ts
vi.mock("./session-workspace-commands", () => ({
  getProjectWorktreeChanges: vi.fn(),
  getProjectWorktreeFileTree: vi.fn(),
  readProjectWorktreeDiff: vi.fn(),
  readProjectWorktreeFile: vi.fn(),
}));
```

Import mocked functions and add tests:

```ts
it("refreshes uncommitted changes while the side panel is open", async () => {
  vi.useFakeTimers();
  getProjectWorktreeChangesMock
    .mockResolvedValueOnce({
      signature: "one",
      files: [changedFile("src/one.ts", "modified")],
    })
    .mockResolvedValueOnce({
      signature: "two",
      files: [
        changedFile("src/one.ts", "modified"),
        changedFile("src/two.ts", "added"),
      ],
    });
  getProjectWorktreeFileTreeMock.mockResolvedValue({ signature: "tree", nodes: [] });
  listAgentSessionsMock.mockResolvedValue({ sessions: [runningSession(301)] });

  render(<AgentsActivity projectId={1} activeSessionId={301} />);
  await userEvent.click(await screen.findByLabelText("打开 Session 侧边栏"));
  expect(await screen.findByRole("button", { name: /one.ts/ })).toBeInTheDocument();

  await act(async () => {
    vi.advanceTimersByTime(2_100);
  });

  expect(await screen.findByRole("button", { name: /two.ts/ })).toBeInTheDocument();
  vi.useRealTimers();
});

it("restores cached workspace tab when switching back to a session", async () => {
  getProjectWorktreeChangesMock.mockResolvedValue({
    signature: "changes",
    files: [changedFile("src/a.ts", "modified")],
  });
  readProjectWorktreeDiffMock.mockResolvedValue({
    filePath: "src/a.ts",
    oldPath: null,
    kind: "modified",
    language: "typescript",
    originalContent: "old",
    modifiedContent: "new",
    isBinary: false,
    isTooLarge: false,
  });
  listAgentSessionsMock.mockResolvedValue({
    sessions: [runningSession(301), runningSession(302, "Other issue")],
  });

  render(<AgentsActivity projectId={1} activeSessionId={301} />);
  await userEvent.click(await screen.findByLabelText("打开 Session 侧边栏"));
  await userEvent.click(await screen.findByRole("button", { name: /a.ts/ }));
  expect(await screen.findByRole("tab", { name: "a.ts" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /Other issue/ }));
  await userEvent.click(screen.getByRole("button", { name: /Existing issue/ }));

  expect(screen.getByRole("tab", { name: "a.ts" })).toBeInTheDocument();
});
```

Define local helpers if missing:

```ts
function changedFile(filePath: string, kind: WorkspaceChangeKind): WorkspaceChangedFile {
  return {
    filePath,
    oldPath: null,
    fileName: filePath.split("/").at(-1) ?? filePath,
    kind,
    status: kind === "untracked" ? "??" : " M",
    additions: 1,
    deletions: 0,
    isBinary: false,
    contentHash: `${filePath}:${kind}`,
    metadataSignature: `${filePath}:${kind}:meta`,
  };
}
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm vitest run src/features/agents/agents-activity.test.tsx
```

Expected: FAIL because workspace command mocks are unused and cache behavior does not exist.

- [ ] **Step 3: Implement workspace tab types**

Update `src/features/agents/session-workspace-types.ts`:

```ts
import type {
  WorkspaceChangedFile,
  WorkspaceDiffContent,
  WorkspaceFileContent,
} from "./session-workspace-commands";

export interface SessionWorkspaceFile {
  fileName: string;
  filePath: string;
}

export interface SessionWorkspaceFileTab extends SessionWorkspaceFile {
  content: WorkspaceFileContent | null;
  isLoading: boolean;
  errorMessage: string | null;
}

export interface SessionWorkspaceChangeTab extends SessionWorkspaceFile {
  change: WorkspaceChangedFile;
  diff: WorkspaceDiffContent | null;
  isLoading: boolean;
  errorMessage: string | null;
}

export type SessionWorkspaceTabKind = "session" | "file" | "changes";
export type SessionSidePanelTab = "changes" | "files";
```

- [ ] **Step 4: Implement cache hook**

Create `src/features/agents/use-session-workspace-cache.ts`. It must:

- Store `Map<number, SessionWorkspaceCache>` in a `useRef`.
- Preserve cache by `sessionId`.
- Poll changes every `2_000ms` when `isSidePanelOpen && sidePanelTab === "changes"`.
- Poll file tree every `5_000ms` when `isSidePanelOpen && sidePanelTab === "files"`.
- Compare response `signature` before replacing lists.
- Open files/diffs by reading command wrapper content and setting tab state.
- Return stable callbacks.

Minimum shape:

```ts
const CHANGES_POLL_INTERVAL_MS = 2_000;
const FILE_TREE_POLL_INTERVAL_MS = 5_000;
```

Use `toCommandError(error).message` for errors.

- [ ] **Step 5: Wire hook into AgentsActivity and child props**

In `agents-activity.tsx`:

- Remove imports and usage of `MockChangedFile`, `MockTreeNode`, and local `workspaceFileTab` / `workspaceChangeTab` state.
- Add `sidePanelTab` to state or use hook setter.
- Call `useSessionWorkspaceCache({ projectId, sessionId: currentSessionId, isSidePanelOpen: isSessionSidePanelOpen })`.
- On session selection, do not clear cached workspace for other sessions; only restore current session cache.
- Pass real `changes`, `fileTree`, loading/error, refresh, and `sidePanelTab` props into `SessionSidePanel`.
- Pass `fileTab`, `changeTab`, and tab callbacks from the hook into `AgentsSessionPane`.

In `agents-session-pane.tsx`, change prop types from `SessionWorkspaceFile` to `SessionWorkspaceFileTab` and `SessionWorkspaceChangeTab`.

In `session-side-panel.tsx`, lift active tab state out so `AgentsActivity`/hook can know when to poll tree:

```ts
interface SessionSidePanelProps {
  activeTab: SessionSidePanelTab;
  changes: WorkspaceChangedFile[];
  fileTree: WorkspaceFileTreeNode[];
  isChangesLoading: boolean;
  changesErrorMessage: string | null;
  onActiveTabChange: (tab: SessionSidePanelTab) => void;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
  onRefreshChanges: () => void;
}
```

- [ ] **Step 6: Run tests and verify GREEN**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm vitest run src/features/agents/agents-activity.test.tsx
```

Expected: PASS or only failures from components still expecting mock data, fixed in Task 4/5. Do not proceed until the cache-specific tests pass.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add src/features/agents/use-session-workspace-cache.ts src/features/agents/session-workspace-types.ts src/features/agents/agents-activity.tsx src/features/agents/agents-session-pane.tsx src/features/agents/session-side-panel.tsx src/features/agents/agents-activity.test.tsx
git commit -m "feat: 添加 Session 工作区缓存轮询"
```

---

### Task 4: Changes List and Monaco Diff Viewer

**Files:**
- Modify: `src/features/agents/session-changes-panel.tsx`
- Modify: `src/features/agents/session-workspace-tabs.tsx`
- Create: `src/features/agents/session-diff-viewer.tsx`
- Delete or leave unused then remove imports: `src/features/agents/session-diff-placeholder.tsx`
- Modify: `src/app/app.css`
- Modify: `src/features/agents/agents-activity.test.tsx`

**Interfaces:**
- Consumes `WorkspaceChangedFile` and `SessionWorkspaceChangeTab`.
- Produces accessible changed file rows and real read-only diff content.

- [ ] **Step 1: Mock Monaco and add failing diff tests**

In `agents-activity.test.tsx`, mock Monaco:

```ts
vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({ original, modified }: { original: string; modified: string }) =>
    createElement("div", {
      "data-testid": "monaco-diff",
      "data-original": original,
      "data-modified": modified,
    }),
  Editor: ({ value }: { value: string }) =>
    createElement("div", { "data-testid": "monaco-editor", "data-value": value }),
}));
```

Add tests:

```ts
it("opens a read-only diff for a changed file without placeholder text", async () => {
  getProjectWorktreeChangesMock.mockResolvedValue({
    signature: "changes",
    files: [changedFile("src/a.ts", "modified")],
  });
  readProjectWorktreeDiffMock.mockResolvedValue({
    filePath: "src/a.ts",
    oldPath: null,
    kind: "modified",
    language: "typescript",
    originalContent: "const value = 1;",
    modifiedContent: "const value = 2;",
    isBinary: false,
    isTooLarge: false,
  });
  listAgentSessionsMock.mockResolvedValue({ sessions: [runningSession(301)] });

  render(<AgentsActivity projectId={1} activeSessionId={301} />);
  await userEvent.click(await screen.findByLabelText("打开 Session 侧边栏"));
  await userEvent.click(await screen.findByRole("button", { name: /a.ts/ }));

  expect(await screen.findByTestId("monaco-diff")).toHaveAttribute(
    "data-original",
    "const value = 1;",
  );
  expect(screen.queryByText(/当前版本暂不实现 Diff 渲染/)).not.toBeInTheDocument();
});

it("shows a text delete label for deleted files", async () => {
  getProjectWorktreeChangesMock.mockResolvedValue({
    signature: "changes",
    files: [changedFile("src/removed.ts", "deleted")],
  });
  listAgentSessionsMock.mockResolvedValue({ sessions: [runningSession(301)] });

  render(<AgentsActivity projectId={1} activeSessionId={301} />);
  await userEvent.click(await screen.findByLabelText("打开 Session 侧边栏"));

  expect(await screen.findByText("删除")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm vitest run src/features/agents/agents-activity.test.tsx
```

Expected: FAIL because placeholder still renders and real labels are not wired.

- [ ] **Step 3: Update changes panel**

Change `SessionChangesPanel` props to consume real files:

```ts
interface SessionChangesPanelProps {
  files: WorkspaceChangedFile[];
  isLoading: boolean;
  errorMessage: string | null;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
  onRefresh: () => void;
}
```

Implement `formatChangeKindLabel(kind)`:

```ts
function formatChangeKindLabel(kind: WorkspaceChangeKind): string {
  switch (kind) {
    case "added":
    case "untracked":
      return "新增";
    case "deleted":
      return "删除";
    case "renamed":
      return "重命名";
    case "copied":
      return "复制";
    case "binary":
      return "二进制";
    default:
      return "修改";
  }
}
```

Render `+${file.additions}` and `-${file.deletions}`. Add a deleted modifier class when `kind === "deleted"`, but keep the text label.

- [ ] **Step 4: Implement Monaco diff viewer**

Create `session-diff-viewer.tsx`:

```tsx
import { DiffEditor } from "@monaco-editor/react";

import type { SessionWorkspaceChangeTab } from "./session-workspace-types";

interface SessionDiffViewerProps {
  tab: SessionWorkspaceChangeTab;
}

export function SessionDiffViewer({ tab }: SessionDiffViewerProps) {
  const statusLabel = formatDiffStatus(tab.change.kind);

  if (tab.isLoading) {
    return <p className="session-viewer-state">正在加载 diff...</p>;
  }

  if (tab.errorMessage) {
    return <p className="session-viewer-state" role="alert">{tab.errorMessage}</p>;
  }

  if (!tab.diff) {
    return <p className="session-viewer-state">请选择变更文件。</p>;
  }

  if (tab.diff.isBinary || tab.diff.isTooLarge) {
    return (
      <section className="session-viewer-state" aria-label="Diff unavailable">
        <h3>{tab.fileName}</h3>
        <p>{tab.diff.isBinary ? "二进制文件不可预览。" : "文件过大，暂不预览。"}</p>
      </section>
    );
  }

  return (
    <section className="session-diff-viewer" aria-label={`${tab.fileName} diff`}>
      <div className="session-diff-viewer__status">{statusLabel}</div>
      <DiffEditor
        height="100%"
        language={tab.diff.language ?? undefined}
        modified={tab.diff.modifiedContent}
        original={tab.diff.originalContent}
        options={{
          readOnly: true,
          renderSideBySide: tab.diff.kind !== "added" && tab.diff.kind !== "untracked",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
        }}
      />
    </section>
  );
}

function formatDiffStatus(kind: string): string {
  if (kind === "added" || kind === "untracked") return "新增";
  if (kind === "deleted") return "删除";
  if (kind === "renamed") return "重命名";
  if (kind === "copied") return "复制";
  if (kind === "binary") return "二进制";
  return "修改";
}
```

- [ ] **Step 5: Replace placeholder in workspace tabs**

In `session-workspace-tabs.tsx`, import `SessionDiffViewer` and render:

```tsx
{selectedTab === "changes" && changeTab ? (
  <SessionDiffViewer tab={changeTab} />
) : ...}
```

Remove `SessionDiffPlaceholder` import and delete the file after no imports remain.

- [ ] **Step 6: Add CSS**

In `src/app/app.css`, add/adjust:

```css
.session-change-row__label {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.2;
  padding: 1px 4px;
}

.session-change-row--deleted .session-change-row__name > span:first-child {
  text-decoration: line-through;
}

.session-diff-viewer,
.session-file-viewer {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
}

.session-diff-viewer__status,
.session-file-viewer__status {
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: 12px;
  padding: 6px 10px;
}

.session-viewer-state {
  color: var(--color-text-muted);
  font-size: 13px;
  margin: 0;
  padding: 12px;
}
```

- [ ] **Step 7: Run tests and verify GREEN**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm vitest run src/features/agents/agents-activity.test.tsx
```

Expected: PASS for diff-related tests.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
git add src/features/agents/session-changes-panel.tsx src/features/agents/session-workspace-tabs.tsx src/features/agents/session-diff-viewer.tsx src/features/agents/session-diff-placeholder.tsx src/app/app.css src/features/agents/agents-activity.test.tsx
git commit -m "feat: 展示真实 Session 变更 diff"
```

If `session-diff-placeholder.tsx` is deleted, use `git add -A src/features/agents/session-diff-placeholder.tsx`.

---

### Task 5: Repository File Tree and Monaco File Viewer

**Files:**
- Modify: `src/features/agents/session-file-tree-panel.tsx`
- Modify: `src/features/agents/session-workspace-tabs.tsx`
- Create: `src/features/agents/session-file-viewer.tsx`
- Delete or leave unused then remove imports: `src/features/agents/session-file-preview-placeholder.tsx`
- Modify: `src/app/app.css`
- Modify: `src/features/agents/agents-activity.test.tsx`

**Interfaces:**
- Consumes `WorkspaceFileTreeNode` and `SessionWorkspaceFileTab`.
- Produces real read-only tree and file viewer.

- [ ] **Step 1: Add failing file tree tests**

Add tests:

```ts
it("opens a read-only file viewer when clicking a file tree file", async () => {
  getProjectWorktreeChangesMock.mockResolvedValue({ signature: "changes", files: [] });
  getProjectWorktreeFileTreeMock.mockResolvedValue({
    signature: "tree",
    nodes: [
      {
        id: "src",
        name: "src",
        path: "src",
        kind: "directory",
        children: [
          { id: "src/file.ts", name: "file.ts", path: "src/file.ts", kind: "file" },
        ],
      },
    ],
  });
  readProjectWorktreeFileMock.mockResolvedValue({
    filePath: "src/file.ts",
    language: "typescript",
    content: "export const value = 1;",
    modifiedAt: 1,
    sizeBytes: 23,
    isBinary: false,
    isTooLarge: false,
  });
  listAgentSessionsMock.mockResolvedValue({ sessions: [runningSession(301)] });

  render(<AgentsActivity projectId={1} activeSessionId={301} />);
  await userEvent.click(await screen.findByLabelText("打开 Session 侧边栏"));
  await userEvent.click(screen.getByRole("tab", { name: "文件" }));
  await userEvent.click(await screen.findByRole("button", { name: /file.ts/ }));

  expect(await screen.findByTestId("monaco-editor")).toHaveAttribute(
    "data-value",
    "export const value = 1;",
  );
});

it("does not open a file tab when clicking a directory", async () => {
  getProjectWorktreeFileTreeMock.mockResolvedValue({
    signature: "tree",
    nodes: [{ id: "src", name: "src", path: "src", kind: "directory", children: [] }],
  });
  listAgentSessionsMock.mockResolvedValue({ sessions: [runningSession(301)] });

  render(<AgentsActivity projectId={1} activeSessionId={301} />);
  await userEvent.click(await screen.findByLabelText("打开 Session 侧边栏"));
  await userEvent.click(screen.getByRole("tab", { name: "文件" }));
  await userEvent.click(await screen.findByRole("button", { name: /src/ }));

  expect(screen.queryByRole("tab", { name: "src" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm vitest run src/features/agents/agents-activity.test.tsx
```

Expected: FAIL because mock tree/placeholder remains.

- [ ] **Step 3: Implement react-arborist tree**

Update `session-file-tree-panel.tsx`:

- Import `Tree, type NodeApi, type NodeRendererProps` from `react-arborist`.
- Props:

```ts
interface SessionFileTreePanelProps {
  nodes: WorkspaceFileTreeNode[];
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
}
```

- Render `Tree` with `data={nodes}`, `idAccessor="id"`, `childrenAccessor="children"`, `disableDrag`, `disableDrop`, `disableEdit`.
- In row renderer, if `node.data.kind === "directory"`, click toggles `node.toggle()` and does not call `onOpenFile`.
- If file, click calls `onOpenFile(node.data)`.

- [ ] **Step 4: Implement Monaco file viewer**

Create `session-file-viewer.tsx`:

```tsx
import { Editor } from "@monaco-editor/react";

import type { SessionWorkspaceFileTab } from "./session-workspace-types";

interface SessionFileViewerProps {
  tab: SessionWorkspaceFileTab;
}

export function SessionFileViewer({ tab }: SessionFileViewerProps) {
  if (tab.isLoading) {
    return <p className="session-viewer-state">正在加载文件...</p>;
  }

  if (tab.errorMessage) {
    return <p className="session-viewer-state" role="alert">{tab.errorMessage}</p>;
  }

  if (!tab.content) {
    return <p className="session-viewer-state">请选择文件。</p>;
  }

  if (tab.content.isBinary || tab.content.isTooLarge) {
    return (
      <section className="session-viewer-state" aria-label="File unavailable">
        <h3>{tab.fileName}</h3>
        <p>{tab.content.isBinary ? "二进制文件不可预览。" : "文件过大，暂不预览。"}</p>
      </section>
    );
  }

  return (
    <section className="session-file-viewer" aria-label={`${tab.fileName} file`}>
      <div className="session-file-viewer__status">{tab.filePath}</div>
      <Editor
        height="100%"
        language={tab.content.language ?? undefined}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
        }}
        value={tab.content.content}
      />
    </section>
  );
}
```

- [ ] **Step 5: Replace placeholder in workspace tabs**

In `session-workspace-tabs.tsx`, import `SessionFileViewer` and render:

```tsx
{selectedTab === "file" && fileTab ? (
  <SessionFileViewer tab={fileTab} />
) : ...}
```

Remove `SessionFilePreviewPlaceholder` import and delete the placeholder file after no imports remain.

- [ ] **Step 6: Remove mock file data**

Remove `src/features/agents/session-mock-files.ts` if no imports remain:

```bash
rg "session-mock-files|MOCK_CHANGED_FILES|MOCK_FILE_TREE|MockChangedFile|MockTreeNode" src
```

Expected: no production imports. Delete the file if unused.

- [ ] **Step 7: Run tests and verify GREEN**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm vitest run src/features/agents/agents-activity.test.tsx
```

Expected: PASS for file tree tests.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add -A src/features/agents/session-file-tree-panel.tsx src/features/agents/session-workspace-tabs.tsx src/features/agents/session-file-viewer.tsx src/features/agents/session-file-preview-placeholder.tsx src/features/agents/session-mock-files.ts src/app/app.css src/features/agents/agents-activity.test.tsx
git commit -m "feat: 展示真实 Session 文件树"
```

---

### Task 6: Final Integration, Validation, and OpenSpec Backfill

**Files:**
- Modify: `openspec/changes/session-workspace-live-inspector/tasks.md`
- Modify: `openspec/changes/session-workspace-live-inspector/.onespec.yaml`
- Modify as needed from prior tasks only to fix validation issues.

**Interfaces:**
- Consumes all previous tasks.
- Produces completed OpenSpec task checklist and verified change.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm vitest run src/features/agents/session-workspace-commands.test.ts src/features/agents/agents-activity.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run format**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm format
```

Expected: completes successfully. Review changed files and make sure only current change files were formatted.

- [ ] **Step 3: Run lint**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm lint
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Run full frontend tests**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"
pnpm test
```

Expected: PASS.

- [ ] **Step 6: Run Rust tests**

Run:

```bash
cd src-tauri && cargo test
```

Expected: PASS.

- [ ] **Step 7: Run OpenSpec validation**

Run:

```bash
openspec validate session-workspace-live-inspector --strict
```

Expected: PASS.

- [ ] **Step 8: Backfill tasks.md**

Update `openspec/changes/session-workspace-live-inspector/tasks.md` and mark all completed task checkboxes `[x]`. Do not mark any item complete if its implementation or verification did not pass.

- [ ] **Step 9: Track touched files in OneSpec**

Run:

```bash
ONESPEC_ENV="${ONESPEC_ENV:-$(find . "$HOME"/.codex "$HOME"/.claude "$HOME"/.cursor "$HOME"/.gemini "$HOME"/.copilot "$HOME"/.agents "$HOME"/.config -path '*/onespec/scripts/onespec-env.sh' -type f -print -quit 2>/dev/null)}"
. "$ONESPEC_ENV"
"$ONESPEC_BASH" "$ONESPEC_COMMIT" track session-workspace-live-inspector \
  package.json pnpm-lock.yaml \
  src-tauri/src/types/session_workspace.rs \
  src-tauri/src/core/session_workspace_service.rs \
  src-tauri/src/commands/session_workspace_commands.rs \
  src-tauri/src/types/mod.rs src-tauri/src/core/mod.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/src/types/errors.rs \
  src/features/agents/session-workspace-commands.ts src/features/agents/session-workspace-commands.test.ts \
  src/features/agents/use-session-workspace-cache.ts src/features/agents/session-workspace-types.ts \
  src/features/agents/agents-activity.tsx src/features/agents/agents-session-pane.tsx \
  src/features/agents/session-side-panel.tsx src/features/agents/session-changes-panel.tsx src/features/agents/session-file-tree-panel.tsx \
  src/features/agents/session-workspace-tabs.tsx src/features/agents/session-diff-viewer.tsx src/features/agents/session-file-viewer.tsx \
  src/features/agents/agents-activity.test.tsx src/app/app.css \
  openspec/changes/session-workspace-live-inspector/tasks.md docs/superpowers/plans/2026-06-21-session-workspace-live-inspector.md
```

- [ ] **Step 10: Commit final backfill if needed**

Run:

```bash
git add openspec/changes/session-workspace-live-inspector/tasks.md openspec/changes/session-workspace-live-inspector/.onespec.yaml docs/superpowers/plans/2026-06-21-session-workspace-live-inspector.md
git commit -m "docs: 回填 Session 工作区实现状态"
```

If prior task commits already included the plan and only `.onespec.yaml` changed, commit only `.onespec.yaml`.

---

## Self-Review

**Spec coverage:** Task 1 covers Rust commands, workspace root, Git diff data, safe paths, file tree scanning, and content/diff reads. Task 2 covers dependencies and TypeScript wrappers. Task 3 covers per-session cache, polling, refresh, and Session switching. Task 4 covers real changes list and diff viewer. Task 5 covers real file tree and read-only file viewer. Task 6 covers validation and OpenSpec backfill.

**Placeholder scan:** The plan does not intentionally leave implementation placeholders. Command adapters use a closure helper so repository borrows stay within the opened database lifetime.

**Type consistency:** Rust DTO names map to TypeScript camelCase DTO names. `SessionWorkspaceFileTab` and `SessionWorkspaceChangeTab` are the tab types consumed by viewer components and produced by the cache hook.
