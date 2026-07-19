import { Editor } from "@monaco-editor/react";
import { ChevronDown, ChevronRight, Folder, X } from "lucide-react";
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
  FileTypeIcon,
  type FileTreeOpenState,
} from "../../shared/workspace/file-tree-panel";
import {
  readProjectWorktreeFile,
  type CodeWorkspaceRoot,
  type WorkspaceFileTreeNode,
} from "../../shared/workspace/workspace-commands";
import { DiffViewer } from "../../shared/workspace/diff-viewer";
import { WorkspaceChangesPanels } from "../../shared/workspace/workspace-changes-panels";
import {
  codeWorkspaceStateCache,
  type CodeFileTab,
  type CodeWorkspaceView,
} from "./code-workspace-cache";
import { useCodeWorkspaceDiff } from "./use-code-workspace-diff";
import { useCodeWorkspaceFileTree } from "./use-code-workspace-file-tree";
import { useCodeWorkspaceRoots } from "./use-code-workspace-roots";
import {
  useChangesAutoRefresh,
  useWorktreeRunningSession,
} from "../changes/use-changes-auto-refresh";
import { useCodeWorkspaceChanges } from "../changes/use-code-workspace-changes";

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
  /** 左栏视图：由父层 Activity 受控传入，「代码」传 "files"，「变更」传 "changes"。 */
  view: CodeWorkspaceView;
}

export function CodeWorkspace({ projectId, roots, view }: CodeWorkspaceProps) {
  const { contentFontSize, messages, theme, t } = useI18n();
  const cachedState = codeWorkspaceStateCache.get(projectId);
  const [selectedRootPath, setSelectedRootPath] = useState<string | null>(
    () =>
      cachedState?.selectedRootPath ?? selectInitialRoot(roots)?.path ?? null,
  );
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
  const [uncommittedChangesExpanded, setUncommittedChangesExpanded] = useState(
    () => cachedState?.uncommittedChangesExpanded ?? true,
  );
  const [committedChangesExpanded, setCommittedChangesExpanded] = useState(
    () => cachedState?.committedChangesExpanded ?? true,
  );
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const activePathRef = useRef<string | null>(cachedState?.activePath ?? null);
  const openFilePathsRef = useRef(
    new Set((cachedState?.tabs ?? []).map((tab) => tab.filePath)),
  );
  const fileNotFoundMessage = messages.agentsFeature.fileNotFound;

  // 分支下拉数据：首帧用 roots 快照，挂载拉取 + 事件 + 定时轮询接管，
  // 修正「在其它 Activity 期间 worktree 增删导致快照过期、分支缺失」。
  const { roots: workspaceRoots } = useCodeWorkspaceRoots(
    projectId,
    roots,
    true,
  );

  const selectedRoot = useMemo(
    () =>
      workspaceRoots.find((root) => root.path === selectedRootPath) ??
      selectInitialRoot(workspaceRoots),
    [selectedRootPath, workspaceRoots],
  );

  const selectedRootWorkspacePath = selectedRoot?.path ?? null;

  useEffect(() => {
    codeWorkspaceStateCache.set(projectId, {
      activePath,
      openFolders,
      selectedRootPath,
      sidebarWidth,
      tabs,
      uncommittedChangesExpanded,
      committedChangesExpanded,
    });
  }, [
    activePath,
    openFolders,
    projectId,
    selectedRootPath,
    sidebarWidth,
    tabs,
    uncommittedChangesExpanded,
    committedChangesExpanded,
  ]);

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );

  // 变更视图数据：进入变更视图或切换工作区时拉取一次；条件轮询由下方
  // useChangesAutoRefresh 按可见性 × running turn 驱动，复用本 hook 的 refresh*。
  const {
    changes: workspaceChanges,
    isChangesLoading,
    changesErrorMessage,
    isChangesUnavailable,
    commitHistory,
    isCommitHistoryLoading,
    commitHistoryErrorMessage,
    isWorktree,
    refreshChanges,
    refreshCommitHistory,
  } = useCodeWorkspaceChanges(
    projectId,
    selectedRootWorkspacePath,
    view === "changes",
  );

  // 条件轮询：仅 changes 视图启用。running 标志经 listAgentSessions 全量过滤 +
  // agent-session-list-changed 事件重算得出；files 视图 enabled=false 不订阅、不轮询。
  const isWorktreeRunning = useWorktreeRunningSession(
    projectId,
    selectedRootWorkspacePath,
    view === "changes",
  );
  useChangesAutoRefresh({
    enabled: view === "changes",
    running: isWorktreeRunning,
    refreshChanges,
    refreshCommitHistory,
    isUnavailable: isChangesUnavailable,
  });

  // 变更页右侧单 diff 面板取数。view 切换不卸载本组件，diffTab 跨 code↔changes 保留；
  // 切换 root 时由 selectRoot 调 clear() 清空（diff 绑定具体 workspacePath）。
  const {
    diffTab,
    openChange: openDiffChange,
    openCommittedChange: openCommittedDiff,
    clear: clearDiff,
  } = useCodeWorkspaceDiff(projectId, selectedRootWorkspacePath);

  // files 视图文件树数据源：VS Code 式自动检测——进入视图 / 切根强制拉取，可见时
  // 5s 定时轮询（signature 去重），变更数据驱动文件树 A/M/D 徽标。轮询替代手动刷新。
  const { tree, treeError, isTreeLoading, changedFileKinds } =
    useCodeWorkspaceFileTree(
      projectId,
      selectedRootWorkspacePath,
      view === "files",
    );

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

  const selectRoot = useCallback(
    (root: CodeWorkspaceRoot) => {
      openFilePathsRef.current.clear();
      activePathRef.current = null;
      setSelectedRootPath(root.path);
      setTabs([]);
      setActivePath(null);
      setOpenFolders({});
      clearDiff();
      // 文件树由 useCodeWorkspaceFileTree 在 workspacePath 变化时自动重拉。
    },
    [clearDiff],
  );

  // 异常处理：选中的 worktree 分支被删（roots 更新后不再存在）→ 自动切到默认分支
  // （项目根，即当前分支）；默认分支也不存在 → 清空选中与已打开内容，显示为空。
  // selectedRootPath 已为 null 时保持空态，不再自动挑选，避免与「显示为空」诉求冲突。
  // setState 放进微任务，避免 react-hooks/set-state-in-effect。
  useEffect(() => {
    if (selectedRootPath === null || workspaceRoots.length === 0) return;
    if (workspaceRoots.some((root) => root.path === selectedRootPath)) return;
    const projectRoot = workspaceRoots.find((root) => root.isProjectRoot);
    void Promise.resolve().then(() => {
      if (projectRoot) {
        selectRoot(projectRoot);
      } else {
        openFilePathsRef.current.clear();
        activePathRef.current = null;
        setSelectedRootPath(null);
        setTabs([]);
        setActivePath(null);
        setOpenFolders({});
        clearDiff();
      }
    });
  }, [workspaceRoots, selectedRootPath, selectRoot, clearDiff]);

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
        </div>
        {view === "files" ? (
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
        ) : (
          <WorkspaceChangesPanels
            changes={workspaceChanges}
            changesErrorMessage={changesErrorMessage}
            isChangesLoading={isChangesLoading}
            isUncommittedExpanded={uncommittedChangesExpanded}
            onOpenChangedFile={openDiffChange}
            onOpenCommittedChangedFile={openCommittedDiff}
            onToggleUncommittedExpanded={() =>
              setUncommittedChangesExpanded((current) => !current)
            }
            commitHistory={commitHistory}
            commitHistoryErrorMessage={commitHistoryErrorMessage}
            isCommitHistoryLoading={isCommitHistoryLoading}
            isWorktree={isWorktree}
            isCommittedExpanded={committedChangesExpanded}
            onToggleCommittedExpanded={() =>
              setCommittedChangesExpanded((current) => !current)
            }
          />
        )}
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
        {view === "changes" ? (
          <DiffViewer tab={diffTab} />
        ) : (
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
          </>
        )}
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
  // 受控弹层：同一时间只展开一个目录段。打开文件后立即关闭，回到面包屑。
  const [openCrumb, setOpenCrumb] = useState<string | null>(null);
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
              <DropdownMenu
                open={openCrumb === path}
                onOpenChange={(open) => setOpenCrumb(open ? path : null)}
              >
                <DropdownMenuTrigger className="code-workspace__crumb">
                  {segment}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[500px]">
                  <CodeBreadcrumbMenuTree
                    nodes={node.children ?? []}
                    onOpenFile={(file) => {
                      onOpenFile(file);
                      setOpenCrumb(null);
                    }}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// 面包屑目录弹层内的递归文件树：与左侧目录树一致的展开/收起交互与视觉，
// 目录点击切换展开（多级），文件点击打开。展开状态在弹层挂载期内自管，
// 关闭弹层后随 Popup 卸载重置。
function CodeBreadcrumbMenuTree({
  nodes,
  onOpenFile,
}: {
  nodes: WorkspaceFileTreeNode[];
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
}) {
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set());
  const toggleDir = useCallback((path: string) => {
    setOpenDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);
  return (
    <div className="code-workspace__crumb-tree" role="tree">
      {nodes.map((node) => (
        <CodeBreadcrumbMenuRow
          key={node.path}
          depth={0}
          node={node}
          openDirs={openDirs}
          toggleDir={toggleDir}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
}

function CodeBreadcrumbMenuRow({
  node,
  depth,
  openDirs,
  toggleDir,
  onOpenFile,
}: {
  node: WorkspaceFileTreeNode;
  depth: number;
  openDirs: Set<string>;
  toggleDir: (path: string) => void;
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
}) {
  const treeDepthStyle = { "--tree-depth": depth } as CSSProperties;
  if (node.kind === "directory") {
    const isOpen = openDirs.has(node.path);
    return (
      <div role="none">
        <button
          aria-expanded={isOpen}
          className={`session-file-tree__folder${node.isIgnored ? " session-file-tree__row--ignored" : ""}`}
          style={treeDepthStyle}
          type="button"
          onClick={() => toggleDir(node.path)}
        >
          {isOpen ? (
            <ChevronDown
              aria-hidden="true"
              className="session-file-tree__chevron"
              size={13}
              strokeWidth={2}
            />
          ) : (
            <ChevronRight
              aria-hidden="true"
              className="session-file-tree__chevron"
              size={13}
              strokeWidth={2}
            />
          )}
          <Folder aria-hidden="true" size={15} strokeWidth={1.8} />
          <span>{node.name}</span>
        </button>
        {isOpen && node.children && node.children.length > 0 ? (
          <div role="group">
            {node.children.map((child) => (
              <CodeBreadcrumbMenuRow
                key={child.path}
                depth={depth + 1}
                node={child}
                openDirs={openDirs}
                toggleDir={toggleDir}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <button
      className={`session-file-tree__row${node.isIgnored ? " session-file-tree__row--ignored" : ""}`}
      style={treeDepthStyle}
      type="button"
      onClick={() => onOpenFile(node)}
    >
      <span
        aria-hidden="true"
        className="session-file-tree__chevron session-file-tree__chevron--placeholder"
      />
      <FileTypeIcon fileName={node.name} />
      <span>{node.name}</span>
    </button>
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
  // 默认分支 = 项目根（即仓库当前分支）；项目根不存在时返回 null（显示为空），
  // 不回退到 roots[0]，与「默认分支不存在则显示为空」诉求一致。
  return roots.find((root) => root.isProjectRoot) ?? null;
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
