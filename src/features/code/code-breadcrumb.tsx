import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  Lock,
  Pencil,
} from "lucide-react";
import { type CSSProperties, useCallback, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../components/ui";
import { FileTypeIcon } from "../../shared/workspace/file-tree-panel";
import { type WorkspaceFileTreeNode } from "../../shared/workspace/workspace-commands";

export interface CodeMarkdownPreviewToggle {
  label: string;
  onToggle: () => void;
  pressed: boolean;
}

export interface CodeEditToggle {
  disabled: boolean;
  label: string;
  onToggle: () => void;
  pressed: boolean;
  /** 禁用时展示原因（title / 辅助提示）。 */
  title?: string;
}

export function CodeBreadcrumb({
  filePath,
  tree,
  onOpenFile,
  editToggle = null,
  markdownPreviewToggle = null,
}: {
  filePath: string;
  tree: WorkspaceFileTreeNode[];
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
  editToggle?: CodeEditToggle | null;
  markdownPreviewToggle?: CodeMarkdownPreviewToggle | null;
}) {
  // 受控弹层：同一时间只展开一个目录段。打开文件后立即关闭，回到面包屑。
  const [openCrumb, setOpenCrumb] = useState<string | null>(null);
  const segments = filePath.split("/");
  return (
    <div className="code-workspace__breadcrumb-row">
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
      {editToggle ? (
        <button
          type="button"
          className="code-workspace__edit-toggle"
          aria-label={editToggle.label}
          aria-pressed={editToggle.pressed}
          data-state={editToggle.pressed ? "editing" : "readonly"}
          disabled={editToggle.disabled}
          title={editToggle.title}
          onClick={editToggle.onToggle}
        >
          {editToggle.pressed ? (
            <Pencil aria-hidden="true" size={14} strokeWidth={1.9} />
          ) : (
            <Lock aria-hidden="true" size={14} strokeWidth={1.9} />
          )}
        </button>
      ) : null}
      {markdownPreviewToggle ? (
        <button
          type="button"
          className="code-workspace__markdown-toggle"
          aria-label={markdownPreviewToggle.label}
          aria-pressed={markdownPreviewToggle.pressed}
          onClick={markdownPreviewToggle.onToggle}
        >
          {markdownPreviewToggle.pressed ? (
            <EyeOff aria-hidden="true" size={14} strokeWidth={1.9} />
          ) : (
            <Eye aria-hidden="true" size={14} strokeWidth={1.9} />
          )}
        </button>
      ) : null}
    </div>
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
