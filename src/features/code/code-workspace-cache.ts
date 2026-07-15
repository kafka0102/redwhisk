import type {
  WorkspaceFileContent,
  WorkspaceFileTreeNode,
} from "../../shared/workspace/workspace-commands";

export interface CodeFileTab {
  content: WorkspaceFileContent | null;
  errorMessage: string | null;
  fileName: string;
  filePath: string;
  isLoading: boolean;
  lastActiveAt: number;
}

/** 左侧栏「文件 / 变更」视图类型，切页回来保持选择。 */
export type CodeWorkspaceView = "files" | "changes";

export interface CachedCodeWorkspaceState {
  activePath: string | null;
  /** 目录展开状态（react-arborist OpenMap），切页回来保持展开结构。 */
  openFolders: Record<string, boolean>;
  selectedRootPath: string | null;
  sidebarWidth: number;
  tabs: CodeFileTab[];
  tree: WorkspaceFileTreeNode[];
  treeError: string | null;
  /** 当前 root 是否已成功/失败加载过树；用于避免切页回来强制重拉。 */
  treeLoaded: boolean;
  /** 左侧栏当前视图类型（文件 / 变更）。 */
  viewType: CodeWorkspaceView;
}

export const codeWorkspaceStateCache = new Map<
  number,
  CachedCodeWorkspaceState
>();

export function resetCodeWorkspaceStateCacheForTests(): void {
  codeWorkspaceStateCache.clear();
}
