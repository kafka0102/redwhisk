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

/** 左侧栏「文件 / 变更」视图类型，由父层 Activity 受控传入。 */
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
  /** 「变更」视图下「未提交变更」折叠面板是否展开，默认展开。 */
  uncommittedChangesExpanded: boolean;
  /** 「变更」视图下「已提交变更」折叠面板是否展开，默认展开。 */
  committedChangesExpanded: boolean;
}

export const codeWorkspaceStateCache = new Map<
  number,
  CachedCodeWorkspaceState
>();

export function resetCodeWorkspaceStateCacheForTests(): void {
  codeWorkspaceStateCache.clear();
}
