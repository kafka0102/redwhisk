import type { WorkspaceFileContent } from "../../shared/workspace/workspace-commands";
import type {
  CodeContentSearchState,
  CodeSidebarMode,
} from "./code-search-state";

export interface CodeFileTab {
  content: WorkspaceFileContent | null;
  errorMessage: string | null;
  fileName: string;
  filePath: string;
  isLoading: boolean;
  lastActiveAt: number;
}

/** 代码 Activity 按 projectId 持久化的工作区状态。 */
export interface CachedCodeWorkspaceState {
  activePath: string | null;
  contentSearch: CodeContentSearchState;
  /** 目录展开状态（react-arborist OpenMap），切页回来保持展开结构。 */
  openFolders: Record<string, boolean>;
  selectedRootPath: string | null;
  sidebarMode: CodeSidebarMode;
  sidebarWidth: number;
  tabs: CodeFileTab[];
}

export const codeWorkspaceCache = new Map<number, CachedCodeWorkspaceState>();

export function resetCodeWorkspaceCacheForTests(): void {
  codeWorkspaceCache.clear();
}
