import { Check, Circle, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useI18n } from "../../shared/i18n/i18n";
import {
  ChangedFileRow,
  CommittedChangesTimeline,
} from "../../shared/workspace/workspace-changes-view";
import type {
  WorkspaceChangedFile,
  WorkspaceCommitChangedFile,
  WorkspaceCommitRecord,
} from "./session-workspace-commands";

type ChangeFilter = "committed" | "uncommitted";

interface SessionChangesPanelProps {
  changes: WorkspaceChangedFile[];
  commitHistory: WorkspaceCommitRecord[];
  isWorktree: boolean;
  commitHistoryErrorMessage: string | null;
  errorMessage: string | null;
  isCommitHistoryLoading: boolean;
  isLoading: boolean;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
  onOpenCommittedChangedFile: (
    commitHash: string,
    file: WorkspaceCommitChangedFile,
  ) => void;
  onRefreshCommitHistory: () => void;
  onRefreshChanges: () => void;
}

export function SessionChangesPanel({
  changes,
  commitHistory,
  isWorktree,
  commitHistoryErrorMessage,
  errorMessage,
  isCommitHistoryLoading,
  isLoading,
  onOpenChangedFile,
  onOpenCommittedChangedFile,
  onRefreshCommitHistory,
  onRefreshChanges,
}: SessionChangesPanelProps) {
  const { messages } = useI18n();
  const [filter, setFilter] = useState<ChangeFilter>("uncommitted");
  const [expandedCommitHashes, setExpandedCommitHashes] = useState<Set<string>>(
    () => new Set(),
  );

  function handleFilterChange(next: ChangeFilter) {
    setFilter(next);
    if (next === "committed") {
      onRefreshCommitHistory();
    }
  }

  return (
    <div className="session-changes-panel">
      <div className="session-side-panel__filter-row">
        <Tabs
          className="session-change-filter"
          value={filter}
          onValueChange={(value) => handleFilterChange(value as ChangeFilter)}
        >
          <TabsList className="session-change-filter__list" variant="line">
            <TabsTrigger
              className="session-change-filter__tab"
              value="uncommitted"
            >
              <Circle aria-hidden="true" size={13} strokeWidth={1.8} />
              {messages.agentsFeature.uncommitted}
            </TabsTrigger>
            <TabsTrigger
              className="session-change-filter__tab"
              value="committed"
            >
              <Check aria-hidden="true" size={13} strokeWidth={1.8} />
              {messages.agentsFeature.committed}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <button
          aria-label={messages.agentsFeature.refreshChanges}
          className="session-side-panel__refresh"
          type="button"
          onClick={
            filter === "committed" ? onRefreshCommitHistory : onRefreshChanges
          }
        >
          <RefreshCw aria-hidden="true" size={15} strokeWidth={1.8} />
        </button>
      </div>
      {filter === "uncommitted" ? (
        <div className="session-changes-panel__list">
          {errorMessage ? (
            <p className="session-side-panel__empty">{errorMessage}</p>
          ) : null}
          {changes.length === 0 && !errorMessage ? (
            <p className="session-side-panel__empty">
              {isLoading
                ? messages.agentsFeature.loadingChanges
                : messages.agentsFeature.noUncommittedChanges}
            </p>
          ) : null}
          {!errorMessage
            ? changes.map((file) => (
                <ChangedFileRow
                  key={file.filePath}
                  file={file}
                  onOpenChangedFile={onOpenChangedFile}
                />
              ))
            : null}
        </div>
      ) : (
        <CommittedChangesTimeline
          commits={commitHistory}
          errorMessage={commitHistoryErrorMessage}
          expandedCommitHashes={expandedCommitHashes}
          isWorktree={isWorktree}
          isLoading={isCommitHistoryLoading}
          onOpenCommittedChangedFile={onOpenCommittedChangedFile}
          onToggleCommit={(hash) => {
            setExpandedCommitHashes((current) => {
              const next = new Set(current);
              if (next.has(hash)) {
                next.delete(hash);
              } else {
                next.add(hash);
              }
              return next;
            });
          }}
        />
      )}
    </div>
  );
}
