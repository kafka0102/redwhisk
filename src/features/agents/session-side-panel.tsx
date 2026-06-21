import { SessionChangesPanel } from "./session-changes-panel";
import { SessionFileTreePanel } from "./session-file-tree-panel";
import type {
  WorkspaceChangedFile,
  WorkspaceFileTreeNode,
} from "./session-workspace-commands";
import type { SessionSidePanelTab } from "./session-workspace-types";

interface SessionSidePanelProps {
  activeTab: SessionSidePanelTab;
  changes: WorkspaceChangedFile[];
  changesErrorMessage: string | null;
  fileTree: WorkspaceFileTreeNode[];
  fileTreeErrorMessage: string | null;
  isChangesLoading: boolean;
  isFileTreeLoading: boolean;
  onActiveTabChange: (tab: SessionSidePanelTab) => void;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
  onRefreshChanges: () => void;
}

export function SessionSidePanel({
  activeTab,
  changes,
  changesErrorMessage,
  fileTree,
  fileTreeErrorMessage,
  isChangesLoading,
  isFileTreeLoading,
  onActiveTabChange,
  onOpenChangedFile,
  onOpenFile,
  onRefreshChanges,
}: SessionSidePanelProps) {
  return (
    <aside className="session-side-panel" aria-label="Session side panel">
      <div className="session-side-panel__tabs" role="tablist">
        <button
          aria-selected={activeTab === "changes"}
          className="session-side-panel__tab"
          role="tab"
          type="button"
          onClick={() => onActiveTabChange("changes")}
        >
          变更
        </button>
        <button
          aria-selected={activeTab === "files"}
          className="session-side-panel__tab"
          role="tab"
          type="button"
          onClick={() => onActiveTabChange("files")}
        >
          文件
        </button>
      </div>
      <div className="session-side-panel__content" role="tabpanel">
        {activeTab === "changes" ? (
          <SessionChangesPanel
            changes={changes}
            errorMessage={changesErrorMessage}
            isLoading={isChangesLoading}
            onOpenChangedFile={onOpenChangedFile}
            onRefreshChanges={onRefreshChanges}
          />
        ) : (
          <SessionFileTreePanel
            errorMessage={fileTreeErrorMessage}
            fileTree={fileTree}
            isLoading={isFileTreeLoading}
            onOpenFile={onOpenFile}
          />
        )}
      </div>
    </aside>
  );
}
