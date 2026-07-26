import { invokeCommand } from "../commands/command-client";

export interface ProjectWorkspaceInput {
  projectId: number;
  sessionId?: number | null;
  workspacePath?: string | null;
  /** 已提交历史分页：每页条数；仅 commit history 使用，缺省等价 50。 */
  limit?: number | null;
  /** 已提交历史分页：跳过条数；仅 commit history 使用，缺省等价 0。 */
  offset?: number | null;
}

/** 已提交历史默认页大小（与后端 DEFAULT_COMMIT_HISTORY_LIMIT 对齐）。 */
export const COMMIT_HISTORY_PAGE_SIZE = 50;

export interface ProjectWorkspacePathInput extends ProjectWorkspaceInput {
  filePath: string;
  commitHash?: string | null;
}

export interface WorkspaceFileTreeNode {
  id: string;
  name: string;
  path: string;
  kind: "directory" | "file";
  // Rust children: Vec<WorkspaceFileTreeNode> 带 skip_serializing_if = "Vec::is_empty"，
  // 空数组时键缺失 → TS 用 ? 表达可选。
  children?: WorkspaceFileTreeNode[];
  // Rust size_bytes / modified_at: Option<_> 带 skip_serializing_if = "Option::is_none"。
  sizeBytes?: number;
  modifiedAt?: number;
  // Rust is_ignored: bool 无 skip，始终序列化 → TS 必须为 required。
  isIgnored: boolean;
}

export interface ProjectWorktreeFileTreeResponse {
  nodes: WorkspaceFileTreeNode[];
  signature: string;
}

export interface WorkspaceFileContent {
  filePath: string;
  language: string | null;
  content: string;
  modifiedAt: number | null;
  sizeBytes: number;
  isBinary: boolean;
  isTooLarge: boolean;
}

/** 工作区单文件轻量元数据（不读正文），用于构造 size:mtime 签名。 */
export interface WorkspaceFileStat {
  filePath: string;
  sizeBytes: number;
  modifiedAt: number | null;
}

export interface CodeWorkspaceRoot {
  branch: string;
  path: string;
  isProjectRoot: boolean;
}

export interface CodeWorkspaceRootsResponse {
  roots: CodeWorkspaceRoot[];
}

export const CODE_WORKSPACE_ROOTS_UPDATED_EVENT =
  "code-workspace-roots-updated";

export interface CodeWorkspaceRootsUpdatedEvent {
  projectId: number;
  roots: CodeWorkspaceRoot[];
}

export function listCodeWorkspaceRoots(
  projectId: number,
): Promise<CodeWorkspaceRootsResponse> {
  return invokeCommand<CodeWorkspaceRootsResponse>(
    "list_code_workspace_roots",
    {
      projectId,
    },
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

export function statProjectWorktreeFile(
  input: ProjectWorkspacePathInput,
): Promise<WorkspaceFileStat> {
  return invokeCommand<WorkspaceFileStat>("stat_project_worktree_file", {
    input,
  });
}

export type WorkspaceChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "binary";

export interface WorkspaceChangedFile {
  filePath: string;
  oldPath: string | null;
  fileName: string;
  kind: WorkspaceChangeKind;
  status: string;
  additions: number;
  deletions: number;
  isBinary: boolean;
  contentHash: string;
  metadataSignature: string;
}

export type WorkspaceCommitStatus =
  | "A"
  | "M"
  | "D"
  | "R"
  | "C"
  | "T"
  | "U"
  | "X";

export interface WorkspaceCommitChangedFile {
  filePath: string;
  oldPath: string | null;
  fileName: string;
  kind: WorkspaceChangeKind;
  status: WorkspaceCommitStatus;
}

export interface WorkspaceCommitRecord {
  hash: string;
  shortHash: string;
  message: string;
  authorName: string;
  committedAt: number;
  files: WorkspaceCommitChangedFile[];
  isPushed: boolean;
  pushedTo?: string | null;
  isCreatedInWorktree: boolean;
}

export interface ProjectWorktreeChangesResponse {
  files: WorkspaceChangedFile[];
  signature: string;
}

export interface ProjectWorktreeCommitHistoryResponse {
  commits: WorkspaceCommitRecord[];
  signature: string;
  isWorktree: boolean;
  // worktree 场景下解析出的分叉基分支名（来自 session 的 target_branch 或启发式
  // 候选），仅 worktree 且非主分支且成功解出 base 时为 Some。前端用它渲染首条
  // 黄色提交右侧的黄色 base Tag。非 worktree / 主分支 / base 解析失败时不返回。
  baseBranch?: string | null;
  /** 本页条数 >= limit 时为 true，调用方可继续 offset 取更早提交。 */
  hasMore: boolean;
}

export interface WorkspaceDiffContent {
  filePath: string;
  oldPath: string | null;
  kind: WorkspaceChangeKind;
  language: string | null;
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

export function getProjectWorktreeCommitHistory(
  input: ProjectWorkspaceInput,
): Promise<ProjectWorktreeCommitHistoryResponse> {
  return invokeCommand<ProjectWorktreeCommitHistoryResponse>(
    "get_project_worktree_commit_history",
    { input },
  );
}

export function readProjectWorktreeDiff(
  input: ProjectWorkspacePathInput,
): Promise<WorkspaceDiffContent> {
  return invokeCommand<WorkspaceDiffContent>("read_project_worktree_diff", {
    input,
  });
}

export interface WorkspaceContentSearchInput {
  projectId: number;
  sessionId?: number | null;
  workspacePath?: string | null;
  query: string;
  matchCase?: boolean;
  matchWholeWord?: boolean;
  useRegex?: boolean;
  include?: string[];
  exclude?: string[];
}

export interface WorkspaceContentSearchMatch {
  lineNumber: number;
  lineText: string;
  matchStart?: number;
  matchEnd?: number;
}

export interface WorkspaceContentSearchFileGroup {
  filePath: string;
  fileName: string;
  matchCount: number;
  matches: WorkspaceContentSearchMatch[];
}

export interface WorkspaceContentSearchResponse {
  files: WorkspaceContentSearchFileGroup[];
  fileCount: number;
  matchCount: number;
  truncated: boolean;
}

export function searchProjectWorktreeContent(
  input: WorkspaceContentSearchInput,
): Promise<WorkspaceContentSearchResponse> {
  return invokeCommand<WorkspaceContentSearchResponse>(
    "search_project_worktree_content",
    { input },
  );
}

export function pullProjectWorktree(
  input: ProjectWorkspaceInput,
): Promise<void> {
  return invokeCommand<void>("pull_project_worktree", { input });
}

export function pushProjectWorktree(
  input: ProjectWorkspaceInput,
): Promise<void> {
  return invokeCommand<void>("push_project_worktree", { input });
}

export function deleteCodeWorkspaceWorktree(
  input: ProjectWorkspaceInput,
): Promise<void> {
  return invokeCommand<void>("delete_code_workspace_worktree", { input });
}

export interface WorkspaceGithubRemote {
  owner: string;
  repo: string;
}

export interface ResolveWorkspaceGithubRemoteResponse {
  remote?: WorkspaceGithubRemote | null;
}

export interface ProbeGithubCommitInput {
  owner: string;
  repo: string;
  commitHash: string;
}

export type GithubCommitProbeStatus = "exists" | "not_found" | "network_error";

export interface ProbeGithubCommitResponse {
  status: GithubCommitProbeStatus;
  commitUrl?: string | null;
}

export function resolveWorkspaceGithubRemote(
  input: ProjectWorkspaceInput,
): Promise<ResolveWorkspaceGithubRemoteResponse> {
  return invokeCommand<ResolveWorkspaceGithubRemoteResponse>(
    "resolve_workspace_github_remote",
    { input },
  );
}

export function probeGithubCommit(
  input: ProbeGithubCommitInput,
): Promise<ProbeGithubCommitResponse> {
  return invokeCommand<ProbeGithubCommitResponse>("probe_github_commit", {
    input,
  });
}
