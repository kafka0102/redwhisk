import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  createProjectWorktreeDirectory,
  createProjectWorktreeFile,
  readProjectWorktreeFile,
  type CodeWorkspaceRoot,
  type WorkspaceFileTreeNode,
} from "../../shared/workspace/workspace-commands";
import {
  buildFileTreeEntryPath,
  type FileTreeEntryCreateInput,
} from "../../shared/workspace/file-tree-create-draft";
import { visitFileTreeAncestorDirectories } from "../../shared/workspace/file-tree-listings";
import type { CodeRevealRequest } from "./code-content";
import type { CodeFileTab } from "./code-workspace-cache";
import {
  canEditCodeFileTab,
  pickLruVictimPath,
} from "./code-workspace-helpers";
import type { BulkUnsavedChoice } from "./use-code-unsaved-confirm";

const MAX_FILE_TABS = 10;

export interface UseCodeFileTreePathActionsOptions {
  projectId: number;
  selectedRoot: CodeWorkspaceRoot | null;
  /** 展开目录时按层拉取子节点（已加载的目录由 hook 去重）。 */
  loadDirectory: (directoryPath: string) => void;
  /** 强刷单个目录的 listing 与变更徽标。 */
  refreshDirectory: (directoryPath: string) => void;
  setRevealRequest: Dispatch<SetStateAction<CodeRevealRequest | null>>;
  activateFilePath: (filePath: string | null) => void;
  activePathRef: MutableRefObject<string | null>;
  setTabs: Dispatch<SetStateAction<CodeFileTab[]>>;
  tabsRef: MutableRefObject<CodeFileTab[]>;
  openFilePathsRef: MutableRefObject<Set<string>>;
  confirmBulkUnsaved: () => Promise<BulkUnsavedChoice>;
  saveAllDirtyTabs: () => Promise<boolean>;
  resolveErrorMessage: (error: unknown) => string;
}

export interface CodeFileTreePathActions {
  /** 打开文件 tab；沿用既有 tab 上限 LRU 淘汰、未保存确认与读文件错误归属。 */
  openFile: (
    file: WorkspaceFileTreeNode,
    options?: { startEditing?: boolean },
  ) => Promise<void>;
  /** 从内容搜索命中打开文件并定位到行。 */
  openMatchFromSearch: (match: {
    fileName: string;
    filePath: string;
    lineNumber: number;
  }) => void;
  /** 行内新建：创建条目、强刷目标目录 listing，文件打开为可编辑 tab。 */
  createEntry: (input: FileTreeEntryCreateInput) => Promise<void>;
}

/**
 * 文件树路径动作：树 → tab / 后端命令的编排。
 *
 * 从代码页 Activity 容器里抽出，容器只保留页面编排与状态协调；失败仍由调用方
 * 决定展示方式（新建失败抛回面板，由草稿行就地提示）。
 */
export function useCodeFileTreePathActions({
  projectId,
  selectedRoot,
  loadDirectory,
  refreshDirectory,
  setRevealRequest,
  activateFilePath,
  activePathRef,
  setTabs,
  tabsRef,
  openFilePathsRef,
  confirmBulkUnsaved,
  saveAllDirtyTabs,
  resolveErrorMessage,
}: UseCodeFileTreePathActionsOptions): CodeFileTreePathActions {
  const openFile = useCallback(
    async (
      file: WorkspaceFileTreeNode,
      options?: { startEditing?: boolean },
    ) => {
      if (!selectedRoot || file.kind !== "file") return;
      visitFileTreeAncestorDirectories(file.path, loadDirectory);
      const startEditing = options?.startEditing ?? false;
      const now = Date.now();
      const previousActivePath = activePathRef.current;
      const isAlreadyOpen = openFilePathsRef.current.has(file.path);
      if (isAlreadyOpen) {
        activateFilePath(file.path);
        setTabs((currentTabs) =>
          currentTabs.map((tab) =>
            tab.filePath === file.path ? { ...tab, lastActiveAt: now } : tab,
          ),
        );
        return;
      }

      const currentTabs = tabsRef.current;
      const victimPath = pickLruVictimPath(
        currentTabs,
        previousActivePath,
        MAX_FILE_TABS,
      );
      if (victimPath !== null && currentTabs.some((tab) => tab.isDirty)) {
        const choice = await confirmBulkUnsaved();
        if (choice === "cancel") {
          return;
        }
        if (choice === "saveAll") {
          const saved = await saveAllDirtyTabs();
          if (!saved) {
            return;
          }
        }
      }

      openFilePathsRef.current.add(file.path);
      activateFilePath(file.path);
      setTabs((latestTabs) => {
        const existing = latestTabs.find((tab) => tab.filePath === file.path);
        if (existing) {
          return latestTabs.map((tab) =>
            tab.filePath === file.path ? { ...tab, lastActiveAt: now } : tab,
          );
        }
        const nextTab: CodeFileTab = {
          content: null,
          errorMessage: null,
          fileName: file.name,
          filePath: file.path,
          isDirty: false,
          isEditable: false,
          isLoading: true,
          lastActiveAt: now,
          savedContent: null,
        };
        const nextVictimPath = pickLruVictimPath(
          latestTabs,
          previousActivePath,
          MAX_FILE_TABS,
        );
        const retained =
          nextVictimPath === null
            ? latestTabs
            : latestTabs.filter((tab) => tab.filePath !== nextVictimPath);
        if (nextVictimPath !== null) {
          openFilePathsRef.current.delete(nextVictimPath);
        }
        return [...retained, nextTab];
      });
      void readProjectWorktreeFile({
        projectId,
        workspacePath: selectedRoot.path,
        filePath: file.path,
      })
        .then((content) => {
          setTabs((currentTabs) =>
            currentTabs.map((tab) => {
              if (tab.filePath !== file.path) return tab;
              const loadedTab = {
                ...tab,
                content,
                errorMessage: null,
                isDirty: false,
                isLoading: false,
                savedContent: content.content,
              };
              return startEditing && canEditCodeFileTab(loadedTab)
                ? { ...loadedTab, isEditable: true }
                : loadedTab;
            }),
          );
        })
        .catch((error: unknown) => {
          setTabs((currentTabs) =>
            currentTabs.map((tab) =>
              tab.filePath === file.path
                ? {
                    ...tab,
                    errorMessage: resolveErrorMessage(error),
                    isLoading: false,
                  }
                : tab,
            ),
          );
        });
    },
    [
      activateFilePath,
      activePathRef,
      confirmBulkUnsaved,
      loadDirectory,
      openFilePathsRef,
      projectId,
      resolveErrorMessage,
      saveAllDirtyTabs,
      selectedRoot,
      setTabs,
      tabsRef,
    ],
  );

  const openMatchFromSearch = useCallback(
    (match: { fileName: string; filePath: string; lineNumber: number }) => {
      void openFile({
        id: match.filePath,
        kind: "file",
        name: match.fileName,
        path: match.filePath,
        isIgnored: false,
        children: [],
      });
      setRevealRequest({
        filePath: match.filePath,
        lineNumber: match.lineNumber,
        token: Date.now(),
      });
    },
    [openFile, setRevealRequest],
  );

  const createEntry = useCallback(
    async (input: FileTreeEntryCreateInput) => {
      const rootPath = selectedRoot?.path;
      if (!rootPath) return;
      const filePath = buildFileTreeEntryPath(input.directoryPath, input.name);
      const request = { filePath, projectId, workspacePath: rootPath };
      const create =
        input.kind === "directory"
          ? createProjectWorktreeDirectory
          : createProjectWorktreeFile;
      await create(request);
      refreshDirectory(input.directoryPath);
      if (input.kind === "directory") {
        return;
      }
      await openFile(
        {
          id: filePath,
          isIgnored: false,
          kind: "file",
          name: input.name,
          path: filePath,
        },
        { startEditing: true },
      );
    },
    [openFile, projectId, refreshDirectory, selectedRoot?.path],
  );

  return { createEntry, openFile, openMatchFromSearch };
}
