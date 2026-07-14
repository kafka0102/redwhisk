import { Editor } from "@monaco-editor/react";
import { listen } from "@tauri-apps/api/event";
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  RefreshCw,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui";
import {
  getCommandErrorMessage,
  toCommandError,
} from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import {
  FileTreePanel,
  type FileTreeOpenState,
} from "../../shared/workspace/file-tree-panel";
import {
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT,
  getProjectWorktreeFileTree,
  readProjectWorktreeFile,
  type CodeWorkspaceRoot,
  type CodeWorkspaceRootsUpdatedEvent,
  type WorkspaceFileTreeNode,
} from "../../shared/workspace/workspace-commands";
import {
  codeWorkspaceStateCache,
  type CodeFileTab,
} from "./code-workspace-cache";

const MAX_FILE_TABS = 10;
const DEFAULT_SIDEBAR_WIDTH = 400;
const MISSING_FILE_ERROR_REASONS = new Set([
  "filePathInaccessible",
  "pathNotFile",
  "workspaceFileReadFailed",
]);

interface CodeWorkspaceProps {
  projectId: number;
  roots: CodeWorkspaceRoot[];
}

export function CodeWorkspace({ projectId, roots }: CodeWorkspaceProps) {
  const { contentFontSize, messages, theme, t } = useI18n();
  const cachedState = codeWorkspaceStateCache.get(projectId);
  const [workspaceRoots, setWorkspaceRoots] =
    useState<CodeWorkspaceRoot[]>(roots);
  const [selectedRootPath, setSelectedRootPath] = useState<string | null>(
    () =>
      cachedState?.selectedRootPath ?? selectInitialRoot(roots)?.path ?? null,
  );
  const [tree, setTree] = useState<WorkspaceFileTreeNode[]>(
    () => cachedState?.tree ?? [],
  );
  const [treeError, setTreeError] = useState<string | null>(
    () => cachedState?.treeError ?? null,
  );
  const [treeLoaded, setTreeLoaded] = useState(
    () => cachedState?.treeLoaded ?? false,
  );
  const [isTreeLoading, setIsTreeLoading] = useState(
    () => !(cachedState?.treeLoaded ?? false),
  );
  const [isTreeRefreshing, setIsTreeRefreshing] = useState(false);
  const [openFolders, setOpenFolders] = useState<FileTreeOpenState>(
    () => cachedState?.openFolders ?? {},
  );
  const [tabs, setTabs] = useState<CodeFileTab[]>(
    () => cachedState?.tabs ?? [],
  );
  const [activePath, setActivePath] = useState<string | null>(
    () => cachedState?.activePath ?? null,
  );
  const [sidebarWidth, setSidebarWidth] = useState(
    () => cachedState?.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH,
  );
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const activePathRef = useRef<string | null>(cachedState?.activePath ?? null);
  const openFilePathsRef = useRef(
    new Set((cachedState?.tabs ?? []).map((tab) => tab.filePath)),
  );
  const treeRequestSequenceRef = useRef(0);
  const fileNotFoundMessage = messages.agentsFeature.fileNotFound;

  const selectedRoot = useMemo(
    () =>
      workspaceRoots.find((root) => root.path === selectedRootPath) ??
      selectInitialRoot(workspaceRoots),
    [selectedRootPath, workspaceRoots],
  );

  useEffect(() => {
    codeWorkspaceStateCache.set(projectId, {
      activePath,
      openFolders,
      selectedRootPath,
      sidebarWidth,
      tabs,
      tree,
      treeError,
      treeLoaded,
    });
  }, [
    activePath,
    openFolders,
    projectId,
    selectedRootPath,
    sidebarWidth,
    tabs,
    tree,
    treeError,
    treeLoaded,
  ]);

  useEffect(() => {
    let isDisposed = false;
    let unlisten: (() => void) | null = null;
    void listen<CodeWorkspaceRootsUpdatedEvent>(
      CODE_WORKSPACE_ROOTS_UPDATED_EVENT,
      (event) => {
        if (event.payload.projectId === projectId) {
          setWorkspaceRoots(event.payload.roots);
        }
      },
    ).then((nextUnlisten) => {
      if (isDisposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });
    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, [projectId]);

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );

  const selectedRootWorkspacePath = selectedRoot?.path ?? null;
  const translateRef = useRef(t);
  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  // 已缓存且加载过的树直接复用，切页回来不强制重拉；换 root / 手动刷新另走入口。
  // setState 放进 Promise 微任务，避免 react-hooks/set-state-in-effect。
  // 依赖仅用 path 字符串 + treeLoaded，避免 t / root 对象引用抖动触发重复请求。
  useEffect(() => {
    if (!selectedRootWorkspacePath || treeLoaded) return;

    let isCurrent = true;
    const requestSequence = treeRequestSequenceRef.current + 1;
    treeRequestSequenceRef.current = requestSequence;
    const workspacePath = selectedRootWorkspacePath;

    void Promise.resolve()
      .then(() => {
        if (!isCurrent) return null;
        setIsTreeLoading(true);
        setTreeError(null);
        return getProjectWorktreeFileTree({
          projectId,
          workspacePath,
        });
      })
      .then((response) => {
        if (
          !isCurrent ||
          treeRequestSequenceRef.current !== requestSequence ||
          !response
        ) {
          return;
        }
        setTree(response.nodes);
        setTreeError(null);
        setTreeLoaded(true);
      })
      .catch((error) => {
        if (!isCurrent || treeRequestSequenceRef.current !== requestSequence) {
          return;
        }
        setTreeError(translateRef.current(error));
        setTreeLoaded(true);
      })
      .finally(() => {
        if (!isCurrent || treeRequestSequenceRef.current !== requestSequence) {
          return;
        }
        setIsTreeLoading(false);
        setIsTreeRefreshing(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [projectId, selectedRootWorkspacePath, treeLoaded]);

  const refreshTree = useCallback(() => {
    if (!selectedRootWorkspacePath || isTreeLoading || isTreeRefreshing) {
      return;
    }

    const requestSequence = treeRequestSequenceRef.current + 1;
    treeRequestSequenceRef.current = requestSequence;
    const workspacePath = selectedRootWorkspacePath;

    setIsTreeRefreshing(true);
    setTreeError(null);

    void getProjectWorktreeFileTree({
      projectId,
      workspacePath,
    })
      .then((response) => {
        if (treeRequestSequenceRef.current !== requestSequence) return;
        setTree(response.nodes);
        setTreeError(null);
        setTreeLoaded(true);
      })
      .catch((error) => {
        if (treeRequestSequenceRef.current !== requestSequence) return;
        setTreeError(translateRef.current(error));
        setTreeLoaded(true);
      })
      .finally(() => {
        if (treeRequestSequenceRef.current !== requestSequence) return;
        setIsTreeLoading(false);
        setIsTreeRefreshing(false);
      });
  }, [isTreeLoading, isTreeRefreshing, projectId, selectedRootWorkspacePath]);

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

  const selectRoot = (root: CodeWorkspaceRoot) => {
    openFilePathsRef.current.clear();
    activePathRef.current = null;
    treeRequestSequenceRef.current += 1;
    setSelectedRootPath(root.path);
    setTabs([]);
    setActivePath(null);
    setTree([]);
    setTreeError(null);
    setTreeLoaded(false);
    setIsTreeLoading(true);
    setIsTreeRefreshing(false);
    setOpenFolders({});
  };

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.filePath === activePath) ?? null,
    [activePath, tabs],
  );

  const openFile = useCallback(
    (file: WorkspaceFileTreeNode) => {
      if (!selectedRoot || file.kind !== "file") return;
      const now = Date.now();
      const previousActivePath = activePathRef.current;
      const isAlreadyOpen = openFilePathsRef.current.has(file.path);
      activePathRef.current = file.path;
      openFilePathsRef.current.add(file.path);
      setActivePath(file.path);
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
        currentTabs
          .filter((tab) => !retained.includes(tab))
          .forEach((tab) => openFilePathsRef.current.delete(tab.filePath));
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
    [fileNotFoundMessage, projectId, selectedRoot, t],
  );

  const closeTab = (filePath: string) => {
    openFilePathsRef.current.delete(filePath);
    setTabs((currentTabs) => {
      const remaining = currentTabs.filter((tab) => tab.filePath !== filePath);
      if (activePathRef.current === filePath) {
        const nextActivePath =
          remaining[remaining.length - 1]?.filePath ?? null;
        activePathRef.current = nextActivePath;
        setActivePath(nextActivePath);
      }
      return remaining;
    });
  };

  const beginResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
      setSidebarWidth(
        Math.min(640, Math.max(230, startWidth + moveEvent.clientX - startX)),
      );
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current?.();
    dragCleanupRef.current = onMouseUp;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <section
      className="code-workspace"
      aria-label={messages.agentsFeature.codeTab}
      style={{ "--code-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <aside className="code-workspace__sidebar">
        <div className="code-workspace__branch-bar">
          <DropdownMenu>
            <DropdownMenuTrigger className="code-workspace__branch">
              <span>
                {selectedRoot?.branch ?? messages.agentsFeature.loadingCode}
              </span>
              <ChevronDown aria-hidden="true" size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {workspaceRoots.map((root) => (
                <DropdownMenuItem
                  key={root.path}
                  onClick={() => selectRoot(root)}
                >
                  {root.branch}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            aria-label={messages.agentsFeature.refreshFileTree}
            className="code-workspace__refresh"
            disabled={!selectedRoot || isTreeLoading || isTreeRefreshing}
            type="button"
            onClick={refreshTree}
          >
            <RefreshCw
              aria-hidden="true"
              className={
                isTreeRefreshing
                  ? "code-workspace__refresh-icon--spin"
                  : undefined
              }
              size={15}
              strokeWidth={1.8}
            />
          </button>
        </div>
        <FileTreePanel
          errorMessage={treeError}
          fileTree={tree}
          initialOpenState={openFolders}
          isLoading={isTreeLoading}
          workspacePath={selectedRoot?.path}
          onOpenFile={openFile}
          onOpenStateChange={setOpenFolders}
        />
      </aside>
      <div
        className="code-workspace__splitter"
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={230}
        aria-valuemax={640}
        aria-valuenow={sidebarWidth}
        onMouseDown={beginResize}
      />
      <main className="code-workspace__main">
        <div className="code-workspace__tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.filePath}
              aria-selected={activePath === tab.filePath}
              className="code-workspace__tab"
              role="tab"
              type="button"
              onClick={() => {
                activePathRef.current = tab.filePath;
                setActivePath(tab.filePath);
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
            />
            <CodeContent
              tab={activeTab}
              contentFontSize={contentFontSize}
              messages={messages}
              theme={theme}
            />
          </>
        ) : null}
      </main>
    </section>
  );
}

function CodeBreadcrumb({
  filePath,
  tree,
  onOpenFile,
}: {
  filePath: string;
  tree: WorkspaceFileTreeNode[];
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
}) {
  const segments = filePath.split("/");
  return (
    <nav className="code-workspace__breadcrumb" aria-label={filePath}>
      {segments.map((segment, index) => {
        const path = segments.slice(0, index + 1).join("/");
        const node = findNode(tree, path);
        const isFile = index === segments.length - 1;
        return (
          <span key={path}>
            {index > 0 ? <ChevronRight aria-hidden="true" size={13} /> : null}
            {isFile || !node ? (
              <span>{segment}</span>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger className="code-workspace__crumb">
                  {segment}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {node.children?.map((child) => (
                    <DropdownMenuItem
                      key={child.path}
                      onClick={() => {
                        if (child.kind === "file") onOpenFile(child);
                      }}
                    >
                      <>
                        {child.kind === "directory" ? (
                          <Folder size={14} />
                        ) : (
                          <File size={14} />
                        )}
                        {child.name}
                      </>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function CodeContent({
  tab,
  contentFontSize,
  messages,
  theme,
}: {
  tab: CodeFileTab;
  contentFontSize: number;
  messages: ReturnType<typeof useI18n>["messages"];
  theme: "light" | "dark";
}) {
  if (tab.isLoading) {
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.loadingFile}
      </p>
    );
  }
  if (tab.errorMessage) {
    return (
      <p className="code-workspace__file-error" role="alert">
        {tab.errorMessage}
      </p>
    );
  }
  if (!tab.content) {
    return null;
  }
  if (tab.content.isBinary || tab.content.isTooLarge) {
    return (
      <p className="session-viewer-state">
        {tab.content.isBinary
          ? messages.agentsFeature.binaryPreviewUnavailable
          : messages.agentsFeature.largeFilePreviewUnavailable}
      </p>
    );
  }
  return (
    <Editor
      height="100%"
      theme={theme === "dark" ? "vs-dark" : "light"}
      language={tab.content.language ?? undefined}
      options={{
        readOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: contentFontSize,
      }}
      value={tab.content.content}
    />
  );
}

function findNode(
  nodes: WorkspaceFileTreeNode[],
  path: string,
): WorkspaceFileTreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const descendant = findNode(node.children ?? [], path);
    if (descendant) return descendant;
  }
  return null;
}

function selectInitialRoot(
  roots: CodeWorkspaceRoot[],
): CodeWorkspaceRoot | null {
  return roots.find((root) => root.isProjectRoot) ?? roots[0] ?? null;
}

function resolveFileLoadErrorMessage(
  error: unknown,
  fileNotFoundMessage: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (isMissingWorkspaceFileError(error)) {
    return fileNotFoundMessage;
  }
  return getCommandErrorMessage(error, t);
}

function isMissingWorkspaceFileError(error: unknown): boolean {
  const reason = toCommandError(error).reason;
  return reason != null && MISSING_FILE_ERROR_REASONS.has(reason);
}
