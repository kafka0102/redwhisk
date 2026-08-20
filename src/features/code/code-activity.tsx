import { Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import {
  FileTreePanel,
  type FileTreeOpenState,
} from "../../shared/workspace/file-tree-panel";
import {
  DEFAULT_SIDEBAR_WIDTH,
  useWorkspaceShell,
} from "../../shared/workspace/use-workspace-shell";
import { WorkspaceShell } from "../../shared/workspace/workspace-shell";
import { useAlertDialog } from "../../components/ui/use-alert-dialog";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import {
  readProjectWorktreeFile,
  writeProjectWorktreeFile,
  type CodeWorkspaceRoot,
  type WorkspaceFileTreeNode,
} from "../../shared/workspace/workspace-commands";
import { CodeBreadcrumb } from "./code-breadcrumb";
import { CodeContent, type CodeRevealRequest } from "./code-content";
import { CodeSearchPanel } from "./code-search-panel";
import {
  DEFAULT_CODE_CONTENT_SEARCH_STATE,
  type CodeContentSearchState,
  type CodeSidebarMode,
} from "./code-search-state";
import { isContentSearchShortcut } from "./is-content-search-shortcut";
import { isFileSaveShortcut } from "./is-file-save-shortcut";
import {
  type CodeFileTab,
  clearCodeEditorViewStates,
  codeWorkspaceCache,
  deleteCodeEditorViewState,
} from "./code-workspace-cache";
import {
  canEditCodeFileTab,
  getCodeFileEditBlockReason,
  isMarkdownPreviewable,
  normalizeCodeFileTab,
  pickLruVictimPath,
  resolveEditDisabledTitle,
  resolveFileLoadErrorMessage,
} from "./code-workspace-helpers";
import { useCodeUnsavedConfirm } from "./use-code-unsaved-confirm";
import { buildActiveFileSignature } from "./use-code-active-file-refresh";
import { useCodeActiveFileRefreshBinding } from "./use-code-active-file-refresh-binding";
import { useCodeLanguageHost } from "./use-code-language-host";
import { useCodeWorkspaceFileTree } from "./use-code-workspace-file-tree";

const MAX_FILE_TABS = 10;

interface CodeActivityProps {
  projectId: number;
  roots: CodeWorkspaceRoot[];
}

/**
 * 「代码」Activity：文件树 + 多 tab 代码编辑器。分支选择、侧栏宽度、tabs 等状态
 * 持久化在 codeWorkspaceCache（仅 code 侧），与「变更」Activity 完全独立——在
 * code 切换分支不影响 changes 的选择，反之亦然。工作区框架逻辑（roots 轮询、
 * splitter、root 失效切换）复用 useWorkspaceShell + WorkspaceShell。
 */
export function CodeActivity({ projectId, roots }: CodeActivityProps) {
  const { contentFontSize, messages, theme, t } = useI18n();
  const { alertDialog, showAlert } = useAlertDialog();
  const {
    confirmBulkUnsaved,
    confirmExternalConflict,
    confirmSingleUnsaved,
    unsavedConfirmDialog,
  } = useCodeUnsavedConfirm();
  const cached = codeWorkspaceCache.get(projectId);
  const [tabs, setTabs] = useState<CodeFileTab[]>(() =>
    (cached?.tabs ?? []).map(normalizeCodeFileTab),
  );
  const [activePath, setActivePath] = useState<string | null>(
    () => cached?.activePath ?? null,
  );
  const [openFolders, setOpenFolders] = useState<FileTreeOpenState>(
    () => cached?.openFolders ?? {},
  );
  const [sidebarMode, setSidebarMode] = useState<CodeSidebarMode>(
    () => cached?.sidebarMode ?? "fileTree",
  );
  const [contentSearch, setContentSearch] = useState<CodeContentSearchState>(
    () => cached?.contentSearch ?? DEFAULT_CODE_CONTENT_SEARCH_STATE,
  );
  const [queryFocusRequest, setQueryFocusRequest] = useState(0);
  const [revealRequest, setRevealRequest] = useState<CodeRevealRequest | null>(
    null,
  );
  const [markdownViewMode, setMarkdownViewMode] = useState<
    "source" | "preview"
  >("source");
  const activePathRef = useRef<string | null>(cached?.activePath ?? null);
  const tabsRef = useRef<CodeFileTab[]>(
    (cached?.tabs ?? []).map(normalizeCodeFileTab),
  );
  const openFilePathsRef = useRef(
    new Set((cached?.tabs ?? []).map((tab) => tab.filePath)),
  );
  const fileNotFoundMessage = messages.agentsFeature.fileNotFound;

  const clearCodeState = useCallback(() => {
    openFilePathsRef.current.clear();
    activePathRef.current = null;
    setTabs([]);
    setActivePath(null);
    setOpenFolders({});
    setContentSearch(DEFAULT_CODE_CONTENT_SEARCH_STATE);
    clearCodeEditorViewStates(projectId);
    setRevealRequest(null);
    setMarkdownViewMode("source");
  }, [projectId]);

  const shell = useWorkspaceShell({
    projectId,
    initialRoots: roots,
    initialSelectedRootPath: cached?.selectedRootPath ?? null,
    initialSidebarWidth: cached?.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH,
    onRootChange: clearCodeState,
  });
  const { selectedRoot, selectedRootWorkspacePath, selectRoot } = shell;

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    codeWorkspaceCache.set(projectId, {
      activePath,
      contentSearch,
      openFolders,
      selectedRootPath: shell.selectedRootPath,
      sidebarMode,
      sidebarWidth: shell.sidebarWidth,
      tabs,
    });
  }, [
    activePath,
    contentSearch,
    openFolders,
    projectId,
    shell.selectedRootPath,
    sidebarMode,
    shell.sidebarWidth,
    tabs,
  ]);

  const { tree, treeError, isTreeLoading, changedFileKinds, directoryKinds } =
    useCodeWorkspaceFileTree(projectId, selectedRootWorkspacePath, true);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.filePath === activePath) ?? null,
    [activePath, tabs],
  );
  const { unavailableReason } = useCodeLanguageHost({
    activeTab,
    projectId,
    workspacePath: selectedRootWorkspacePath,
  });
  const knownActiveSignature =
    activeTab?.content != null
      ? buildActiveFileSignature(
          activeTab.content.sizeBytes,
          activeTab.content.modifiedAt,
        )
      : null;
  const resolveActiveFileErrorMessage = useCallback(
    (error: unknown) =>
      resolveFileLoadErrorMessage(error, fileNotFoundMessage, t),
    [fileNotFoundMessage, t],
  );
  useCodeActiveFileRefreshBinding({
    projectId,
    workspacePath: selectedRootWorkspacePath,
    activePath,
    enabled: Boolean(selectedRoot && activePath),
    knownSignature: knownActiveSignature,
    setTabs,
    resolveErrorMessage: resolveActiveFileErrorMessage,
    confirmExternalConflict,
    tabsRef,
  });

  useEffect(() => {
    if (!selectedRoot || tabs.length === 0) return;

    let isCurrent = true;
    const tabsToValidate = tabs;
    const workspacePath = selectedRoot.path;

    void Promise.all(
      tabsToValidate.map(async (tab) => {
        try {
          const content = await readProjectWorktreeFile({
            projectId,
            workspacePath,
            filePath: tab.filePath,
          });
          return {
            content,
            errorMessage: null as string | null,
            filePath: tab.filePath,
          };
        } catch (error) {
          return {
            content: null,
            errorMessage: resolveFileLoadErrorMessage(
              error,
              fileNotFoundMessage,
              t,
            ),
            filePath: tab.filePath,
          };
        }
      }),
    ).then((results) => {
      if (!isCurrent) return;
      const resultByPath = new Map(
        results.map((result) => [result.filePath, result]),
      );
      setTabs((currentTabs) =>
        currentTabs.map((tab) => {
          const result = resultByPath.get(tab.filePath);
          if (!result) return tab;
          if (tab.isDirty) {
            return { ...tab, isLoading: false };
          }
          return {
            ...tab,
            content: result.content,
            errorMessage: result.errorMessage,
            isDirty: false,
            isLoading: false,
            savedContent: result.content?.content ?? null,
          };
        }),
      );
    });

    return () => {
      isCurrent = false;
    };
    // 仅在挂载 / 切换 root 时复检，避免打开新文件时重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount/root revalidation
  }, [fileNotFoundMessage, projectId, selectedRoot?.path, t]);

  const activateFilePath = useCallback((filePath: string | null) => {
    activePathRef.current = filePath;
    setActivePath(filePath);
    // 换文件/关 tab 后回到默认源码视图（不跨文件记忆）。
    setMarkdownViewMode("source");
  }, []);

  const saveTabByPath = useCallback(
    async (filePath: string): Promise<boolean> => {
      const rootPath = selectedRoot?.path;
      if (!rootPath) {
        return false;
      }
      const tab = tabsRef.current.find((item) => item.filePath === filePath);
      if (
        !tab ||
        !tab.content ||
        tab.content.isBinary ||
        tab.content.isTooLarge
      ) {
        return false;
      }
      try {
        const written = await writeProjectWorktreeFile({
          projectId,
          workspacePath: rootPath,
          filePath,
          content: tab.content.content,
        });
        const nextTabs = tabsRef.current.map((item) =>
          item.filePath === filePath
            ? {
                ...item,
                content: written,
                errorMessage: null,
                isDirty: false,
                isLoading: false,
                savedContent: written.content,
              }
            : item,
        );
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
        return true;
      } catch (error) {
        showAlert({
          message: getCommandErrorMessage(error, t),
          type: "error",
        });
        return false;
      }
    },
    [projectId, selectedRoot?.path, showAlert, t],
  );

  const saveAllDirtyTabs = useCallback(async (): Promise<boolean> => {
    const dirtyPaths = tabsRef.current
      .filter((tab) => tab.isDirty)
      .map((tab) => tab.filePath);
    for (const filePath of dirtyPaths) {
      const saved = await saveTabByPath(filePath);
      if (!saved) {
        return false;
      }
    }
    return true;
  }, [saveTabByPath]);

  const openFile = useCallback(
    async (file: WorkspaceFileTreeNode) => {
      if (!selectedRoot || file.kind !== "file") return;
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
          deleteCodeEditorViewState(projectId, nextVictimPath);
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
            currentTabs.map((tab) =>
              tab.filePath === file.path
                ? {
                    ...tab,
                    content,
                    errorMessage: null,
                    isDirty: false,
                    isLoading: false,
                    savedContent: content.content,
                  }
                : tab,
            ),
          );
        })
        .catch((error) => {
          setTabs((currentTabs) =>
            currentTabs.map((tab) =>
              tab.filePath === file.path
                ? {
                    ...tab,
                    errorMessage: resolveFileLoadErrorMessage(
                      error,
                      fileNotFoundMessage,
                      t,
                    ),
                    isLoading: false,
                  }
                : tab,
            ),
          );
        });
    },
    [
      activateFilePath,
      confirmBulkUnsaved,
      fileNotFoundMessage,
      projectId,
      saveAllDirtyTabs,
      selectedRoot,
      t,
    ],
  );

  const openMatchFromSearch = useCallback(
    (match: { fileName: string; filePath: string; lineNumber: number }) => {
      openFile({
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
    [openFile],
  );

  const handleActiveTabContentChange = useCallback((value: string) => {
    const path = activePathRef.current;
    if (!path) return;
    setTabs((currentTabs) =>
      currentTabs.map((tab) => {
        if (tab.filePath !== path || !tab.content || !tab.isEditable) {
          return tab;
        }
        return {
          ...tab,
          content: { ...tab.content, content: value },
          isDirty: value !== (tab.savedContent ?? ""),
        };
      }),
    );
  }, []);

  const toggleActiveTabEditable = useCallback(async () => {
    const path = activePathRef.current;
    if (!path) return;
    const tab = tabsRef.current.find((item) => item.filePath === path);
    if (!tab || !canEditCodeFileTab(tab)) {
      return;
    }

    if (tab.isEditable && tab.isDirty) {
      const choice = await confirmSingleUnsaved(tab.fileName);
      if (choice === "cancel") {
        return;
      }
      if (choice === "save") {
        const saved = await saveTabByPath(path);
        if (!saved) {
          return;
        }
        setTabs((currentTabs) =>
          currentTabs.map((item) =>
            item.filePath === path ? { ...item, isEditable: false } : item,
          ),
        );
        return;
      }
      setTabs((currentTabs) =>
        currentTabs.map((item) => {
          if (item.filePath !== path || !item.content) {
            return item;
          }
          const restored =
            item.savedContent === null
              ? item.content.content
              : item.savedContent;
          return {
            ...item,
            content: { ...item.content, content: restored },
            isDirty: false,
            isEditable: false,
          };
        }),
      );
      return;
    }

    if (!tab.isEditable) {
      setMarkdownViewMode("source");
      setTabs((currentTabs) =>
        currentTabs.map((item) => {
          if (item.filePath !== path || !canEditCodeFileTab(item)) {
            return item;
          }
          return { ...item, isEditable: true };
        }),
      );
      return;
    }

    setTabs((currentTabs) =>
      currentTabs.map((item) => {
        if (item.filePath !== path || !canEditCodeFileTab(item)) {
          return item;
        }
        return { ...item, isEditable: false };
      }),
    );
  }, [confirmSingleUnsaved, saveTabByPath]);

  const saveActiveTab = useCallback(async () => {
    const path = activePathRef.current;
    if (!path) return;
    const tab = tabsRef.current.find((item) => item.filePath === path);
    if (
      !tab ||
      !tab.isEditable ||
      !tab.content ||
      tab.content.isBinary ||
      tab.content.isTooLarge
    ) {
      return;
    }
    if (isMarkdownPreviewable(tab) && markdownViewMode === "preview") {
      return;
    }
    await saveTabByPath(path);
  }, [markdownViewMode, saveTabByPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isContentSearchShortcut(event)) {
        event.preventDefault();
        setSidebarMode("search");
        setQueryFocusRequest((token) => token + 1);
        return;
      }
      if (!isFileSaveShortcut(event)) {
        return;
      }
      event.preventDefault();
      void saveActiveTab();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [saveActiveTab]);

  const closeTab = async (filePath: string) => {
    const tab = tabsRef.current.find((item) => item.filePath === filePath);
    if (tab?.isDirty) {
      const choice = await confirmSingleUnsaved(tab.fileName);
      if (choice === "cancel") {
        return;
      }
      if (choice === "save") {
        const saved = await saveTabByPath(filePath);
        if (!saved) {
          return;
        }
      }
    }
    openFilePathsRef.current.delete(filePath);
    deleteCodeEditorViewState(projectId, filePath);
    setTabs((currentTabs) => {
      const remaining = currentTabs.filter(
        (item) => item.filePath !== filePath,
      );
      if (activePathRef.current === filePath) {
        const nextActivePath =
          remaining[remaining.length - 1]?.filePath ?? null;
        activateFilePath(nextActivePath);
      }
      return remaining;
    });
  };

  const handleSelectRoot = async (root: CodeWorkspaceRoot) => {
    if (root.path === selectedRoot?.path) {
      return;
    }
    if (tabsRef.current.some((tab) => tab.isDirty)) {
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
    selectRoot(root);
  };

  return (
    <>
      <WorkspaceShell
        ariaLabel={messages.agentsFeature.codeTab}
        loadingBranchText={messages.agentsFeature.loadingCode}
        roots={shell.roots}
        selectedRoot={selectedRoot}
        onSelectRoot={handleSelectRoot}
        sidebarWidth={shell.sidebarWidth}
        onBeginResize={shell.beginResize}
        branchBarTrailing={
          <button
            type="button"
            className="code-workspace__refresh"
            aria-label={messages.agentsFeature.toggleContentSearch}
            aria-pressed={sidebarMode === "search"}
            onClick={() =>
              setSidebarMode((current) =>
                current === "search" ? "fileTree" : "search",
              )
            }
          >
            <Search aria-hidden="true" size={14} strokeWidth={1.8} />
          </button>
        }
        sidebar={
          sidebarMode === "search" ? (
            <CodeSearchPanel
              state={contentSearch}
              onChange={setContentSearch}
              projectId={projectId}
              workspacePath={selectedRootWorkspacePath}
              fileTree={tree}
              onOpenMatch={openMatchFromSearch}
              queryFocusRequest={queryFocusRequest}
            />
          ) : (
            <FileTreePanel
              changedFileKinds={changedFileKinds}
              directoryKinds={directoryKinds}
              errorMessage={treeError}
              fileTree={tree}
              initialOpenState={openFolders}
              isLoading={isTreeLoading}
              workspacePath={selectedRoot?.path}
              onOpenFile={openFile}
              onOpenStateChange={setOpenFolders}
            />
          )
        }
        main={
          <>
            <div className="code-workspace__tabs" role="tablist">
              {tabs.map((tab) => (
                <button
                  key={tab.filePath}
                  aria-selected={activePath === tab.filePath}
                  className="code-workspace__tab"
                  role="tab"
                  type="button"
                  onClick={() => {
                    activateFilePath(tab.filePath);
                    setTabs((current) =>
                      current.map((item) =>
                        item.filePath === tab.filePath
                          ? { ...item, lastActiveAt: Date.now() }
                          : item,
                      ),
                    );
                  }}
                >
                  <span>{tab.fileName}</span>
                  {tab.isDirty ? (
                    <span
                      aria-label={messages.agentsFeature.fileTabUnsaved}
                      className="code-workspace__tab-dirty"
                    />
                  ) : null}
                  <X
                    aria-label={messages.agentsFeature.closeTab(tab.fileName)}
                    size={13}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.filePath);
                    }}
                  />
                </button>
              ))}
            </div>
            {activeTab ? (
              <>
                <CodeBreadcrumb
                  filePath={activeTab.filePath}
                  tree={tree}
                  onOpenFile={openFile}
                  editToggle={{
                    disabled: !canEditCodeFileTab(activeTab),
                    label: messages.agentsFeature.toggleFileEdit,
                    onToggle: toggleActiveTabEditable,
                    pressed: activeTab.isEditable,
                    title: resolveEditDisabledTitle(
                      getCodeFileEditBlockReason(activeTab),
                      messages.agentsFeature,
                    ),
                  }}
                  markdownPreviewToggle={
                    isMarkdownPreviewable(activeTab)
                      ? {
                          label: messages.agentsFeature.toggleMarkdownPreview,
                          onToggle: () =>
                            setMarkdownViewMode((current) =>
                              current === "preview" ? "source" : "preview",
                            ),
                          pressed: markdownViewMode === "preview",
                        }
                      : null
                  }
                />
                <CodeContent
                  key={activeTab.filePath}
                  projectId={projectId}
                  tab={activeTab}
                  contentFontSize={contentFontSize}
                  messages={messages}
                  onContentChange={handleActiveTabContentChange}
                  revealRequest={revealRequest}
                  theme={theme}
                  unavailableReason={unavailableReason}
                  viewMode={
                    isMarkdownPreviewable(activeTab)
                      ? markdownViewMode
                      : "source"
                  }
                />
              </>
            ) : null}
          </>
        }
      />
      {alertDialog}
      {unsavedConfirmDialog}
    </>
  );
}
