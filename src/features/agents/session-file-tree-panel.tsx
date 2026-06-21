import {
  FileCode2,
  FileJson2,
  FileText,
  Folder,
  SquareCode,
} from "lucide-react";
import type { CSSProperties } from "react";

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
  const files = flattenFileTree(fileTree);

  return (
    <div className="session-file-tree" aria-label="Project file tree">
      {errorMessage ? (
        <p className="session-side-panel__empty">{errorMessage}</p>
      ) : null}
      {files.length === 0 && !errorMessage ? (
        <p className="session-side-panel__empty">
          {isLoading ? "正在加载文件树..." : "暂无文件。"}
        </p>
      ) : null}
      {files.map(({ depth, node }) =>
        node.kind === "directory" ? (
          <div
            key={node.id}
            className="session-file-tree__folder"
            style={{ "--tree-depth": depth } as CSSProperties}
          >
            <Folder aria-hidden="true" size={15} strokeWidth={1.8} />
            {node.name}
          </div>
        ) : (
          <button
            key={node.id}
            className="session-file-tree__row"
            style={{ "--tree-depth": depth } as CSSProperties}
            type="button"
            onClick={() => onOpenFile(node)}
          >
            <FileTypeIcon extension={getFileExtension(node.name)} />
            <span>{node.name}</span>
          </button>
        ),
      )}
    </div>
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

function flattenFileTree(
  nodes: WorkspaceFileTreeNode[],
  depth = 0,
): Array<{ depth: number; node: WorkspaceFileTreeNode }> {
  return nodes.flatMap((node) => [
    { depth, node },
    ...flattenFileTree(node.children ?? [], depth + 1),
  ]);
}

function getFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf(".");
  return lastDotIndex >= 0 ? fileName.slice(lastDotIndex + 1) : "";
}
