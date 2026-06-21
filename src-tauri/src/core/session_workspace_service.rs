use std::cmp::Ordering;
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
    WorkspaceDiffContent, WorkspaceFileContent, WorkspaceFileTreeNode, WorkspaceFileTreeNodeKind,
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
    let canonical_root = root.canonicalize().map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "仓库路径不可访问。",
        )
        .with_detail(
            ErrorDetail::new("WorkspaceRoot")
                .with_value("path", root.to_string_lossy().to_string()),
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;
    let relative_path = Path::new(file_path);
    if file_path.is_empty()
        || relative_path.is_absolute()
        || relative_path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::Prefix(_) | Component::RootDir
            )
        })
    {
        return Err(workspace_validation_error(
            "路径必须是仓库内相对路径。",
            file_path,
        ));
    }

    let joined_path = root.join(relative_path);
    let parent = joined_path.parent().unwrap_or(root);
    let canonical_parent = parent.canonicalize().map_err(|error| {
        workspace_validation_error(&format!("文件路径不可访问：{error}"), file_path)
    })?;

    if !canonical_parent.starts_with(&canonical_root) {
        return Err(workspace_validation_error(
            "文件路径不能离开仓库目录。",
            file_path,
        ));
    }

    if joined_path.exists() {
        let canonical_path = joined_path.canonicalize().map_err(|error| {
            workspace_validation_error(&format!("文件路径不可访问：{error}"), file_path)
        })?;
        if !canonical_path.starts_with(&canonical_root) {
            return Err(workspace_validation_error(
                "文件路径不能离开仓库目录。",
                file_path,
            ));
        }
    }

    Ok(joined_path)
}

fn canonical_workspace_root(path: &str) -> Result<PathBuf, CommandError> {
    let root = Path::new(path).canonicalize().map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "仓库路径不可访问。",
        )
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

    if let Ok(workspace_file) = resolve_workspace_file(root, path) {
        if workspace_file.metadata.len() > MAX_TEXT_FILE_BYTES {
            return (0, 0, false);
        }
        if let Ok(bytes) = fs::read(&workspace_file.absolute_path) {
            if is_binary_bytes(&bytes) {
                return (0, 0, true);
            }
            let additions = std::str::from_utf8(&bytes)
                .map(|content| content.lines().count() as i64)
                .unwrap_or(0);
            return (additions, 0, false);
        }
    }

    (0, 0, false)
}

fn read_workspace_file_tree(root: &Path) -> Result<ProjectWorktreeFileTreeResponse, CommandError> {
    let mut nodes = read_directory_nodes(root, root)?;
    nodes.sort_by(compare_tree_nodes);
    let signature = hash_string(&format!("{nodes:?}"));

    Ok(ProjectWorktreeFileTreeResponse { nodes, signature })
}

fn read_directory_nodes(
    root: &Path,
    dir: &Path,
) -> Result<Vec<WorkspaceFileTreeNode>, CommandError> {
    let mut nodes = Vec::new();
    let entries = fs::read_dir(dir).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "文件树读取失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    for entry in entries {
        let entry = entry.map_err(workspace_io_error)?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = entry.file_type().map_err(workspace_io_error)?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() && IGNORED_DIRS.contains(&name.as_str()) {
            continue;
        }

        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let metadata = entry.metadata().map_err(workspace_io_error)?;

        if file_type.is_dir() {
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
        } else if file_type.is_file() {
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
    let workspace_file = resolve_workspace_file(root, file_path)?;
    let size_bytes = workspace_file.metadata.len();
    let language = language_from_path(file_path);
    if size_bytes > MAX_TEXT_FILE_BYTES {
        return Ok(WorkspaceFileContent {
            file_path: file_path.to_string(),
            language,
            content: String::new(),
            modified_at: modified_at_millis(&workspace_file.metadata),
            size_bytes,
            is_binary: false,
            is_too_large: true,
        });
    }

    let bytes = fs::read(&workspace_file.absolute_path).map_err(workspace_io_error)?;
    if is_binary_bytes(&bytes) {
        return Ok(WorkspaceFileContent {
            file_path: file_path.to_string(),
            language,
            content: String::new(),
            modified_at: modified_at_millis(&workspace_file.metadata),
            size_bytes,
            is_binary: true,
            is_too_large: false,
        });
    }

    Ok(WorkspaceFileContent {
        file_path: file_path.to_string(),
        language,
        content: String::from_utf8_lossy(&bytes).to_string(),
        modified_at: modified_at_millis(&workspace_file.metadata),
        size_bytes,
        is_binary: false,
        is_too_large: false,
    })
}

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
            match read_head_file(root, original_path)? {
                HeadFileRead::Content(content) => content,
                HeadFileRead::Binary => {
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
                HeadFileRead::TooLarge => {
                    return Ok(WorkspaceDiffContent {
                        file_path: change.file_path,
                        old_path: change.old_path,
                        kind: change.kind,
                        language: language_from_path(file_path),
                        original_content: String::new(),
                        modified_content: String::new(),
                        is_binary: false,
                        is_too_large: true,
                    });
                }
            }
        }
    };

    let modified_content = match change.kind {
        WorkspaceChangeKind::Deleted => String::new(),
        _ => {
            let content = read_workspace_file(root, &change.file_path)?;
            if content.is_binary || content.is_too_large {
                return Ok(WorkspaceDiffContent {
                    file_path: change.file_path,
                    old_path: change.old_path,
                    kind: change.kind,
                    language: language_from_path(file_path),
                    original_content: String::new(),
                    modified_content: String::new(),
                    is_binary: content.is_binary,
                    is_too_large: content.is_too_large,
                });
            }
            content.content
        }
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

struct WorkspaceFile {
    absolute_path: PathBuf,
    metadata: fs::Metadata,
}

fn resolve_workspace_file(root: &Path, file_path: &str) -> Result<WorkspaceFile, CommandError> {
    let absolute_path = resolve_workspace_relative_path(root, file_path)?;
    let metadata = fs::symlink_metadata(&absolute_path).map_err(workspace_io_error)?;
    if metadata.file_type().is_symlink() {
        return Err(workspace_validation_error(
            "路径不能是符号链接。",
            file_path,
        ));
    }
    if !metadata.is_file() {
        return Err(workspace_validation_error("路径不是文件。", file_path));
    }

    Ok(WorkspaceFile {
        absolute_path,
        metadata,
    })
}

enum HeadFileRead {
    Content(String),
    Binary,
    TooLarge,
}

fn read_head_file(root: &Path, path: &str) -> Result<HeadFileRead, CommandError> {
    let object_spec = format!("HEAD:{path}");
    let size_output = match run_git(root, &["cat-file", "-s", &object_spec]) {
        Ok(output) => output,
        Err(_) => return Ok(HeadFileRead::Content(String::new())),
    };
    let size = size_output.trim().parse::<u64>().map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "Git blob 大小无法解析。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;
    if size > MAX_TEXT_FILE_BYTES {
        return Ok(HeadFileRead::TooLarge);
    }

    let bytes = run_git_bytes(root, &["show", &object_spec])?;
    if is_binary_bytes(&bytes) {
        return Ok(HeadFileRead::Binary);
    }

    String::from_utf8(bytes)
        .map(HeadFileRead::Content)
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Git 输出不是 UTF-8。",
            )
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })
}

fn is_binary_bytes(bytes: &[u8]) -> bool {
    bytes.contains(&0) || std::str::from_utf8(bytes).is_err()
}

fn run_git(root: &Path, args: &[&str]) -> Result<String, CommandError> {
    let output = run_git_bytes(root, args)?;
    String::from_utf8(output).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "Git 输出不是 UTF-8。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })
}

fn run_git_bytes(root: &Path, args: &[&str]) -> Result<Vec<u8>, CommandError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|error| {
            CommandError::new(
                CommandErrorCode::AgentSessionValidationFailed,
                "Git 命令执行失败。",
            )
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;
    if !output.status.success() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "Git 命令执行失败。",
        )
        .with_detail(ErrorDetail::new("Cause").with_value(
            "message",
            String::from_utf8_lossy(&output.stderr).to_string(),
        )));
    }
    Ok(output.stdout)
}

fn workspace_persistence_error(error: rusqlite::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::AgentSessionPersistenceFailed,
        "工作区查询失败。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

fn workspace_io_error(error: std::io::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::AgentSessionValidationFailed,
        "工作区文件读取失败。",
    )
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

fn workspace_validation_error(message: &str, file_path: &str) -> CommandError {
    CommandError::new(CommandErrorCode::AgentSessionValidationFailed, message).with_detail(
        ErrorDetail::new("WorkspacePath").with_value("filePath", file_path.to_string()),
    )
}

fn file_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn file_metadata_signature(root: &Path, path: &str) -> String {
    resolve_workspace_file(root, path)
        .map(|metadata| {
            format!(
                "{}:{}",
                metadata.metadata.len(),
                modified_at_millis(&metadata.metadata).unwrap_or_default()
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

fn compare_tree_nodes(left: &WorkspaceFileTreeNode, right: &WorkspaceFileTreeNode) -> Ordering {
    match (&left.kind, &right.kind) {
        (WorkspaceFileTreeNodeKind::Directory, WorkspaceFileTreeNodeKind::File) => Ordering::Less,
        (WorkspaceFileTreeNodeKind::File, WorkspaceFileTreeNodeKind::Directory) => {
            Ordering::Greater
        }
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

    #[cfg(unix)]
    #[test]
    fn safe_relative_path_rejects_symlink_escape() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path().join("workspace");
        let outside = temp_dir.path().join("outside");
        fs::create_dir_all(&root).expect("create root");
        fs::create_dir_all(&outside).expect("create outside");
        fs::write(outside.join("secret.txt"), "secret").expect("write outside");
        std::os::unix::fs::symlink(&outside, root.join("linked")).expect("symlink");

        let result = resolve_workspace_relative_path(&root, "linked/secret.txt");

        assert!(result.is_err());
    }

    #[cfg(unix)]
    #[test]
    fn changes_do_not_read_untracked_symlink_target_outside_workspace() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path().join("workspace");
        let outside = temp_dir.path().join("outside.txt");
        fs::create_dir_all(&root).expect("create root");
        init_git_repo(&root);
        fs::write(&outside, "one\ntwo\nthree\n").expect("write outside");
        std::os::unix::fs::symlink(&outside, root.join("linked.txt")).expect("symlink");

        let changes = read_workspace_changes(&root).expect("read changes");
        let linked = changes
            .files
            .iter()
            .find(|file| file.file_path == "linked.txt")
            .expect("linked change");

        assert_eq!(linked.additions, 0);
        assert_eq!(linked.deletions, 0);
        assert_ne!(
            linked.metadata_signature,
            file_metadata_signature_for_test(&outside)
        );
    }

    #[test]
    fn changes_mark_untracked_nul_file_as_binary() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        init_git_repo(root);
        fs::write(root.join("payload.bin"), b"hello\0world\n").expect("write binary");

        let changes = read_workspace_changes(root).expect("read changes");
        let binary = changes
            .files
            .iter()
            .find(|file| file.file_path == "payload.bin")
            .expect("binary change");

        assert!(binary.is_binary);
        assert_eq!(binary.additions, 0);
        assert_eq!(binary.deletions, 0);
    }

    #[test]
    fn diff_marks_large_head_content_too_large_without_returning_original() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        init_git_repo(root);
        let large_content = "a".repeat((MAX_TEXT_FILE_BYTES + 1) as usize);
        fs::write(root.join("large.txt"), large_content).expect("write large");
        git(root, &["add", "large.txt"]);
        git(root, &["commit", "-m", "add large"]);
        fs::write(root.join("large.txt"), "small\n").expect("write small");

        let diff = read_workspace_diff(root, "large.txt").expect("read diff");

        assert!(diff.is_too_large);
        assert!(!diff.is_binary);
        assert!(diff.original_content.is_empty());
        assert!(diff.modified_content.is_empty());
    }

    fn init_git_repo(root: &Path) {
        git(root, &["init"]);
        git(root, &["config", "user.email", "test@example.com"]);
        git(root, &["config", "user.name", "Test User"]);
    }

    fn git(root: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn file_metadata_signature_for_test(path: &Path) -> String {
        fs::metadata(path)
            .map(|metadata| {
                format!(
                    "{}:{}",
                    metadata.len(),
                    modified_at_millis(&metadata).unwrap_or_default()
                )
            })
            .unwrap_or_else(|_| "missing".to_string())
    }
}
