import {
  clearEditorReadingPosition,
  clearEditorReadingPositionsByProject,
  createEditorReadingPositionKey,
} from "../../shared/workspace/editor-reading-position";
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
  /** 缓冲相对最近一次成功加载/保存的磁盘正文是否有未保存改动。 */
  isDirty: boolean;
  /** 当前 Tab 是否处于用户显式开启的可编辑态。 */
  isEditable: boolean;
  isLoading: boolean;
  lastActiveAt: number;
  /** 最近一次成功加载/保存的磁盘正文，用于 dirty 判定。 */
  savedContent: string | null;
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

/** 代码页阅读位置均使用「项目 + 文件路径」身份（存储与时机策略见共享 module）。 */
export function codeEditorReadingPositionKey(
  projectId: number,
  filePath: string,
): string {
  return createEditorReadingPositionKey({ projectId, filePath });
}

/** 关闭文件 Tab / 淘汰 LRU Tab 时清理该文件的阅读位置。 */
export function clearCodeEditorReadingPosition(
  projectId: number,
  filePath: string,
): void {
  clearEditorReadingPosition(codeEditorReadingPositionKey(projectId, filePath));
}

/** 切换代码根时清理该项目下全部文件的阅读位置。 */
export function clearCodeEditorReadingPositions(projectId: number): void {
  clearEditorReadingPositionsByProject(projectId);
}

export function resetCodeWorkspaceCacheForTests(): void {
  codeWorkspaceCache.clear();
}
