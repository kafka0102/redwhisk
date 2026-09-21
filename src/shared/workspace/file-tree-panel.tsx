import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { Tree, type NodeRendererProps, type TreeApi } from "react-arborist";

import {
  fileTreeChildrenAccessor,
  fileTreeDirectoryAncestors,
  parentFileTreeDirectory,
} from "./file-tree-listings";
import type {
  WorkspaceChangeKind,
  WorkspaceFileTreeNode,
} from "./workspace-commands";
import { useI18n } from "../i18n/i18n";
import {
  readFileTreeScrollOffset,
  restoreFileTreeScrollOffset,
  writeFileTreeScrollOffset,
} from "./file-tree-scroll-offset";
import {
  isFileTreeDraftNodeId,
  type FileTreeEntryCreateInput,
} from "./file-tree-create-draft";
import { FileTreeDraftRow, FileTreeRow } from "./file-tree-row";
import { useFileTreeCreateDraft } from "./use-file-tree-create-draft";
import {
  WorkspacePathContextMenu,
  type WorkspacePathContextMenuTarget,
} from "./workspace-path-context-menu";

// react-arborist 的 Tree 需要数值高度做虚拟化。当无法测得真实高度时
// （如 jsdom 无布局、或视口尚未布局完成），回退到该高度保证 Tree 可渲染。
const FILE_TREE_FALLBACK_HEIGHT = 600;

export type FileTreeOpenState = Record<string, boolean>;

/** 行右键菜单触发的删除目标：行自身（目录行 → 目录，文件行 → 文件）。 */
export interface FileTreeEntryDeleteInput {
  displayName: string;
  kind: WorkspaceFileTreeNode["kind"];
  /** 工作区相对路径。 */
  relativePath: string;
}

/** 面板自己的菜单目标：在共享菜单目标上补一份「新建落点目录」归因。 */
interface FileTreeMenuTarget extends WorkspacePathContextMenuTarget {
  /** 目录行 → 自身；文件行 → 其父目录；根级文件 → 代码根（""）。 */
  createDirectoryPath: string;
  /** 删除目标始终是行自身，故需要行的类型区分文件 / 目录。 */
  kind: WorkspaceFileTreeNode["kind"];
}

export interface FileTreePanelProps {
  errorMessage: string | null;
  fileTree: WorkspaceFileTreeNode[];
  /** 挂载时恢复的目录展开状态；仅作 initial，运行期由 arborist 自管。 */
  initialOpenState?: FileTreeOpenState;
  isLoading: boolean;
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
  /** 目录展开/折叠变化时回调，便于上层缓存切页后的结构。 */
  onOpenStateChange?: (openState: FileTreeOpenState) => void;
  /** 展开目录时按层拉取子节点。已加载的目录由调用方去重。 */
  onDirectoryOpen?: (directoryPath: string) => void;
  /**
   * 可选的行内新建能力：注入后目录行与文件行的右键菜单出现「新建文件 / 新建文件夹」。
   * 未注入时面板保持只读，菜单与行为与现状逐字一致。
   */
  onCreateEntry?: (input: FileTreeEntryCreateInput) => Promise<void>;
  /**
   * 可选的行删除能力：注入后目录行与文件行的右键菜单最下方出现「删除」。
   * 未注入时面板保持只读，菜单与行为与现状逐字一致。
   */
  onDeleteEntry?: (input: FileTreeEntryDeleteInput) => void;
  // worktree / 代码根的绝对路径，用于拼接「复制绝对路径」。为空时隐藏绝对路径菜单项。
  workspacePath?: string | null;
  /** 文件路径 → 变更类型（git status），用于文件名着色与行末 A/M/D 徽标。 */
  changedFileKinds?: ReadonlyMap<string, WorkspaceChangeKind>;
  /** 目录路径 → 聚合变更类型，仅用于目录名着色（不渲染汇总字母徽标）。 */
  directoryKinds?: ReadonlyMap<string, WorkspaceChangeKind>;
}

/**
 * 跨 surface 复用的工作区文件树（Agents session 侧栏与 CodeWorkspace 共用）。
 *
 * 用 React.memo 挡住父级高频重渲染（如 agent 流式事件）；点击响应依赖
 * `onOpenFile` 引用稳定，以及 Tree 行渲染器 identity 不被无意义刷新。
 */
export const FileTreePanel = memo(function FileTreePanel({
  errorMessage,
  fileTree,
  initialOpenState,
  isLoading,
  onOpenFile,
  onOpenStateChange,
  onDirectoryOpen,
  onCreateEntry,
  onDeleteEntry,
  workspacePath,
  changedFileKinds,
  directoryKinds,
}: FileTreePanelProps) {
  const { messages } = useI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const treeApiRef = useRef<TreeApi<WorkspaceFileTreeNode> | undefined>(
    undefined,
  );
  const [viewportHeight, setViewportHeight] = useState(
    FILE_TREE_FALLBACK_HEIGHT,
  );
  const [menu, setMenu] = useState<FileTreeMenuTarget | null>(null);
  const restoreKeyRef = useRef<string>("");
  const didRestoreScrollRef = useRef(false);
  // 文件树数据异步到达前 viewport 不挂载；必须在 hasFileTree 变为 true 后
  // 再测量，否则首次 useLayoutEffect 会在 ref 仍为 null 时空跑并卡住 fallback 高度。
  const hasFileTree = fileTree.length > 0 && !errorMessage;

  const syncOpenState = useCallback(() => {
    if (!onOpenStateChange) return;
    const openState = treeApiRef.current?.openState;
    if (openState) {
      onOpenStateChange({ ...openState });
    }
  }, [onOpenStateChange]);

  const handleToggle = useCallback(
    (id: string) => {
      onDirectoryOpen?.(id);
      syncOpenState();
    },
    [onDirectoryOpen, syncOpenState],
  );

  /** 新建目录成功后的落点：展开它（同时触发该层加载）并选中。 */
  const revealDirectory = useCallback(
    (directoryPath: string) => {
      treeApiRef.current?.open(directoryPath);
      treeApiRef.current?.select(directoryPath);
      syncOpenState();
    },
    [syncOpenState],
  );

  /** 新建草稿行的目标目录：先展开（根目录无节点，open 为 no-op）再触发该层加载。 */
  const openCreateTargetDirectory = useCallback(
    (directoryPath: string) => {
      treeApiRef.current?.open(directoryPath);
      onDirectoryOpen?.(directoryPath);
      syncOpenState();
    },
    [onDirectoryOpen, syncOpenState],
  );

  const { cancelDraft, draftError, startDraft, submitDraftName, treeData } =
    useFileTreeCreateDraft({
      fileTree,
      onCreateEntry,
      onDirectoryOpen: openCreateTargetDirectory,
      onRevealDirectory: revealDirectory,
    });

  const handleScroll = useCallback(
    (props: { scrollOffset: number; scrollUpdateWasRequested: boolean }) => {
      if (!props.scrollUpdateWasRequested) {
        didRestoreScrollRef.current = true;
      }
      if (workspacePath) {
        writeFileTreeScrollOffset(workspacePath, props.scrollOffset);
      }
    },
    [workspacePath],
  );

  useLayoutEffect(() => {
    if (!hasFileTree) {
      return;
    }
    const cacheKey = workspacePath ?? "";
    if (restoreKeyRef.current !== cacheKey) {
      restoreKeyRef.current = cacheKey;
      didRestoreScrollRef.current = false;
    }
    if (didRestoreScrollRef.current) {
      return;
    }
    const offset = cacheKey === "" ? 0 : readFileTreeScrollOffset(cacheKey);
    if (restoreFileTreeScrollOffset(treeApiRef.current, offset)) {
      didRestoreScrollRef.current = true;
    }
  }, [fileTree, hasFileTree, viewportHeight, workspacePath]);

  useLayoutEffect(() => {
    if (!onDirectoryOpen || initialOpenState == null) {
      return;
    }
    const paths = new Set<string>();
    for (const [id, isOpen] of Object.entries(initialOpenState)) {
      if (!isOpen) continue;
      for (const ancestor of fileTreeDirectoryAncestors(id)) {
        paths.add(ancestor);
      }
    }
    for (const path of paths) {
      onDirectoryOpen(path);
    }
  }, [initialOpenState, onDirectoryOpen]);

  // react-arborist 的 Tree 需要数值高度做虚拟化，无法直接用 `height: 100%`。
  // 这里测量视口容器的实际高度并随容器尺寸变化更新，让文件树填满侧栏可用高度，
  // 而不是写死固定像素（此前为 600px）。useLayoutEffect 在首帧绘制前完成首次
  // 测量，避免高度跳变闪烁。依赖 hasFileTree：从 loading/空态切到有数据时
  // viewport 才首次挂载，必须重新绑定 ResizeObserver。
  useLayoutEffect(() => {
    if (!hasFileTree) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const updateHeight = () => {
      const measured = viewport.clientHeight;
      setViewportHeight(measured > 0 ? measured : FILE_TREE_FALLBACK_HEIGHT);
    };
    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(updateHeight);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [hasFileTree]);

  const handleContextMenuNode = useCallback(
    (node: WorkspaceFileTreeNode, x: number, y: number) => {
      setMenu({
        createDirectoryPath:
          node.kind === "directory"
            ? node.path
            : parentFileTreeDirectory(node.path),
        displayName: node.name,
        kind: node.kind,
        relativePath: node.path,
        x,
        y,
      });
    },
    [],
  );

  const renderFileTreeRow = useCallback(
    (props: NodeRendererProps<WorkspaceFileTreeNode>) =>
      isFileTreeDraftNodeId(props.node.data.id) ? (
        <FileTreeDraftRow
          {...props}
          errorMessage={draftError?.message ?? null}
          errorRevision={draftError?.revision ?? 0}
          onCancel={cancelDraft}
          onSubmit={submitDraftName}
        />
      ) : (
        <FileTreeRow
          {...props}
          changedFileKinds={changedFileKinds}
          directoryKinds={directoryKinds}
          isMenuTarget={menu?.relativePath === props.node.data.path}
          onOpenFile={onOpenFile}
          onContextMenuNode={handleContextMenuNode}
        />
      ),
    [
      cancelDraft,
      changedFileKinds,
      directoryKinds,
      draftError?.message,
      draftError?.revision,
      handleContextMenuNode,
      menu?.relativePath,
      onOpenFile,
      submitDraftName,
    ],
  );

  const createActions =
    onCreateEntry && menu
      ? {
          onCreateDirectory: () =>
            startDraft({
              directoryPath: menu.createDirectoryPath,
              kind: "directory",
            }),
          onCreateFile: () =>
            startDraft({
              directoryPath: menu.createDirectoryPath,
              kind: "file",
            }),
        }
      : null;

  const deleteAction =
    onDeleteEntry && menu
      ? {
          onDelete: () =>
            onDeleteEntry({
              displayName: menu.displayName,
              kind: menu.kind,
              relativePath: menu.relativePath,
            }),
        }
      : null;

  return (
    <div
      className="session-file-tree"
      aria-label={messages.agentsFeature.fileTree}
    >
      {errorMessage ? (
        <p className="session-side-panel__empty">{errorMessage}</p>
      ) : null}
      {fileTree.length === 0 && !errorMessage ? (
        <p className="session-side-panel__empty">
          {isLoading
            ? messages.agentsFeature.loadingFileTree
            : messages.agentsFeature.noFiles}
        </p>
      ) : null}
      {hasFileTree ? (
        <div className="session-file-tree__viewport" ref={viewportRef}>
          <Tree<WorkspaceFileTreeNode>
            ref={treeApiRef}
            aria-label={messages.agentsFeature.fileTree}
            childrenAccessor={fileTreeChildrenAccessor}
            className="session-file-tree__arborist"
            data={treeData}
            disableDrag
            disableDrop
            disableEdit
            height={viewportHeight}
            idAccessor="id"
            indent={12}
            initialOpenState={initialOpenState}
            openByDefault={false}
            overscanCount={8}
            rowHeight={28}
            width="100%"
            onScroll={handleScroll}
            onToggle={handleToggle}
          >
            {renderFileTreeRow}
          </Tree>
        </div>
      ) : null}
      <WorkspacePathContextMenu
        target={menu}
        workspacePath={workspacePath}
        createActions={createActions}
        deleteAction={deleteAction}
        onClose={() => setMenu(null)}
      />
    </div>
  );
});
