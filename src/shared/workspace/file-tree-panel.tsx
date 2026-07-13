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
import { Tree, type NodeRendererProps } from "react-arborist";

import type { WorkspaceFileTreeNode } from "./workspace-commands";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
} from "../../components/ui/context-menu";
import { toast } from "../toast";
import { useI18n } from "../i18n/i18n";

// react-arborist 的 Tree 需要数值高度做虚拟化。当无法测得真实高度时
// （如 jsdom 无布局、或视口尚未布局完成），回退到该高度保证 Tree 可渲染。
const FILE_TREE_FALLBACK_HEIGHT = 600;

export interface FileTreePanelProps {
  errorMessage: string | null;
  fileTree: WorkspaceFileTreeNode[];
  isLoading: boolean;
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
  // worktree / 代码根的绝对路径，用于拼接「复制绝对路径」。为空时隐藏绝对路径菜单项。
  workspacePath?: string | null;
}

interface FileTreeContextMenuState {
  node: WorkspaceFileTreeNode;
  x: number;
  y: number;
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
  isLoading,
  onOpenFile,
  workspacePath,
}: FileTreePanelProps) {
  const { messages } = useI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(
    FILE_TREE_FALLBACK_HEIGHT,
  );
  const [menu, setMenu] = useState<FileTreeContextMenuState | null>(null);
  // 文件树数据异步到达前 viewport 不挂载；必须在 hasFileTree 变为 true 后
  // 再测量，否则首次 useLayoutEffect 会在 ref 仍为 null 时空跑并卡住 fallback 高度。
  const hasFileTree = fileTree.length > 0 && !errorMessage;

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
      setMenu({ node, x, y });
    },
    [],
  );

  const renderFileTreeRow = useCallback(
    (props: NodeRendererProps<WorkspaceFileTreeNode>) => (
      <FileTreeRow
        {...props}
        onOpenFile={onOpenFile}
        onContextMenuNode={handleContextMenuNode}
      />
    ),
    [handleContextMenuNode, onOpenFile],
  );

  const handleCopy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard?.writeText(text);
        toast.success(messages.agentsFeature.copiedToClipboard);
      } catch {
        // 剪贴板写入失败时静默忽略，与 terminal 的既有处理保持一致。
      }
    },
    [messages.agentsFeature.copiedToClipboard],
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
            aria-label={messages.agentsFeature.fileTree}
            childrenAccessor="children"
            className="session-file-tree__arborist"
            data={fileTree}
            disableDrag
            disableDrop
            disableEdit
            height={viewportHeight}
            idAccessor="id"
            indent={12}
            openByDefault={false}
            overscanCount={8}
            rowHeight={28}
            width="100%"
          >
            {renderFileTreeRow}
          </Tree>
        </div>
      ) : null}
      <ContextMenu
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMenu(null);
          }
        }}
      >
        <ContextMenuContent anchor={menu ? { x: menu.x, y: menu.y } : null}>
          <ContextMenuItem
            onClick={() => {
              if (menu) {
                void handleCopy(menu.node.name);
              }
            }}
          >
            {messages.agentsFeature.copyFileName}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              if (menu) {
                void handleCopy(menu.node.path);
              }
            }}
          >
            {messages.agentsFeature.copyRelativePath}
          </ContextMenuItem>
          {workspacePath ? (
            <ContextMenuItem
              onClick={() => {
                if (menu) {
                  void handleCopy(
                    joinWorkspacePath(workspacePath, menu.node.path),
                  );
                }
              }}
            >
              {messages.agentsFeature.copyAbsolutePath}
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
});

interface FileTreeRowProps extends NodeRendererProps<WorkspaceFileTreeNode> {
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
  onContextMenuNode: (
    node: WorkspaceFileTreeNode,
    x: number,
    y: number,
  ) => void;
}

function FileTreeRow({
  node,
  onOpenFile,
  onContextMenuNode,
  style,
}: FileTreeRowProps) {
  const treeDepthStyle = {
    ...style,
    "--tree-depth": node.level,
  } as CSSProperties;

  if (node.data.kind === "directory") {
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
        <span>{node.data.name}</span>
      </button>
    );
  }

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
      <FileTypeIcon extension={getFileExtension(node.data.name)} />
      <span>{node.data.name}</span>
    </button>
  );
}

// 拼接 worktree 根的绝对路径与相对路径，去掉根末尾的多余分隔符避免出现 `//`。
function joinWorkspacePath(
  workspacePath: string,
  relativePath: string,
): string {
  return `${workspacePath.replace(/\/+$/, "")}/${relativePath}`;
}

interface FileTypeIconProps {
  extension: string;
}

function FileTypeIcon({ extension }: FileTypeIconProps) {
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
