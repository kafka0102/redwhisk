import {
  FileCode2,
  FileJson2,
  FileText,
  Folder,
  SquareCode,
} from "lucide-react";
import type { CSSProperties } from "react";

import { MOCK_FILE_TREE, type MockTreeNode } from "./session-mock-files";

interface SessionFileTreePanelProps {
  onOpenFile: (file: MockTreeNode) => void;
}

export function SessionFileTreePanel({
  onOpenFile,
}: SessionFileTreePanelProps) {
  return (
    <div className="session-file-tree" aria-label="Project file tree">
      <div className="session-file-tree__folder">
        <Folder aria-hidden="true" size={15} strokeWidth={1.8} />
        src
      </div>
      <div className="session-file-tree__folder session-file-tree__folder--nested">
        <Folder aria-hidden="true" size={15} strokeWidth={1.8} />
        features / agents
      </div>
      {MOCK_FILE_TREE.map((file) => (
        <button
          key={file.filePath}
          className="session-file-tree__row"
          style={{ "--tree-depth": file.depth } as CSSProperties}
          type="button"
          onClick={() => onOpenFile(file)}
        >
          <FileTypeIcon extension={file.extension} />
          <span>{file.fileName}</span>
        </button>
      ))}
    </div>
  );
}

interface FileTypeIconProps {
  extension: MockTreeNode["extension"];
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
