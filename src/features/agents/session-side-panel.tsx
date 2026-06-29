import { SessionChangesPanel } from "./session-changes-panel";
import { SessionFileTreePanel } from "./session-file-tree-panel";
import { useI18n } from "../../shared/i18n/i18n";
import type {
  WorkspaceCommitChangedFile,
  WorkspaceCommitRecord,
  WorkspaceChangedFile,
  WorkspaceFileTreeNode,
} from "./session-workspace-commands";
import type { SessionSidePanelTab } from "./session-workspace-types";

interface SessionSidePanelProps {
  activeTab: SessionSidePanelTab;
  changes: WorkspaceChangedFile[];
  changesErrorMessage: string | null;
  commitHistory: WorkspaceCommitRecord[];
  commitHistoryErrorMessage: string | null;
  fileTree: WorkspaceFileTreeNode[];
  fileTreeErrorMessage: string | null;
  isChangesLoading: boolean;
  isCommitHistoryLoading: boolean;
  isFileTreeLoading: boolean;
  onActiveTabChange: (tab: SessionSidePanelTab) => void;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
  onOpenCommittedChangedFile: (
    commitHash: string,
    file: WorkspaceCommitChangedFile,
  ) => void;
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
  onRefreshCommitHistory: () => void;
  onRefreshChanges: () => void;
}

export function SessionSidePanel({
  activeTab,
  changes,
  changesErrorMessage,
  commitHistory,
  commitHistoryErrorMessage,
  fileTree,
  fileTreeErrorMessage,
  isChangesLoading,
  isCommitHistoryLoading,
  isFileTreeLoading,
  onActiveTabChange,
  onOpenChangedFile,
  onOpenCommittedChangedFile,
  onOpenFile,
  onRefreshCommitHistory,
  onRefreshChanges,
}: SessionSidePanelProps) {
  const { messages } = useI18n();
  return (
    <aside
      className="session-side-panel"
      aria-label={messages.agentsFeature.sessionSidePanel}
    >
      <div className="session-side-panel__tabs" role="tablist">
        <button
          aria-selected={activeTab === "changes"}
          className="session-side-panel__tab"
          role="tab"
          type="button"
          onClick={() => onActiveTabChange("changes")}
        >
          {messages.agentsFeature.changes}
        </button>
        <button
          aria-selected={activeTab === "files"}
          className="session-side-panel__tab"
          role="tab"
          type="button"
          onClick={() => onActiveTabChange("files")}
        >
          {messages.agentsFeature.files}
        </button>
      </div>
      <div className="session-side-panel__content" role="tabpanel">
        {activeTab === "changes" ? (
          <SessionChangesPanel
            changes={changes}
            commitHistory={commitHistory}
            commitHistoryErrorMessage={commitHistoryErrorMessage}
            errorMessage={changesErrorMessage}
            isCommitHistoryLoading={isCommitHistoryLoading}
            isLoading={isChangesLoading}
            onOpenChangedFile={onOpenChangedFile}
            onOpenCommittedChangedFile={onOpenCommittedChangedFile}
            onRefreshCommitHistory={onRefreshCommitHistory}
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
