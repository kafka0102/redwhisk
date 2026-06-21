import {
  FileCode2,
  FileJson2,
  FileText,
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
          openByDefault
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
      <FileTypeIcon extension={getFileExtension(node.data.name)} />
      <span>{node.data.name}</span>
    </button>
  );
}

interface FileTypeIconProps {
  extension: string;
}

function FileTypeIcon({ extension }: FileTypeIconProps) {
  const className = `session-file-tree__icon session-file-tree__icon--${extension}`;

  if (extension === "css") {
    return <SquareCode aria-hidden="true" className={className} size={15} />;
  }

  if (extension === "rs") {
    return <FileText aria-hidden="true" className={className} size={15} />;
  }

  if (extension === "vue") {
    return <FileCode2 aria-hidden="true" className={className} size={15} />;
  }

  if (extension === "ts") {
    return <FileJson2 aria-hidden="true" className={className} size={15} />;
  }

  return <FileCode2 aria-hidden="true" className={className} size={15} />;
}

function getFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf(".");
  return lastDotIndex >= 0 ? fileName.slice(lastDotIndex + 1) : "";
}
