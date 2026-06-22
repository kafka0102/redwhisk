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
import { Tree, type NodeRendererProps } from "react-arborist";

import type { WorkspaceFileTreeNode } from "./session-workspace-commands";

interface SessionFileTreePanelProps {
  errorMessage: string | null;
  fileTree: WorkspaceFileTreeNode[];
  isLoading: boolean;
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
}

export function SessionFileTreePanel({
  errorMessage,
  fileTree,
  isLoading,
  onOpenFile,
}: SessionFileTreePanelProps) {
  return (
    <div className="session-file-tree" aria-label="Project file tree">
      {errorMessage ? (
        <p className="session-side-panel__empty">{errorMessage}</p>
      ) : null}
      {fileTree.length === 0 && !errorMessage ? (
        <p className="session-side-panel__empty">
          {isLoading ? "正在加载文件树..." : "暂无文件。"}
        </p>
      ) : null}
      {fileTree.length > 0 ? (
        <Tree<WorkspaceFileTreeNode>
          aria-label="Project file tree"
          childrenAccessor="children"
          className="session-file-tree__arborist"
          data={fileTree}
          disableDrag
          disableDrop
          disableEdit
          height={600}
          idAccessor="id"
          indent={12}
          openByDefault={false}
          overscanCount={8}
          rowHeight={28}
          width="100%"
        >
          {(props) => <FileTreeRow {...props} onOpenFile={onOpenFile} />}
        </Tree>
      ) : null}
    </div>
  );
}

interface FileTreeRowProps extends NodeRendererProps<WorkspaceFileTreeNode> {
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
}

function FileTreeRow({ node, onOpenFile, style }: FileTreeRowProps) {
  const treeDepthStyle = {
    ...style,
    "--tree-depth": node.level,
  } as CSSProperties;

  if (node.data.kind === "directory") {
    return (
      <button
        aria-expanded={node.isOpen}
        className="session-file-tree__folder"
        style={treeDepthStyle}
        type="button"
        onClick={() => node.toggle()}
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
      className="session-file-tree__row"
      style={treeDepthStyle}
      type="button"
      onClick={() => onOpenFile(node.data)}
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
