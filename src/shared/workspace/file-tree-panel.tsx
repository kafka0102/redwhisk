import {
  ChevronDown,
  ChevronRight,
  FileArchive,
  FileBraces,
  FileCode2,
  FileCog,
  FileImage,
  FileJson2,
  FileTerminal,
  FileText,
  FileType,
  Folder,
  SquareCode,
} from "lucide-react";
import type { CSSProperties } from "react";
import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { Tree, type NodeRendererProps, type TreeApi } from "react-arborist";

import {
  fileTreeChildrenAccessor,
  fileTreeDirectoryAncestors,
} from "./file-tree-listings";
import type {
  WorkspaceChangeKind,
  WorkspaceFileTreeNode,
} from "./workspace-commands";
import {
  getChangeKindStatusClassName,
  getChangeKindStatusLabel,
} from "./workspace-change-status";
import { useI18n } from "../i18n/i18n";
import {
  WorkspacePathContextMenu,
  type WorkspacePathContextMenuTarget,
} from "./workspace-path-context-menu";

// react-arborist 的 Tree 需要数值高度做虚拟化。当无法测得真实高度时
// （如 jsdom 无布局、或视口尚未布局完成），回退到该高度保证 Tree 可渲染。
const FILE_TREE_FALLBACK_HEIGHT = 600;

export type FileTreeOpenState = Record<string, boolean>;

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
  const [menu, setMenu] = useState<WorkspacePathContextMenuTarget | null>(null);
  // 文件树数据异步到达前 viewport 不挂载；必须在 hasFileTree 变为 true 后
  // 再测量，否则首次 useLayoutEffect 会在 ref 仍为 null 时空跑并卡住 fallback 高度。
  const hasFileTree = fileTree.length > 0 && !errorMessage;

  const handleToggle = useCallback(
    (id: string) => {
      onDirectoryOpen?.(id);
      if (!onOpenStateChange) return;
      const openState = treeApiRef.current?.openState;
      if (openState) {
        onOpenStateChange({ ...openState });
      }
    },
    [onDirectoryOpen, onOpenStateChange],
  );

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
        displayName: node.name,
        relativePath: node.path,
        x,
        y,
      });
    },
    [],
  );

  const renderFileTreeRow = useCallback(
    (props: NodeRendererProps<WorkspaceFileTreeNode>) => (
      <FileTreeRow
        {...props}
        changedFileKinds={changedFileKinds}
        directoryKinds={directoryKinds}
        onOpenFile={onOpenFile}
        onContextMenuNode={handleContextMenuNode}
      />
    ),
    [changedFileKinds, directoryKinds, handleContextMenuNode, onOpenFile],
  );

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
            data={fileTree}
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
            onToggle={handleToggle}
          >
            {renderFileTreeRow}
          </Tree>
        </div>
      ) : null}
      <WorkspacePathContextMenu
        target={menu}
        workspacePath={workspacePath}
        onClose={() => setMenu(null)}
      />
    </div>
  );
});

interface FileTreeRowProps extends NodeRendererProps<WorkspaceFileTreeNode> {
  changedFileKinds?: ReadonlyMap<string, WorkspaceChangeKind>;
  directoryKinds?: ReadonlyMap<string, WorkspaceChangeKind>;
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
  onContextMenuNode: (
    node: WorkspaceFileTreeNode,
    x: number,
    y: number,
  ) => void;
}

function FileTreeRow({
  node,
  changedFileKinds,
  directoryKinds,
  onOpenFile,
  onContextMenuNode,
  style,
}: FileTreeRowProps) {
  const treeDepthStyle = {
    ...style,
    "--tree-depth": node.level,
  } as CSSProperties;

  if (node.data.kind === "directory") {
    const directoryKind = directoryKinds?.get(node.data.path);
    return (
      <button
        aria-expanded={node.isOpen}
        className={`session-file-tree__folder${node.data.isIgnored ? " session-file-tree__row--ignored" : ""}`}
        style={treeDepthStyle}
        type="button"
        onClick={() => node.toggle()}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenuNode(node.data, event.clientX, event.clientY);
        }}
      >
        {node.isOpen ? (
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
        <span className={fileTreeNameClassName(directoryKind)}>
          {node.data.name}
        </span>
      </button>
    );
  }

  const fileKind = changedFileKinds?.get(node.data.path);
  return (
    <button
      className={`session-file-tree__row${node.data.isIgnored ? " session-file-tree__row--ignored" : ""}`}
      style={treeDepthStyle}
      type="button"
      onClick={() => onOpenFile(node.data)}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenuNode(node.data, event.clientX, event.clientY);
      }}
    >
      <span
        aria-hidden="true"
        className="session-file-tree__chevron session-file-tree__chevron--placeholder"
      />
      <FileTypeIcon fileName={node.data.name} />
      <span className={fileTreeNameClassName(fileKind)}>{node.data.name}</span>
      {fileKind !== undefined ? <FileTreeStatusBadge kind={fileKind} /> : null}
    </button>
  );
}

/** 文件/目录名 class：基类 + 可选变更状态色。 */
function fileTreeNameClassName(kind: WorkspaceChangeKind | undefined): string {
  if (kind === undefined) {
    return "session-file-tree__name";
  }
  return `session-file-tree__name ${getChangeKindStatusClassName(kind)}`;
}

/** 文件树行尾的变更状态徽标：复用变更视图的 A/M/D 字样与配色（绿 A、金黄 M、红 D）。 */
export function FileTreeStatusBadge({ kind }: { kind: WorkspaceChangeKind }) {
  return (
    <span
      aria-label={getChangeKindStatusLabel(kind)}
      className={`session-file-tree__status ${getChangeKindStatusClassName(kind)}`}
    >
      {getChangeKindStatusLabel(kind)}
    </span>
  );
}

export function FileTypeIcon({ fileName }: { fileName: string }) {
  const extension = getFileExtension(fileName);
  const className = `session-file-tree__icon session-file-tree__icon--${extension || "plain"}`;

  switch (extension) {
    case "css":
    case "scss":
    case "sass":
    case "less":
      return <SquareCode aria-hidden="true" className={className} size={15} />;
    case "html":
    case "vue":
    case "svelte":
      return <FileCode2 aria-hidden="true" className={className} size={15} />;
    case "json":
    case "jsonc":
    case "lock":
      return <FileJson2 aria-hidden="true" className={className} size={15} />;
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "rs":
    case "go":
    case "py":
    case "java":
    case "kt":
    case "swift":
      return <FileBraces aria-hidden="true" className={className} size={15} />;
    case "md":
    case "mdx":
    case "txt":
      return <FileText aria-hidden="true" className={className} size={15} />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
      return <FileImage aria-hidden="true" className={className} size={15} />;
    case "zip":
    case "gz":
    case "tar":
      return <FileArchive aria-hidden="true" className={className} size={15} />;
    case "sh":
    case "zsh":
    case "bash":
      return (
        <FileTerminal aria-hidden="true" className={className} size={15} />
      );
    case "toml":
    case "yaml":
    case "yml":
    case "env":
      return <FileCog aria-hidden="true" className={className} size={15} />;
    case "":
      return <FileText aria-hidden="true" className={className} size={15} />;
    default:
      return <FileType aria-hidden="true" className={className} size={15} />;
  }
}

function getFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf(".");
  return lastDotIndex >= 0 ? fileName.slice(lastDotIndex + 1) : "";
}
