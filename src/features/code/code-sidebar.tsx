import type { ReactElement } from "react";

import type { FileTreeEntryCreateInput } from "../../shared/workspace/file-tree-create-draft";
import {
  FileTreePanel,
  type FileTreeEntryDeleteInput,
  type FileTreeOpenState,
} from "../../shared/workspace/file-tree-panel";
import type {
  WorkspaceChangeKind,
  WorkspaceFileTreeNode,
} from "../../shared/workspace/workspace-commands";
import { CodeSearchPanel } from "./code-search-panel";
import type {
  CodeContentSearchState,
  CodeSidebarMode,
} from "./code-search-state";

export interface CodeSidebarProps {
  changedFileKinds: ReadonlyMap<string, WorkspaceChangeKind>;
  contentSearch: CodeContentSearchState;
  directoryKinds: ReadonlyMap<string, WorkspaceChangeKind>;
  fileTree: WorkspaceFileTreeNode[];
  fileTreeError: string | null;
  isFileTreeLoading: boolean;
  mode: CodeSidebarMode;
  onContentSearchChange: (state: CodeContentSearchState) => void;
  /** 代码页才注入的行内新建能力；未注入时文件树保持只读。 */
  onCreateEntry?: (input: FileTreeEntryCreateInput) => Promise<void>;
  /** 代码页才注入的删除能力；未注入时文件树菜单不出现「删除」。 */
  onDeleteEntry?: (input: FileTreeEntryDeleteInput) => void;
  onDirectoryOpen: (directoryPath: string) => void;
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
  onOpenMatch: (match: {
    fileName: string;
    filePath: string;
    lineNumber: number;
  }) => void;
  onOpenStateChange: (openState: FileTreeOpenState) => void;
  openFolders: FileTreeOpenState;
  projectId: number;
  queryFocusRequest: number;
  workspacePath: string | null;
}

/**
 * 「代码」Activity 侧栏：文件树与内容搜索互斥切换。
 *
 * 从 Activity 容器抽出的单一 UI 边界，容器只负责喂数据与回调，不再持有这两块面板
 * 的渲染分支。
 */
export function CodeSidebar({
  changedFileKinds,
  contentSearch,
  directoryKinds,
  fileTree,
  fileTreeError,
  isFileTreeLoading,
  mode,
  onContentSearchChange,
  onCreateEntry,
  onDeleteEntry,
  onDirectoryOpen,
  onOpenFile,
  onOpenMatch,
  onOpenStateChange,
  openFolders,
  projectId,
  queryFocusRequest,
  workspacePath,
}: CodeSidebarProps): ReactElement {
  if (mode === "search") {
    return (
      <CodeSearchPanel
        state={contentSearch}
        onChange={onContentSearchChange}
        projectId={projectId}
        workspacePath={workspacePath}
        fileTree={fileTree}
        onOpenMatch={onOpenMatch}
        queryFocusRequest={queryFocusRequest}
      />
    );
  }

  return (
    <FileTreePanel
      changedFileKinds={changedFileKinds}
      directoryKinds={directoryKinds}
      errorMessage={fileTreeError}
      fileTree={fileTree}
      initialOpenState={openFolders}
      isLoading={isFileTreeLoading}
      workspacePath={workspacePath}
      onCreateEntry={onCreateEntry}
      onDeleteEntry={onDeleteEntry}
      onDirectoryOpen={onDirectoryOpen}
      onOpenFile={onOpenFile}
      onOpenStateChange={onOpenStateChange}
    />
  );
}
