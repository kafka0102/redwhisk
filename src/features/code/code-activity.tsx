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
import {
  readProjectWorktreeFile,
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
import {
  type CodeFileTab,
  clearCodeEditorViewStates,
  codeWorkspaceCache,
  deleteCodeEditorViewState,
} from "./code-workspace-cache";
import {
  isMarkdownPreviewable,
  resolveFileLoadErrorMessage,
} from "./code-workspace-helpers";
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
  const cached = codeWorkspaceCache.get(projectId);
  const [tabs, setTabs] = useState<CodeFileTab[]>(() => cached?.tabs ?? []);
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

  const { tree, treeError, isTreeLoading, changedFileKinds } =
    useCodeWorkspaceFileTree(projectId, selectedRootWorkspacePath, true);

  // 切回代码页时复检已打开文件：缓存内容先展示，再异步校验是否被删除。
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
          return {
            ...tab,
            content: result.content,
            errorMessage: result.errorMessage,
            isLoading: false,
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

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.filePath === activePath) ?? null,
    [activePath, tabs],
  );

  const activateFilePath = useCallback((filePath: string | null) => {
    activePathRef.current = filePath;
    setActivePath(filePath);
    // 换文件/关 tab 后回到默认源码视图（不跨文件记忆）。
    setMarkdownViewMode("source");
  }, []);

  const openFile = useCallback(
    (file: WorkspaceFileTreeNode) => {
      if (!selectedRoot || file.kind !== "file") return;
      const now = Date.now();
      const previousActivePath = activePathRef.current;
      const isAlreadyOpen = openFilePathsRef.current.has(file.path);
      openFilePathsRef.current.add(file.path);
      activateFilePath(file.path);
      setTabs((currentTabs) => {
        const existing = currentTabs.find((tab) => tab.filePath === file.path);
        if (existing) {
          return currentTabs.map((tab) =>
            tab.filePath === file.path ? { ...tab, lastActiveAt: now } : tab,
          );
        }
        const nextTab: CodeFileTab = {
          content: null,
          errorMessage: null,
          fileName: file.name,
          filePath: file.path,
          isLoading: true,
          lastActiveAt: now,
        };
        const retained =
          currentTabs.length < MAX_FILE_TABS
            ? currentTabs
            : currentTabs.filter(
                (tab) =>
                  tab.filePath !==
                  currentTabs
                    .filter(
                      (candidate) => candidate.filePath !== previousActivePath,
                    )
                    .sort(
                      (left, right) => left.lastActiveAt - right.lastActiveAt,
                    )[0]?.filePath,
              );
        const evicted = currentTabs.filter((tab) => !retained.includes(tab));
        if (evicted.length > 0) {
          for (const tab of evicted) {
            openFilePathsRef.current.delete(tab.filePath);
            deleteCodeEditorViewState(projectId, tab.filePath);
          }
        }
        return [...retained, nextTab];
      });
      if (isAlreadyOpen) return;
      void readProjectWorktreeFile({
        projectId,
        workspacePath: selectedRoot.path,
        filePath: file.path,
      })
        .then((content) => {
          setTabs((currentTabs) =>
            currentTabs.map((tab) =>
              tab.filePath === file.path
                ? { ...tab, content, errorMessage: null, isLoading: false }
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
    [activateFilePath, fileNotFoundMessage, projectId, selectedRoot, t],
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isContentSearchShortcut(event)) {
        return;
      }
      event.preventDefault();
      setSidebarMode("search");
      setQueryFocusRequest((token) => token + 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const closeTab = (filePath: string) => {
    openFilePathsRef.current.delete(filePath);
    deleteCodeEditorViewState(projectId, filePath);
    setTabs((currentTabs) => {
      const remaining = currentTabs.filter((tab) => tab.filePath !== filePath);
      if (activePathRef.current === filePath) {
        const nextActivePath =
          remaining[remaining.length - 1]?.filePath ?? null;
        activateFilePath(nextActivePath);
      }
      return remaining;
    });
  };

  return (
    <WorkspaceShell
      ariaLabel={messages.agentsFeature.codeTab}
      loadingBranchText={messages.agentsFeature.loadingCode}
      roots={shell.roots}
      selectedRoot={selectedRoot}
      onSelectRoot={selectRoot}
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
                revealRequest={revealRequest}
                theme={theme}
                viewMode={
                  isMarkdownPreviewable(activeTab) ? markdownViewMode : "source"
                }
              />
            </>
          ) : null}
        </>
      }
    />
  );
}
