use std::cmp::Ordering;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;

use crate::db::agent_session_repository::AgentSessionRepository;
use crate::db::project_repository::ProjectRepository;
use crate::git::worktree::{is_additional_worktree, list_code_workspaces};
use crate::types::errors::{CommandError, CommandErrorCode, ErrorDetail};
use crate::types::session_workspace::{
    CodeWorkspaceRootsResponse, ProjectWorkspaceInput, ProjectWorkspacePathInput,
    ProjectWorktreeChangesResponse, ProjectWorktreeCommitHistoryResponse,
    ProjectWorktreeFileTreeResponse, WorkspaceChangeKind, WorkspaceChangedFile,
    WorkspaceCommitChangedFile, WorkspaceCommitRecord, WorkspaceDiffContent, WorkspaceFileContent,
    WorkspaceFileTreeNode, WorkspaceFileTreeNodeKind,
};

const MAX_TEXT_FILE_BYTES: u64 = 1_000_000;
const HIDDEN_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".vite",
];
const PRIMARY_BRANCHES: &[&str] = &["main", "master"];
const MAX_COMMIT_HISTORY_ENTRIES: usize = 50;
const BASE_BRANCH_CANDIDATES: &[&str] = &[
    "origin/devlop",
    "devlop",
    "origin/develop",
    "develop",
    "origin/main",
    "main",
    "origin/master",
    "master",
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
        let root = self.resolve_workspace_root(
            input.project_id,
            input.session_id,
            input.workspace_path.as_deref(),
        )?;
        read_workspace_changes(&root)
    }

    pub fn get_file_tree(
        &self,
        input: ProjectWorkspaceInput,
    ) -> Result<ProjectWorktreeFileTreeResponse, CommandError> {
        let root = self.resolve_workspace_root(
            input.project_id,
            input.session_id,
            input.workspace_path.as_deref(),
        )?;
        read_workspace_file_tree(&root)
    }

    pub fn get_commit_history(
        &self,
        input: ProjectWorkspaceInput,
    ) -> Result<ProjectWorktreeCommitHistoryResponse, CommandError> {
        let root = self.resolve_workspace_root(
            input.project_id,
            input.session_id,
            input.workspace_path.as_deref(),
        )?;
        let base_branch = self.resolve_session_base_branch(input.project_id, input.session_id);
        read_workspace_commit_history(&root, base_branch.as_deref())
    }

    // 读取 session 创建 worktree 时记录的 target_branch，作为 commit history 的精确
    // 分叉基，避免 find_branch_base 落到固定候选列表里更旧的分支。session 不存在、不
    // 属于本 project、未记录 target_branch，或读取失败时返回 None，交由调用方回退到
    // 启发式。
    fn resolve_session_base_branch(
        &self,
        project_id: i64,
        session_id: Option<i64>,
    ) -> Option<String> {
        let session_id = session_id?;
        let session = self
            .agent_session_repository
            .find_by_id(session_id)
            .ok()
            .flatten()?;
        if session.project_id != project_id {
            return None;
        }
        session
            .target_branch
            .map(|branch| branch.trim().to_string())
            .filter(|branch| !branch.is_empty())
    }

    pub fn read_file(
        &self,
        input: ProjectWorkspacePathInput,
    ) -> Result<WorkspaceFileContent, CommandError> {
        let root = self.resolve_workspace_root(
            input.project_id,
            input.session_id,
            input.workspace_path.as_deref(),
        )?;
        read_workspace_file(&root, &input.file_path)
    }

    pub fn list_code_workspace_roots(
        &self,
        project_id: i64,
    ) -> Result<CodeWorkspaceRootsResponse, CommandError> {
        let root = self.resolve_workspace_root(project_id, None, None)?;
        list_code_workspace_roots(&root)
    }

    pub fn read_diff(
        &self,
        input: ProjectWorkspacePathInput,
    ) -> Result<WorkspaceDiffContent, CommandError> {
        let root = self.resolve_workspace_root(
            input.project_id,
            input.session_id,
            input.workspace_path.as_deref(),
        )?;
        if let Some(commit_hash) = input.commit_hash {
            read_workspace_commit_diff(&root, &commit_hash, &input.file_path)
        } else {
            read_workspace_diff(&root, &input.file_path)
        }
    }

    fn resolve_workspace_root(
        &self,
        project_id: i64,
        session_id: Option<i64>,
        workspace_path: Option<&str>,
    ) -> Result<PathBuf, CommandError> {
        let project = self
            .project_repository
            .find_by_id(project_id)
            .map_err(workspace_persistence_error)?
            .ok_or_else(|| {
                CommandError::new(CommandErrorCode::ProjectNotFound, "Project 不存在。")
                    .with_detail(ErrorDetail::new("Project").with_value("projectId", project_id))
            })?;

        if let Some(workspace_path) = workspace_path {
            let roots = list_code_workspace_roots(Path::new(&project.repo_path))?.roots;
            if roots.iter().any(|root| root.path == workspace_path) {
                return canonical_workspace_root(workspace_path);
            }
            return Err(
                workspace_validation_error("代码工作区不存在。", workspace_path)
                    .with_reason("codeWorkspaceNotFound"),
            );
        }
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
        .with_reason("repoPathInaccessible")
        .with_detail(
            ErrorDetail::new("WorkspaceRoot")
                .with_value("path", root.to_string_lossy().to_string()),
        )
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;
    let relative_path = validate_workspace_relative_path(file_path)?;

    let joined_path = root.join(relative_path);
    let parent = joined_path.parent().unwrap_or(root);
    let canonical_parent = parent.canonicalize().map_err(|error| {
        workspace_validation_error(&format!("文件路径不可访问：{error}"), file_path)
            .with_reason("filePathInaccessible")
    })?;

    if !canonical_parent.starts_with(&canonical_root) {
        return Err(
            workspace_validation_error("文件路径不能离开仓库目录。", file_path)
                .with_reason("filePathOutsideRepo"),
        );
    }

    if joined_path.exists() {
        let canonical_path = joined_path.canonicalize().map_err(|error| {
            workspace_validation_error(&format!("文件路径不可访问：{error}"), file_path)
                .with_reason("filePathInaccessible")
        })?;
        if !canonical_path.starts_with(&canonical_root) {
            return Err(
                workspace_validation_error("文件路径不能离开仓库目录。", file_path)
                    .with_reason("filePathOutsideRepo"),
            );
        }
    }

    Ok(joined_path)
}

fn validate_workspace_relative_path(file_path: &str) -> Result<&Path, CommandError> {
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
        return Err(
            workspace_validation_error("路径必须是仓库内相对路径。", file_path)
                .with_reason("pathMustBeRelative"),
        );
    }

    Ok(relative_path)
}

fn canonical_workspace_root(path: &str) -> Result<PathBuf, CommandError> {
    let root = Path::new(path).canonicalize().map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "仓库路径不可访问。",
        )
        .with_reason("repoPathInaccessible")
        .with_detail(ErrorDetail::new("WorkspaceRoot").with_value("path", path.to_string()))
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;

    if !root.is_dir() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "仓库路径不是目录。",
        )
        .with_reason("repoPathNotDir")
        .with_detail(ErrorDetail::new("WorkspaceRoot").with_value("path", path.to_string())));
    }

    Ok(root)
}

fn read_workspace_changes(root: &Path) -> Result<ProjectWorktreeChangesResponse, CommandError> {
    // `--untracked-files=all` 让 git 递归展开未跟踪目录，逐个列出叶子文件，
    // 而不是把整个新增目录折叠成单条 `?? newdir/`。这样未提交变更面板才能
    // 展示新增目录下的全部文件（含多层级叶子文件），且点击单文件 diff 时
    // 能在变更列表中按 file_path 命中。
    let status_output = run_git_bytes(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
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

/// 单次 `git log --name-status` 解析出的一条提交：表头字段 + 该提交的变更文件。
struct CommitLogEntry {
    hash: String,
    short_hash: String,
    author_name: String,
    committed_at_seconds: i64,
    message: String,
    files: Vec<WorkspaceCommitChangedFile>,
}

fn read_workspace_commit_history(
    root: &Path,
    base_branch: Option<&str>,
) -> Result<ProjectWorktreeCommitHistoryResponse, CommandError> {
    let branch_name = current_branch_name(root)?;
    let is_worktree = is_additional_worktree(root).unwrap_or(false);

    // worktree 与非 worktree 都展示该分支最近 50 条全历史，不再用 base..HEAD 过滤。
    // worktree 场景下，落在分叉基 base..HEAD 范围内的提交属于“当前 worktree 创建”，
    // 通过 is_created_in_worktree 标记给前端做蓝/橘黄区分，其余为从 base 继承的历史。
    // 仅当 worktree 处于非主分支且能解出 base 时才计算该集合；主分支或 base 解析失败
    // 时全部视为 worktree 自身（保持主分支不过滤的现状，避免主分支历史被误判为他处
    // 提交）。base_branch 来自 session 记录的 target_branch（worktree 创建时的真实基
    // 分支），缺失时回退到 find_branch_base 的启发式。非 worktree 不计算该集合，
    // is_created_in_worktree 恒为 false。
    let worktree_own_commits: Option<HashSet<String>> = if is_worktree {
        match branch_name.as_deref() {
            Some(branch) if !PRIMARY_BRANCHES.contains(&branch) => {
                find_branch_base(root, branch, base_branch)?
                    .and_then(|base| rev_list_range(root, &format!("{base}..HEAD")).ok())
            }
            _ => None,
        }
    } else {
        None
    };

    let upstream = current_upstream(root)?;

    // 单次 git log --name-status 取最近 50 条提交与其变更文件，替代旧实现「每条提交
    // 一次 diff-tree」（50 条 ≈ 50 个子进程）。--root 让初始提交也按新增展示，与旧
    // diff-tree --root 行为一致；-M -C 保留重命名/复制检测。
    let log_output = run_git_owned(
        root,
        &[
            "log".to_string(),
            "--date-order".to_string(),
            format!("--max-count={MAX_COMMIT_HISTORY_ENTRIES}"),
            "--root".to_string(),
            "--name-status".to_string(),
            "-M".to_string(),
            "-C".to_string(),
            "--format=%H%x00%h%x00%an%x00%ct%x00%s".to_string(),
        ],
    )?;

    // pushed 判定批量化：单次 rev-list <upstream> 取其可达提交集合，成员判定替代旧
    // 「每条提交一次 merge-base --is-ancestor」（50 条 ≈ 50 个子进程）。无 upstream
    // 或 rev-list 失败 → 空集合，所有提交按未 push 处理，与旧 merge-base 失败等价。
    let pushed_set: HashSet<String> = match upstream.as_deref() {
        Some(upstream_ref) => run_git(root, &["rev-list", upstream_ref])
            .ok()
            .map(|output| {
                output
                    .lines()
                    .map(|line| line.trim().to_string())
                    .filter(|line| !line.is_empty())
                    .collect()
            })
            .unwrap_or_default(),
        None => HashSet::new(),
    };

    // 解析：含 NUL 的行是提交头（hash\0shorthash\0author\0ct\0message），其后到下一
    // 个头之间的非空行是该提交的 name-status 变更文件，累加到最近一条提交上。
    let mut entries: Vec<CommitLogEntry> = Vec::new();
    for line in log_output.lines() {
        if line.contains('\0') {
            let mut parts = line.split('\0');
            let hash = parts.next().unwrap_or_default().to_string();
            if hash.is_empty() {
                continue;
            }
            entries.push(CommitLogEntry {
                hash,
                short_hash: parts.next().unwrap_or_default().to_string(),
                author_name: parts.next().unwrap_or_default().to_string(),
                committed_at_seconds: parts.next().unwrap_or_default().parse::<i64>().unwrap_or(0),
                message: parts.next().unwrap_or_default().to_string(),
                files: Vec::new(),
            });
        } else if let Some(entry) = entries.last_mut() {
            if let Some(file) = parse_commit_changed_file(line) {
                entry.files.push(file);
            }
        }
    }

    let mut commits = Vec::new();
    for entry in entries {
        let is_pushed = pushed_set.contains(&entry.hash);
        // 有 own 集合时按成员判定；无集合时 worktree 场景（主分支 / base 解析失败）
        // 视为全部自身（true），非 worktree 恒为 false。
        let is_created_in_worktree = match &worktree_own_commits {
            Some(own) => own.contains(&entry.hash),
            None => is_worktree,
        };
        commits.push(WorkspaceCommitRecord {
            hash: entry.hash,
            short_hash: entry.short_hash,
            message: entry.message,
            author_name: entry.author_name,
            committed_at: entry.committed_at_seconds.saturating_mul(1_000),
            files: entry.files,
            pushed_to: if is_pushed { upstream.clone() } else { None },
            is_pushed,
            is_created_in_worktree,
        });
    }

    let signature = hash_string(&format!("{commits:?}"));
    Ok(ProjectWorktreeCommitHistoryResponse {
        commits,
        signature,
        is_worktree,
    })
}

fn current_branch_name(root: &Path) -> Result<Option<String>, CommandError> {
    let branch = run_git(root, &["branch", "--show-current"])?;
    let branch = branch.trim();
    if branch.is_empty() {
        Ok(None)
    } else {
        Ok(Some(branch.to_string()))
    }
}

// 取当前分支的 upstream 缩写名（如 `origin/dev`）。
//
// 没有 upstream（分支未设置跟踪、游离 HEAD 或仓库无远端）时 git 会以非零退出，
// 这属于合法状态而非错误：此时所有提交都按本地未 push 处理。因此把任意 git
// 失败都收敛为 None，不向上抛出，避免阻塞整个 commit history 读取。`--abbrev-ref`
// 让结果以 `origin/dev` 而非完整 ref 路径呈现，直接作为远端 tag 文案。
fn current_upstream(root: &Path) -> Result<Option<String>, CommandError> {
    let upstream = match run_git(root, &["rev-parse", "--abbrev-ref", "@{upstream}"]) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    let upstream = upstream.trim();
    if upstream.is_empty() || upstream == "@{upstream}" || upstream.starts_with("HEAD") {
        return Ok(None);
    }
    Ok(Some(upstream.to_string()))
}

// 列出某个 revision 范围（如 `base..HEAD`）内的全部 commit hash，用于标记 worktree
// 自身创建的提交。范围解析失败或无提交时返回空集合，不阻断整体读取。
fn rev_list_range(root: &Path, range: &str) -> Result<HashSet<String>, CommandError> {
    let output = run_git_owned(root, &["rev-list".to_string(), range.to_string()])?;
    Ok(output
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect())
}

// 计算当前 HEAD 相对某个 ref 的 merge-base。
//
// ref 不存在（`rev-parse --verify` 失败）或与 HEAD 没有共同历史（`merge-base` 失败）
// 时返回 None，不阻断调用方：base 解析是尽力而为，任一候选失败都应继续尝试下一个，
// 而不是让整条 commit history 读取失败。
fn merge_base_against(root: &Path, ref_name: &str) -> Result<Option<String>, CommandError> {
    if run_git(
        root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{ref_name}^{{commit}}"),
        ],
    )
    .is_err()
    {
        return Ok(None);
    }

    let Ok(base) = run_git(root, &["merge-base", "HEAD", ref_name]) else {
        return Ok(None);
    };
    let base = base.trim();
    if base.is_empty() {
        Ok(None)
    } else {
        Ok(Some(base.to_string()))
    }
}

fn find_branch_base(
    root: &Path,
    current_branch: &str,
    preferred_base: Option<&str>,
) -> Result<Option<String>, CommandError> {
    // 优先使用调用方指定的 base（worktree 创建时记录的 target_branch）。它是该 worktree
    // 分支真正的分叉点，避免落到固定候选列表里更旧的分支——例如仓库里存在落后于 main
    // 的 devlop 时，按候选顺序会先命中 devlop，导致 base 过旧、把 main 上继承下来的
    // 提交全部计入 worktree 自身历史。
    if let Some(preferred) = preferred_base {
        if preferred != current_branch {
            if let Some(base) = merge_base_against(root, preferred)? {
                return Ok(Some(base));
            }
        }
    }

    if let Ok(upstream) = run_git(root, &["rev-parse", "--abbrev-ref", "@{upstream}"]) {
        let upstream = upstream.trim();
        if !upstream.is_empty() {
            if let Some(base) = merge_base_against(root, upstream)? {
                return Ok(Some(base));
            }
        }
    }

    for candidate in BASE_BRANCH_CANDIDATES {
        if *candidate == current_branch {
            continue;
        }
        if let Some(base) = merge_base_against(root, candidate)? {
            return Ok(Some(base));
        }
    }

    Ok(None)
}

fn read_commit_changed_files(
    root: &Path,
    commit_hash: &str,
) -> Result<Vec<WorkspaceCommitChangedFile>, CommandError> {
    let output = run_git(
        root,
        &[
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--name-status",
            "-r",
            "-M",
            "-C",
            commit_hash,
        ],
    )?;
    let mut files = Vec::new();

    for line in output.lines().filter(|line| !line.is_empty()) {
        if let Some(file) = parse_commit_changed_file(line) {
            files.push(file);
        }
    }

    Ok(files)
}

fn parse_commit_changed_file(line: &str) -> Option<WorkspaceCommitChangedFile> {
    let mut parts = line.split('\t');
    let raw_status = parts.next()?;
    let status = raw_status.chars().next()?.to_string();
    let (old_path, file_path) = if matches!(status.as_str(), "R" | "C") {
        let old_path = parts.next()?.to_string();
        let file_path = parts.next()?.to_string();
        (Some(old_path), file_path)
    } else {
        (None, parts.next()?.to_string())
    };

    Some(WorkspaceCommitChangedFile {
        file_name: file_name_from_path(&file_path),
        file_path,
        old_path,
        kind: change_kind_from_commit_status(&status),
        status,
    })
}

fn change_kind_from_commit_status(status: &str) -> WorkspaceChangeKind {
    match status {
        "A" => WorkspaceChangeKind::Added,
        "D" => WorkspaceChangeKind::Deleted,
        "R" => WorkspaceChangeKind::Renamed,
        "C" => WorkspaceChangeKind::Copied,
        _ => WorkspaceChangeKind::Modified,
    }
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
            )
            .with_reason("gitStatusUnparseable"));
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

fn list_code_workspace_roots(root: &Path) -> Result<CodeWorkspaceRootsResponse, CommandError> {
    let roots = list_code_workspaces(root).map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "代码工作区读取失败。",
        )
        .with_reason("codeWorkspaceReadFailed")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })?;
    Ok(CodeWorkspaceRootsResponse { roots })
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
        .with_reason("fileTreeReadFailed")
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
        if file_type.is_dir() && HIDDEN_DIRS.contains(&name.as_str()) {
            continue;
        }

        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let metadata = entry.metadata().map_err(workspace_io_error)?;
        // 逐条启动 `git check-ignore` 会在大型仓库创建海量子进程并阻塞 command。
        let is_ignored = false;

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
                is_ignored,
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
                is_ignored,
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
        .ok_or_else(|| {
            workspace_validation_error("文件没有未提交变更。", file_path)
                .with_reason("fileNoUncommittedChanges")
        })?;

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

fn read_workspace_commit_diff(
    root: &Path,
    commit_hash: &str,
    file_path: &str,
) -> Result<WorkspaceDiffContent, CommandError> {
    let commit_hash = resolve_commit_hash(root, commit_hash)?;
    let change = read_commit_changed_files(root, &commit_hash)?
        .into_iter()
        .find(|file| file.file_path == file_path)
        .ok_or_else(|| {
            workspace_validation_error("文件不属于该提交。", file_path)
                .with_reason("fileNotInCommit")
        })?;
    validate_workspace_relative_path(&change.file_path)?;
    if let Some(old_path) = &change.old_path {
        validate_workspace_relative_path(old_path)?;
    }

    let parent_ref = format!("{commit_hash}^");
    let has_parent = run_git(
        root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{parent_ref}{{commit}}"),
        ],
    )
    .is_ok();

    let original_content = match change.kind {
        WorkspaceChangeKind::Added | WorkspaceChangeKind::Untracked => String::new(),
        _ if !has_parent => String::new(),
        _ => {
            let original_path = change.old_path.as_deref().unwrap_or(&change.file_path);
            match read_git_file(root, &parent_ref, original_path)? {
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
        _ => match read_git_file(root, &commit_hash, &change.file_path)? {
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
        },
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
        return Err(
            workspace_validation_error("路径不能是符号链接。", file_path)
                .with_reason("pathCannotBeSymlink"),
        );
    }
    if !metadata.is_file() {
        return Err(
            workspace_validation_error("路径不是文件。", file_path).with_reason("pathNotFile")
        );
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
    read_git_file(root, "HEAD", path)
}

fn read_git_file(root: &Path, treeish: &str, path: &str) -> Result<HeadFileRead, CommandError> {
    validate_workspace_relative_path(path)?;
    let object_spec = format!("{treeish}:{path}");
    let size_output = match run_git(root, &["cat-file", "-s", &object_spec]) {
        Ok(output) => output,
        Err(_) => return Ok(HeadFileRead::Content(String::new())),
    };
    let size = size_output.trim().parse::<u64>().map_err(|error| {
        CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "Git blob 大小无法解析。",
        )
        .with_reason("gitBlobSizeUnparseable")
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
            .with_reason("gitOutputNotUtf8")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })
}

fn resolve_commit_hash(root: &Path, commit_hash: &str) -> Result<String, CommandError> {
    let commit_hash = commit_hash.trim();
    if commit_hash.is_empty()
        || commit_hash.len() > 64
        || !commit_hash
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(
            workspace_validation_error("提交哈希格式无效。", commit_hash)
                .with_reason("commitHashInvalid"),
        );
    }

    let output = run_git(
        root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{commit_hash}^{{commit}}"),
        ],
    )?;
    let resolved_hash = output.trim();
    if resolved_hash.is_empty() {
        return Err(
            workspace_validation_error("提交不存在。", commit_hash).with_reason("commitNotFound")
        );
    }

    Ok(resolved_hash.to_string())
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
        .with_reason("gitOutputNotUtf8")
        .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
    })
}

fn run_git_owned(root: &Path, args: &[String]) -> Result<String, CommandError> {
    let args = args.iter().map(String::as_str).collect::<Vec<_>>();
    run_git(root, &args)
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
            .with_reason("gitCommandFailed")
            .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
        })?;
    if !output.status.success() {
        return Err(CommandError::new(
            CommandErrorCode::AgentSessionValidationFailed,
            "Git 命令执行失败。",
        )
        .with_reason("gitCommandFailed")
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
    .with_reason("workspaceQueryFailed")
    .with_detail(ErrorDetail::new("Cause").with_value("message", error.to_string()))
}

fn workspace_io_error(error: std::io::Error) -> CommandError {
    CommandError::new(
        CommandErrorCode::AgentSessionValidationFailed,
        "工作区文件读取失败。",
    )
    .with_reason("workspaceFileReadFailed")
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
        Some("go") => Some("go".to_string()),
        Some("html") => Some("html".to_string()),
        Some("java") => Some("java".to_string()),
        Some("js") | Some("mjs") | Some("cjs") => Some("javascript".to_string()),
        Some("json") => Some("json".to_string()),
        Some("kt") | Some("kts") => Some("kotlin".to_string()),
        Some("md") => Some("markdown".to_string()),
        Some("py") => Some("python".to_string()),
        Some("rs") => Some("rust".to_string()),
        Some("swift") => Some("swift".to_string()),
        Some("ts") => Some("typescript".to_string()),
        Some("tsx") => Some("typescript".to_string()),
        Some("vue") => Some("html".to_string()),
        Some("xml") => Some("xml".to_string()),
        Some("yaml") | Some("yml") => Some("yaml".to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn language_from_path_maps_supported_extensions() {
        // 常用编程语言：返回的 language id 与 Monaco / VS Code 内核一致，
        // 前端 Monaco Editor 据此启用语法高亮。
        assert_eq!(language_from_path("main.py"), Some("python".to_string()));
        assert_eq!(language_from_path("App.java"), Some("java".to_string()));
        assert_eq!(language_from_path("main.go"), Some("go".to_string()));
        assert_eq!(
            language_from_path("ContentView.swift"),
            Some("swift".to_string()),
        );
        assert_eq!(language_from_path("Lib.kt"), Some("kotlin".to_string()));
        assert_eq!(
            language_from_path("build.gradle.kts"),
            Some("kotlin".to_string()),
        );
        assert_eq!(language_from_path("pom.xml"), Some("xml".to_string()));

        // 已有映射回归
        assert_eq!(
            language_from_path("a.ts"),
            Some("typescript".to_string()),
        );
        assert_eq!(
            language_from_path("a.tsx"),
            Some("typescript".to_string()),
        );
        assert_eq!(
            language_from_path("a.js"),
            Some("javascript".to_string()),
        );
        assert_eq!(language_from_path("a.json"), Some("json".to_string()));
        assert_eq!(language_from_path("a.yaml"), Some("yaml".to_string()));
        assert_eq!(language_from_path("a.yml"), Some("yaml".to_string()));

        // 未识别扩展名 / 无扩展名 → None，Monaco 退化为纯文本
        assert_eq!(language_from_path("README.txt"), None);
        assert_eq!(language_from_path("Makefile"), None);
    }

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
    fn changes_expand_untracked_directory_into_leaf_files() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        init_git_repo(root);
        fs::write(root.join("tracked.txt"), "base\n").expect("write tracked");
        git(root, &["add", "tracked.txt"]);
        git(root, &["commit", "-m", "base"]);
        fs::create_dir_all(root.join("newdir/sub")).expect("create nested dir");
        fs::write(root.join("newdir/a.txt"), "a\n").expect("write a");
        fs::write(root.join("newdir/sub/b.txt"), "b\n").expect("write b");

        let changes = read_workspace_changes(root).expect("read changes");
        let paths: Vec<&str> = changes
            .files
            .iter()
            .map(|file| file.file_path.as_str())
            .collect();

        assert!(
            paths.iter().any(|path| *path == "newdir/a.txt"),
            "expected leaf file newdir/a.txt, got {paths:?}"
        );
        assert!(
            paths.iter().any(|path| *path == "newdir/sub/b.txt"),
            "expected nested leaf file newdir/sub/b.txt, got {paths:?}"
        );
        assert!(
            !paths
                .iter()
                .any(|path| *path == "newdir" || *path == "newdir/"),
            "untracked directory should not appear as a collapsed entry, got {paths:?}"
        );

        let leaf = changes
            .files
            .iter()
            .find(|file| file.file_path == "newdir/sub/b.txt")
            .expect("leaf change");
        assert_eq!(leaf.kind, WorkspaceChangeKind::Untracked);
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

    #[test]
    fn commit_history_lists_recent_commits_in_non_worktree_branch() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        init_git_repo(root);
        fs::write(root.join("base.txt"), "base\n").expect("write base");
        git(root, &["add", "base.txt"]);
        git(root, &["commit", "-m", "base"]);
        git(root, &["branch", "-M", "main"]);
        git(root, &["checkout", "-b", "feature"]);
        fs::write(root.join("feature.txt"), "one\n").expect("write feature");
        git(root, &["add", "feature.txt"]);
        git(root, &["commit", "-m", "feature one"]);
        fs::write(root.join("feature.txt"), "one\ntwo\n").expect("modify feature");
        git(root, &["add", "feature.txt"]);
        git(root, &["commit", "-m", "feature two"]);

        let history = read_workspace_commit_history(root, None).expect("read commit history");

        // 非 work tree 不再用 base..HEAD 过滤：返回最近 50 条全历史（base + 2 条
        // feature，共 3 条），顺序为 date-order（新→旧）。
        assert!(!history.is_worktree);
        assert_eq!(history.commits.len(), 3);
        assert_eq!(history.commits[0].message, "feature two");
        assert_eq!(history.commits[1].message, "feature one");
        assert_eq!(history.commits[2].message, "base");
        // 该测试仓库无 upstream，所有提交视为本地未 push。
        for commit in &history.commits {
            assert!(!commit.is_pushed);
            assert!(commit.pushed_to.is_none());
        }
        // feature one 引入 feature.txt，status 仍可正确解析。
        let feature_one = &history.commits[1];
        assert_eq!(feature_one.files[0].status, "A");
        assert_eq!(feature_one.files[0].file_path, "feature.txt");
    }

    #[test]
    fn commit_history_marks_local_upstream_commits_as_pushed() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        init_git_repo(root);
        fs::write(root.join("base.txt"), "base\n").expect("write base");
        git(root, &["add", "base.txt"]);
        git(root, &["commit", "-m", "base"]);
        git(root, &["branch", "-M", "base-for-session"]);
        git(root, &["checkout", "-b", "session-worktree"]);
        // 用本地分支模拟 upstream：base-for-session 当前指向 base commit。
        git(root, &["branch", "--set-upstream-to=base-for-session"]);
        fs::write(root.join("session.txt"), "session\n").expect("write session");
        git(root, &["add", "session.txt"]);
        git(root, &["commit", "-m", "session change"]);

        let history = read_workspace_commit_history(root, None).expect("read commit history");

        // 非 work tree 不再过滤 base，返回最近 50 条全历史（base + session change）。
        assert_eq!(history.commits.len(), 2);
        assert_eq!(history.commits[0].message, "session change");
        assert_eq!(history.commits[1].message, "base");

        // base commit 是 upstream (base-for-session) 的祖先 → 已 push；
        // session change 在 upstream 之外 → 未 push。
        assert!(!history.commits[0].is_pushed);
        assert!(history.commits[0].pushed_to.is_none());
        assert!(history.commits[1].is_pushed);
        assert_eq!(
            history.commits[1].pushed_to.as_deref(),
            Some("base-for-session")
        );
    }

    #[test]
    fn committed_diff_reads_parent_and_commit_content() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        init_git_repo(root);
        fs::write(root.join("story.ts"), "const title = 'old';\n").expect("write base");
        git(root, &["add", "story.ts"]);
        git(root, &["commit", "-m", "base"]);
        fs::write(root.join("story.ts"), "const title = 'new';\n").expect("modify file");
        git(root, &["add", "story.ts"]);
        git(root, &["commit", "-m", "update story"]);
        let commit_hash = run_git(root, &["rev-parse", "HEAD"]).expect("read head");

        let diff =
            read_workspace_commit_diff(root, commit_hash.trim(), "story.ts").expect("read diff");

        assert_eq!(diff.file_path, "story.ts");
        assert_eq!(diff.kind, WorkspaceChangeKind::Modified);
        assert_eq!(diff.original_content, "const title = 'old';\n");
        assert_eq!(diff.modified_content, "const title = 'new';\n");
    }

    #[test]
    fn commit_history_caps_at_fifty_entries() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        init_git_repo(root);
        for index in 0..(MAX_COMMIT_HISTORY_ENTRIES + 2) {
            let file_name = format!("file{index}.txt");
            fs::write(root.join(&file_name), format!("content {index}\n")).expect("write file");
            git(root, &["add", &file_name]);
            git(root, &["commit", "-m", &format!("commit {index}")]);
        }

        let history = read_workspace_commit_history(root, None).expect("read commit history");

        assert_eq!(history.commits.len(), MAX_COMMIT_HISTORY_ENTRIES);
        // 最新提交排在最前。
        assert_eq!(
            history.commits[0].message,
            format!("commit {}", MAX_COMMIT_HISTORY_ENTRIES + 1)
        );
    }

    #[test]
    fn commit_history_marks_origin_remote_pushed_commits() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let root = temp_dir.path();
        init_git_repo(root);
        fs::write(root.join("base.txt"), "base\n").expect("write base");
        git(root, &["add", "base.txt"]);
        git(root, &["commit", "-m", "base"]);
        git(root, &["branch", "-M", "main"]);
        git(root, &["checkout", "-b", "dev"]);
        fs::write(root.join("a.txt"), "a\n").expect("write a");
        git(root, &["add", "a.txt"]);
        git(root, &["commit", "-m", "pushed commit"]);
        let pushed_hash = run_git(root, &["rev-parse", "HEAD"]).expect("read pushed head");
        let pushed_hash = pushed_hash.trim();

        // 构造本地领先的一个未 push commit。
        fs::write(root.join("b.txt"), "b\n").expect("write b");
        git(root, &["add", "b.txt"]);
        git(root, &["commit", "-m", "local commit"]);

        // 模拟远端 origin/dev 指向 pushed commit（等价于已 push 到 origin/dev），
        // 并把本地 dev 分支跟踪该远端 ref。先加一个 origin remote（git 校验
        // branch.<name>.remote 时要求 remote 存在），再 update-ref 写入远端 ref，
        // 最后配置 branch.dev.remote/merge 让 `@{upstream}` 解析为 origin/dev。
        git(
            root,
            &["remote", "add", "origin", "https://example.com/fake.git"],
        );
        git(
            root,
            &["update-ref", "refs/remotes/origin/dev", pushed_hash],
        );
        git(root, &["config", "branch.dev.remote", "origin"]);
        git(root, &["config", "branch.dev.merge", "refs/heads/dev"]);

        let history = read_workspace_commit_history(root, None).expect("read commit history");

        // 非 work tree 的 dev 分支：返回最近 50 条全历史（base + pushed + local = 3）。
        assert_eq!(history.commits.len(), 3);
        assert_eq!(history.commits[0].message, "local commit");
        assert_eq!(history.commits[1].message, "pushed commit");
        assert_eq!(history.commits[2].message, "base");

        // local commit 未 push（蓝色），pushed commit 与 base 已 push（紫色 +
        // origin/dev tag）。
        assert!(!history.commits[0].is_pushed);
        assert!(history.commits[0].pushed_to.is_none());
        assert!(history.commits[1].is_pushed);
        assert_eq!(history.commits[1].pushed_to.as_deref(), Some("origin/dev"));
        assert!(history.commits[2].is_pushed);
        assert_eq!(history.commits[2].pushed_to.as_deref(), Some("origin/dev"));
    }

    #[test]
    fn commit_history_in_worktree_marks_own_commits_via_target_branch_base() {
        // 模拟真实仓库场景：worktree 从 main 创建，但本地还存在落后于 main 的 devlop
        // 分支。固定候选列表里 devlop 排在 main 之前，若不传入 target_branch，会误选
        // devlop 作为 base，把 main 相对 devlop 的历史全部计入 worktree 历史。
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let repo_root = temp_dir.path().join("repo");
        let worktree_path = temp_dir.path().join("worktrees").join("issue-7");
        fs::create_dir_all(&repo_root).expect("create repo dir");
        init_git_repo(&repo_root);

        // main 上先放一个提交，随后基于该提交创建更旧的 devlop 分支。
        fs::write(repo_root.join("main.txt"), "m1\n").expect("write main one");
        git(&repo_root, &["add", "main.txt"]);
        git(&repo_root, &["commit", "-m", "main one"]);
        git(&repo_root, &["branch", "-M", "main"]);
        git(&repo_root, &["branch", "devlop"]);

        // main 继续前进，使 devlop 落后于 main。
        fs::write(repo_root.join("main2.txt"), "m2\n").expect("write main two");
        git(&repo_root, &["add", "main2.txt"]);
        git(&repo_root, &["commit", "-m", "main two"]);

        // 以 main 为基创建 issue worktree，并在其上提交自己的改动。
        git(
            &repo_root,
            &[
                "worktree",
                "add",
                "-B",
                "issue-7",
                worktree_path.to_string_lossy().as_ref(),
                "main",
            ],
        );
        fs::write(worktree_path.join("feature.txt"), "f\n").expect("write feature");
        git(&worktree_path, &["add", "feature.txt"]);
        git(&worktree_path, &["commit", "-m", "issue seven change"]);

        // 传入 target_branch=main：worktree 现在展示该分支最近 50 条全历史（main
        // one / main two / issue seven change 共 3 条，date-order 新→旧），不再用
        // base..HEAD 过滤。其中只有 issue seven change 落在 base..HEAD 范围内，标记
        // 为当前 worktree 自身提交；从 main 继承下来的两条标记为他处提交。
        let history = read_workspace_commit_history(&worktree_path, Some("main"))
            .expect("read commit history");
        assert!(history.is_worktree);
        assert_eq!(history.commits.len(), 3);
        assert_eq!(history.commits[0].message, "issue seven change");
        assert!(history.commits[0].is_created_in_worktree);
        assert_eq!(history.commits[1].message, "main two");
        assert!(!history.commits[1].is_created_in_worktree);
        assert_eq!(history.commits[2].message, "main one");
        assert!(!history.commits[2].is_created_in_worktree);
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
