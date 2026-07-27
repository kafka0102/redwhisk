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
    #[serde(default)]
    pub workspace_path: Option<String>,
    /// 已提交历史分页：每页条数。仅 `get_project_worktree_commit_history` 使用；
    /// 缺省等价 50。允许 >50 以支撑前端整窗刷新。
    #[serde(default)]
    pub limit: Option<usize>,
    /// 已提交历史分页：跳过条数。仅 `get_project_worktree_commit_history` 使用；
    /// 缺省等价 0。
    #[serde(default)]
    pub offset: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspacePathInput {
    pub project_id: i64,
    pub session_id: Option<i64>,
    pub file_path: String,
    pub commit_hash: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspaceWriteFileInput {
    pub project_id: i64,
    pub session_id: Option<i64>,
    pub file_path: String,
    #[serde(default)]
    pub workspace_path: Option<String>,
    pub content: String,
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
pub struct BranchSyncStatus {
    /// 当前分支跟踪的 upstream 缩写名，如 `origin/main`。
    pub upstream: String,
    /// 本地相对 upstream 超前的提交数（`HEAD` 有、upstream 无）。
    pub ahead: u64,
    /// 本地相对 upstream 落后的提交数（upstream 有、`HEAD` 无）。
    pub behind: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorktreeChangesResponse {
    pub files: Vec<WorkspaceChangedFile>,
    pub signature: String,
    /// 相对 upstream 的本地同步状态。无 upstream / detached / 解析失败时为 None。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_sync: Option<BranchSyncStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCommitChangedFile {
    pub file_path: String,
    pub old_path: Option<String>,
    pub file_name: String,
    pub kind: WorkspaceChangeKind,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCommitRecord {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author_name: String,
    pub committed_at: i64,
    pub files: Vec<WorkspaceCommitChangedFile>,
    pub is_pushed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pushed_to: Option<String>,
    // 是否由当前 worktree 创建（即落在 worktree 分叉基 base..HEAD 范围内）。
    // 仅在 worktree 场景有意义：前端用它把 worktree 自身提交（蓝）与从 base 继承
    // 下来的历史提交（橘黄）区分开。非 worktree 场景恒为 false，前端不使用。
    pub is_created_in_worktree: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorktreeCommitHistoryResponse {
    pub commits: Vec<WorkspaceCommitRecord>,
    pub signature: String,
    // 当前 workspace root 是否为额外 worktree。前端据此切换圆点着色规则：
    // worktree 场景按 is_created_in_worktree 区分蓝/橘黄；非 worktree 场景按
    // is_pushed 区分紫/蓝。
    pub is_worktree: bool,
    // worktree 场景下解析出的分叉基分支名（来自 session 的 target_branch 或启发式
    // 候选），仅 worktree 且非主分支且成功解出 base 时为 Some。前端用它渲染首条
    // 黄色提交右侧的黄色 base Tag。非 worktree / 主分支 / base 解析失败时为 None。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
    // 是否可能还有更早的提交：本页返回条数 >= 本次 limit 则为 true。
    // 恰好整页倍数时下一页可能为空，由调用方再请求一次收敛。
    pub has_more: bool,
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
    pub is_ignored: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeWorkspaceRoot {
    pub branch: String,
    pub path: String,
    pub is_project_root: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeWorkspaceRootsResponse {
    pub roots: Vec<CodeWorkspaceRoot>,
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

/// 工作区单文件轻量元数据（不读正文），供前端构造 size:mtime 签名。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileStat {
    pub file_path: String,
    pub size_bytes: u64,
    pub modified_at: Option<i64>,
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

/// 工作区内容搜索入参：在当前代码根内按查询串做行级匹配。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceContentSearchInput {
    pub project_id: i64,
    pub session_id: Option<i64>,
    #[serde(default)]
    pub workspace_path: Option<String>,
    pub query: String,
    #[serde(default)]
    pub match_case: bool,
    #[serde(default)]
    pub match_whole_word: bool,
    #[serde(default)]
    pub use_regex: bool,
    /// 包含 glob 列表（多条 OR）；空 = 全部合格文件。v1 可先由前端传空，完整过滤见后续票。
    #[serde(default)]
    pub include: Vec<String>,
    /// 排除 glob 列表（多条 OR，优先于 include）；空 = 不额外排除。
    #[serde(default)]
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceContentSearchMatch {
    /// 1-based 行号。
    pub line_number: u32,
    pub line_text: String,
    /// 行内首个匹配的起始列（0-based，按 UTF-8 字节偏移近似字符列）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_start: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_end: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceContentSearchFileGroup {
    pub file_path: String,
    pub file_name: String,
    pub match_count: u32,
    pub matches: Vec<WorkspaceContentSearchMatch>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceContentSearchResponse {
    pub files: Vec<WorkspaceContentSearchFileGroup>,
    pub file_count: u32,
    pub match_count: u32,
    pub truncated: bool,
}

/// workspace 远程解析出的 github.com owner/repo（仅公共 github.com）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGithubRemote {
    pub owner: String,
    pub repo: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveWorkspaceGithubRemoteResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote: Option<WorkspaceGithubRemote>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeGithubCommitInput {
    pub owner: String,
    pub repo: String,
    pub commit_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GithubCommitProbeStatus {
    Exists,
    NotFound,
    NetworkError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeGithubCommitResponse {
    pub status: GithubCommitProbeStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_url: Option<String>,
}
