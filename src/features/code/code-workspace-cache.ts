import type { editor as MonacoEditor } from "monaco-editor";

import type { WorkspaceFileContent } from "../../shared/workspace/workspace-commands";
import type {
  CodeContentSearchState,
  CodeSidebarMode,
} from "./code-search-state";

export type CodeEditorViewState = MonacoEditor.ICodeEditorViewState;

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

/**
 * 已打开文件的 Monaco 视图状态（滚动位置 / 光标）。
 * 按 projectId 分桶，仅内存缓存；切到其它 Activity 再回来时恢复上次阅读位置。
 */
const codeEditorViewStateCache = new Map<
  number,
  Map<string, CodeEditorViewState | null>
>();

export function getCodeEditorViewState(
  projectId: number,
  filePath: string,
): CodeEditorViewState | null {
  return codeEditorViewStateCache.get(projectId)?.get(filePath) ?? null;
}

export function setCodeEditorViewState(
  projectId: number,
  filePath: string,
  viewState: CodeEditorViewState | null,
): void {
  let projectStates = codeEditorViewStateCache.get(projectId);
  if (!projectStates) {
    projectStates = new Map();
    codeEditorViewStateCache.set(projectId, projectStates);
  }
  projectStates.set(filePath, viewState);
}

export function deleteCodeEditorViewState(
  projectId: number,
  filePath: string,
): void {
  codeEditorViewStateCache.get(projectId)?.delete(filePath);
}

export function clearCodeEditorViewStates(projectId: number): void {
  codeEditorViewStateCache.delete(projectId);
}

export function resetCodeWorkspaceCacheForTests(): void {
  codeWorkspaceCache.clear();
  codeEditorViewStateCache.clear();
}
