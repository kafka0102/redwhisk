import { WorkspaceChangesPanels } from "../../shared/workspace/workspace-changes-panels";
import type {
  WorkspaceChangedFile,
  WorkspaceCommitChangedFile,
  WorkspaceCommitRecord,
} from "./session-workspace-commands";

interface SessionChangesPanelProps {
  changes: WorkspaceChangedFile[];
  commitHistory: WorkspaceCommitRecord[];
  isWorktree: boolean;
  commitHistoryErrorMessage: string | null;
  errorMessage: string | null;
  isCommitHistoryLoading: boolean;
  isLoading: boolean;
  isUncommittedExpanded: boolean;
  isCommittedExpanded: boolean;
  onToggleUncommittedExpanded: () => void;
  onToggleCommittedExpanded: () => void;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
  onOpenCommittedChangedFile: (
    commitHash: string,
    file: WorkspaceCommitChangedFile,
  ) => void;
}

export function SessionChangesPanel({
  changes,
  commitHistory,
  isWorktree,
  commitHistoryErrorMessage,
  errorMessage,
  isCommitHistoryLoading,
  isLoading,
  isUncommittedExpanded,
  isCommittedExpanded,
  onToggleUncommittedExpanded,
  onToggleCommittedExpanded,
  onOpenChangedFile,
  onOpenCommittedChangedFile,
}: SessionChangesPanelProps) {
  return (
    <WorkspaceChangesPanels
      changes={changes}
      isChangesLoading={isLoading}
      changesErrorMessage={errorMessage}
      isUncommittedExpanded={isUncommittedExpanded}
      onToggleUncommittedExpanded={onToggleUncommittedExpanded}
      onOpenChangedFile={onOpenChangedFile}
      commitHistory={commitHistory}
      isCommitHistoryLoading={isCommitHistoryLoading}
      commitHistoryErrorMessage={commitHistoryErrorMessage}
      isWorktree={isWorktree}
      isCommittedExpanded={isCommittedExpanded}
      onToggleCommittedExpanded={onToggleCommittedExpanded}
      onOpenCommittedChangedFile={onOpenCommittedChangedFile}
    />
  );
}
