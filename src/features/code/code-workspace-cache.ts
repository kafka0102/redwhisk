import type {
  WorkspaceFileContent,
  WorkspaceFileTreeNode,
} from "../agents/session-workspace-commands";

export interface CodeFileTab {
  content: WorkspaceFileContent | null;
  errorMessage: string | null;
  fileName: string;
  filePath: string;
  isLoading: boolean;
  lastActiveAt: number;
}

export interface CachedCodeWorkspaceState {
  activePath: string | null;
  selectedRootPath: string | null;
  sidebarWidth: number;
  tabs: CodeFileTab[];
  tree: WorkspaceFileTreeNode[];
  treeError: string | null;
}

export const codeWorkspaceStateCache = new Map<
  number,
  CachedCodeWorkspaceState
>();

export function resetCodeWorkspaceStateCacheForTests(): void {
  codeWorkspaceStateCache.clear();
}
