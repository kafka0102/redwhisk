import { useState } from "react";

import { SessionChangesPanel } from "./session-changes-panel";
import { SessionFileTreePanel } from "./session-file-tree-panel";
import type { MockChangedFile, MockTreeNode } from "./session-mock-files";

type SidePanelTab = "changes" | "files";

interface SessionSidePanelProps {
  onOpenChangedFile: (file: MockChangedFile) => void;
  onOpenFile: (file: MockTreeNode) => void;
}

export function SessionSidePanel({
  onOpenChangedFile,
  onOpenFile,
}: SessionSidePanelProps) {
  const [activeTab, setActiveTab] = useState<SidePanelTab>("changes");

  return (
    <aside className="session-side-panel" aria-label="Session side panel">
      <div className="session-side-panel__tabs" role="tablist">
        <button
          aria-selected={activeTab === "changes"}
          className="session-side-panel__tab"
          role="tab"
          type="button"
          onClick={() => setActiveTab("changes")}
        >
          变更
        </button>
        <button
          aria-selected={activeTab === "files"}
          className="session-side-panel__tab"
          role="tab"
          type="button"
          onClick={() => setActiveTab("files")}
        >
          文件
        </button>
      </div>
      <div className="session-side-panel__content" role="tabpanel">
        {activeTab === "changes" ? (
          <SessionChangesPanel onOpenChangedFile={onOpenChangedFile} />
        ) : (
          <SessionFileTreePanel onOpenFile={onOpenFile} />
        )}
      </div>
    </aside>
  );
}
