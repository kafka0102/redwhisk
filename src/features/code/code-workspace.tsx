import { Editor } from "@monaco-editor/react";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown, ChevronRight, File, Folder, X } from "lucide-react";
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
import { useI18n } from "../../shared/i18n/i18n";
import { SessionFileTreePanel } from "../agents/session-file-tree-panel";
import {
  getProjectWorktreeFileTree,
  readProjectWorktreeFile,
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT,
  type CodeWorkspaceRoot,
  type CodeWorkspaceRootsUpdatedEvent,
  type WorkspaceFileContent,
  type WorkspaceFileTreeNode,
} from "../agents/session-workspace-commands";

const MAX_FILE_TABS = 10;

interface CodeFileTab {
  content: WorkspaceFileContent | null;
  errorMessage: string | null;
  fileName: string;
  filePath: string;
  isLoading: boolean;
  lastActiveAt: number;
}

interface CodeWorkspaceProps {
  projectId: number;
  roots: CodeWorkspaceRoot[];
}

export function CodeWorkspace({ projectId, roots }: CodeWorkspaceProps) {
  const { contentFontSize, messages, t } = useI18n();
  const [workspaceRoots, setWorkspaceRoots] =
    useState<CodeWorkspaceRoot[]>(roots);
  const [selectedRootPath, setSelectedRootPath] = useState<string | null>(
    () => selectInitialRoot(roots)?.path ?? null,
  );
  const [tree, setTree] = useState<WorkspaceFileTreeNode[]>([]);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [isTreeLoading, setIsTreeLoading] = useState(false);
  const [tabs, setTabs] = useState<CodeFileTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const activePathRef = useRef<string | null>(null);
  const openFilePathsRef = useRef(new Set<string>());

  const selectedRoot = useMemo(
    () =>
      workspaceRoots.find((root) => root.path === selectedRootPath) ??
      selectInitialRoot(workspaceRoots),
    [selectedRootPath, workspaceRoots],
  );

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

  useEffect(() => {
    if (!selectedRoot) return;
    let isCurrent = true;
    void Promise.resolve()
      .then(() => {
        if (!isCurrent) return null;
        setIsTreeLoading(true);
        setTreeError(null);
        return getProjectWorktreeFileTree({
          projectId,
          workspacePath: selectedRoot.path,
        });
      })
      .then((response) => {
        if (isCurrent && response) setTree(response.nodes);
      })
      .catch((error) => {
        if (isCurrent) setTreeError(t(error));
      })
      .finally(() => {
        if (isCurrent) setIsTreeLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [projectId, selectedRoot, t]);

  const selectRoot = (root: CodeWorkspaceRoot) => {
    openFilePathsRef.current.clear();
    activePathRef.current = null;
    setSelectedRootPath(root.path);
    setTabs([]);
    setActivePath(null);
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
                ? { ...tab, errorMessage: t(error), isLoading: false }
                : tab,
            ),
          );
        });
    },
    [projectId, selectedRoot, t],
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
        <SessionFileTreePanel
          errorMessage={treeError}
          fileTree={tree}
          isLoading={isTreeLoading}
          workspacePath={selectedRoot?.path}
          onOpenFile={openFile}
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
            />
          </>
        ) : (
          <p className="session-viewer-state">
            {messages.agentsFeature.selectFile}
          </p>
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
}: {
  tab: CodeFileTab;
  contentFontSize: number;
  messages: ReturnType<typeof useI18n>["messages"];
}) {
  if (tab.isLoading)
    return (
      <p className="session-viewer-state">
        {messages.agentsFeature.loadingFile}
      </p>
    );
  if (tab.errorMessage)
    return (
      <p className="session-viewer-state" role="alert">
        {tab.errorMessage}
      </p>
    );
  if (!tab.content || tab.content.isBinary || tab.content.isTooLarge)
    return (
      <p className="session-viewer-state">
        {tab.content?.isBinary
          ? messages.agentsFeature.binaryPreviewUnavailable
          : messages.agentsFeature.largeFilePreviewUnavailable}
      </p>
    );
  return (
    <Editor
      height="100%"
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
