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

export function resetChangesWorkspaceCacheForTests(): void {
  changesWorkspaceCache.clear();
}
