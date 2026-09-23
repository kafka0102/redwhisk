import type {
  BranchSyncStatus,
  WorkspaceChangedFile,
  WorkspaceCommitRecord,
} from "../../shared/workspace/workspace-commands";

/** 变更 Activity 按 projectId 持久化的工作区状态（与 code 完全独立）。 */
export interface CachedChangesWorkspaceState {
  selectedRootPath: string | null;
  sidebarWidth: number;
  /** 「未提交变更」折叠面板是否展开，默认展开。 */
  uncommittedChangesExpanded: boolean;
  /** 「已提交变更」折叠面板是否展开，默认展开。 */
  committedChangesExpanded: boolean;
}

export const changesWorkspaceCache = new Map<
  number,
  CachedChangesWorkspaceState
>();

/**
 * 「未提交变更」的一次成功响应快照。
 *
 * 切到别的 Activity 会整棵卸载 ChangesActivity，列表数据只存在 hook state 时切回
 * 必然清空重拉 → 每次都先闪空态 / loading。缓存上次成功响应后，重挂载首帧直接
 * 回填旧数据，再后台 soft revalidate（见 ADR-0041）。
 */
export interface CachedWorkspaceChanges {
  files: WorkspaceChangedFile[];
  branchSync: BranchSyncStatus | null;
  /** 后端 signature；load-more 等场景可显式置空以强制下次整窗刷新应用。 */
  signature: string | null;
}

/** 「已提交历史」的一次成功响应快照，语义同 CachedWorkspaceChanges。 */
export interface CachedWorkspaceCommitHistory {
  commits: WorkspaceCommitRecord[];
  isWorktree: boolean;
  baseBranch: string | null;
  hasMore: boolean;
  signature: string | null;
}

// 列表数据按「项目 + 工作区路径」隔离：同一项目下切换分支（工作区）不得串数据。
// 进程内缓存，随应用退出释放；key 数量受「项目数 × 访问过的 worktree 数」约束。
const workspaceChangesDataCache = new Map<string, CachedWorkspaceChanges>();
const workspaceCommitHistoryDataCache = new Map<
  string,
  CachedWorkspaceCommitHistory
>();

function workspaceDataKey(projectId: number, workspacePath: string): string {
  return `${projectId}::${workspacePath}`;
}

export function getCachedWorkspaceChanges(
  projectId: number,
  workspacePath: string | null,
): CachedWorkspaceChanges | null {
  if (!workspacePath) return null;
  return (
    workspaceChangesDataCache.get(workspaceDataKey(projectId, workspacePath)) ??
    null
  );
}

export function setCachedWorkspaceChanges(
  projectId: number,
  workspacePath: string,
  changes: CachedWorkspaceChanges,
): void {
  workspaceChangesDataCache.set(
    workspaceDataKey(projectId, workspacePath),
    changes,
  );
}

export function getCachedWorkspaceCommitHistory(
  projectId: number,
  workspacePath: string | null,
): CachedWorkspaceCommitHistory | null {
  if (!workspacePath) return null;
  return (
    workspaceCommitHistoryDataCache.get(
      workspaceDataKey(projectId, workspacePath),
    ) ?? null
  );
}

export function setCachedWorkspaceCommitHistory(
  projectId: number,
  workspacePath: string,
  commitHistory: CachedWorkspaceCommitHistory,
): void {
  workspaceCommitHistoryDataCache.set(
    workspaceDataKey(projectId, workspacePath),
    commitHistory,
  );
}

export function resetChangesWorkspaceCacheForTests(): void {
  changesWorkspaceCache.clear();
  workspaceChangesDataCache.clear();
  workspaceCommitHistoryDataCache.clear();
}
