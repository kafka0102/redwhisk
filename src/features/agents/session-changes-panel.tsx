import {
  Check,
  ChevronDown,
  Circle,
  FileIcon,
  FilePenLine,
  FilePlus,
  FileX,
  Files,
  GitCommitHorizontal,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type {
  WorkspaceCommitChangedFile,
  WorkspaceCommitRecord,
  WorkspaceCommitStatus,
  WorkspaceChangedFile,
  WorkspaceChangeKind,
} from "./session-workspace-commands";
import { useI18n } from "../../shared/i18n/i18n";

type ChangeFilter = "committed" | "uncommitted";

interface SessionChangesPanelProps {
  changes: WorkspaceChangedFile[];
  commitHistory: WorkspaceCommitRecord[];
  commitHistoryErrorMessage: string | null;
  errorMessage: string | null;
  isCommitHistoryLoading: boolean;
  isLoading: boolean;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
  onRefreshCommitHistory: () => void;
  onRefreshChanges: () => void;
}

export function SessionChangesPanel({
  changes,
  commitHistory,
  commitHistoryErrorMessage,
  errorMessage,
  isCommitHistoryLoading,
  isLoading,
  onOpenChangedFile,
  onRefreshCommitHistory,
  onRefreshChanges,
}: SessionChangesPanelProps) {
  const { messages } = useI18n();
  const [filter, setFilter] = useState<ChangeFilter>("uncommitted");
  const [expandedCommitHashes, setExpandedCommitHashes] = useState<Set<string>>(
    () => new Set(),
  );
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  const filterLabel =
    filter === "uncommitted"
      ? messages.agentsFeature.uncommitted
      : messages.agentsFeature.committed;

  useEffect(() => {
    if (!isFilterOpen) {
      return;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      if (
        event.target instanceof Node &&
        filterRef.current?.contains(event.target)
      ) {
        return;
      }

      setIsFilterOpen(false);
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);

    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
    };
  }, [isFilterOpen]);

  return (
    <div className="session-changes-panel">
      <div className="session-side-panel__filter-row">
        <div className="session-change-filter" ref={filterRef}>
          <button
            aria-expanded={isFilterOpen}
            aria-haspopup="menu"
            className="session-change-filter__trigger"
            type="button"
            onClick={() => setIsFilterOpen((current) => !current)}
          >
            {filter === "uncommitted" ? (
              <Circle aria-hidden="true" size={13} strokeWidth={1.8} />
            ) : (
              <Check aria-hidden="true" size={13} strokeWidth={1.8} />
            )}
            <span>{filterLabel}</span>
            <ChevronDown aria-hidden="true" size={13} strokeWidth={1.8} />
          </button>
          {isFilterOpen ? (
            <div className="session-change-filter__menu" role="menu">
              <button
                aria-current={filter === "uncommitted" ? "true" : undefined}
                className="session-change-filter__item"
                role="menuitem"
                type="button"
                onClick={() => {
                  setFilter("uncommitted");
                  setIsFilterOpen(false);
                }}
              >
                <Circle aria-hidden="true" size={13} strokeWidth={1.8} />
                {messages.agentsFeature.uncommitted}
              </button>
              <button
                aria-current={filter === "committed" ? "true" : undefined}
                className="session-change-filter__item"
                role="menuitem"
                type="button"
                onClick={() => {
                  setFilter("committed");
                  setIsFilterOpen(false);
                  onRefreshCommitHistory();
                }}
              >
                <Check aria-hidden="true" size={13} strokeWidth={1.8} />
                {messages.agentsFeature.committed}
              </button>
            </div>
          ) : null}
        </div>
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
          {changes.map((file) => (
            <ChangedFileRow
              key={file.filePath}
              file={file}
              onOpenChangedFile={onOpenChangedFile}
            />
          ))}
        </div>
      ) : (
        <CommittedChangesTimeline
          commits={commitHistory}
          errorMessage={commitHistoryErrorMessage}
          expandedCommitHashes={expandedCommitHashes}
          isLoading={isCommitHistoryLoading}
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

interface CommittedChangesTimelineProps {
  commits: WorkspaceCommitRecord[];
  errorMessage: string | null;
  expandedCommitHashes: Set<string>;
  isLoading: boolean;
  onToggleCommit: (hash: string) => void;
}

function CommittedChangesTimeline({
  commits,
  errorMessage,
  expandedCommitHashes,
  isLoading,
  onToggleCommit,
}: CommittedChangesTimelineProps) {
  const { messages } = useI18n();

  if (errorMessage) {
    return <p className="session-side-panel__empty">{errorMessage}</p>;
  }

  if (commits.length === 0) {
    return (
      <p className="session-side-panel__empty">
        {isLoading
          ? messages.agentsFeature.loadingChanges
          : messages.agentsFeature.noCommittedChanges}
      </p>
    );
  }

  return (
    <ol
      aria-label={messages.agentsFeature.committedTimeline}
      className="session-commit-timeline"
    >
      {commits.map((commit) => {
        const isExpanded = expandedCommitHashes.has(commit.hash);
        return (
          <li className="session-commit-timeline__item" key={commit.hash}>
            <span className="session-commit-timeline__rail" aria-hidden="true">
              <span className="session-commit-timeline__dot" />
            </span>
            <button
              aria-expanded={isExpanded}
              className="session-commit-row"
              type="button"
              onClick={() => onToggleCommit(commit.hash)}
            >
              <GitCommitHorizontal
                aria-hidden="true"
                size={14}
                strokeWidth={1.8}
              />
              <span className="session-commit-row__content">
                <span className="session-commit-row__message">
                  {commit.message || commit.shortHash}
                </span>
                <span className="session-commit-row__author">
                  {commit.authorName}
                </span>
              </span>
            </button>
            {isExpanded ? (
              <ul className="session-commit-files">
                {commit.files.map((file) => (
                  <CommittedFileRow
                    file={file}
                    key={`${commit.hash}:${file.status}:${file.filePath}:${file.oldPath ?? ""}`}
                  />
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

interface CommittedFileRowProps {
  file: WorkspaceCommitChangedFile;
}

function CommittedFileRow({ file }: CommittedFileRowProps) {
  const parentPath = getParentPath(file.filePath);
  return (
    <li
      aria-label={`${file.fileName} ${parentPath} ${file.status}`}
      className="session-commit-file"
    >
      {renderCommitFileIcon(file.status)}
      <span className="session-commit-file__identity">
        <span className="session-commit-file__name">{file.fileName}</span>
        {parentPath ? (
          <span className="session-commit-file__path">{parentPath}</span>
        ) : null}
      </span>
      <span
        className={`session-commit-file__status ${getCommitStatusClassName(file.status)}`}
      >
        {file.status}
      </span>
    </li>
  );
}

interface ChangedFileRowProps {
  file: WorkspaceChangedFile;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
}

function ChangedFileRow({ file, onOpenChangedFile }: ChangedFileRowProps) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const kindLabel = formatChangeKindLabel(file.kind);

  return (
    <button
      className={`session-change-row${file.kind === "deleted" ? " session-change-row--deleted" : ""}`}
      type="button"
      onBlur={() => setIsTooltipVisible(false)}
      onClick={() => onOpenChangedFile(file)}
      onFocus={() => setIsTooltipVisible(true)}
      onMouseEnter={() => setIsTooltipVisible(true)}
      onMouseLeave={() => setIsTooltipVisible(false)}
    >
      <span className="session-change-row__name">
        <span>{file.fileName}</span>
        <span className="session-change-row__path">
          {getParentPath(file.filePath)}
        </span>
      </span>
      <span className="session-change-row__actions">
        <span className="session-change-row__label">{kindLabel}</span>
        <span className="session-change-row__stats">
          <span className="session-change-row__added">{`+${file.additions}`}</span>
          <span className="session-change-row__deleted">{`-${file.deletions}`}</span>
        </span>
      </span>
      {isTooltipVisible ? (
        <span className="session-change-row__tooltip" role="tooltip">
          {file.filePath}
        </span>
      ) : null}
    </button>
  );
}

function getParentPath(filePath: string): string {
  const lastSlashIndex = filePath.lastIndexOf("/");
  return lastSlashIndex >= 0 ? filePath.slice(0, lastSlashIndex) : "";
}

function formatChangeKindLabel(kind: WorkspaceChangeKind): string {
  switch (kind) {
    case "added":
    case "untracked":
      return "新增";
    case "deleted":
      return "删除";
    case "renamed":
      return "重命名";
    case "copied":
      return "复制";
    case "binary":
      return "二进制";
    case "modified":
      return "修改";
  }
}

function renderCommitFileIcon(status: WorkspaceCommitStatus) {
  const iconProps = {
    "aria-hidden": "true" as const,
    className: "session-commit-file__icon",
    size: 15,
    strokeWidth: 1.8,
  };

  switch (status) {
    case "A":
      return <FilePlus {...iconProps} />;
    case "D":
      return <FileX {...iconProps} />;
    case "R":
    case "C":
      return <Files {...iconProps} />;
    case "M":
      return <FilePenLine {...iconProps} />;
    case "T":
    case "U":
    case "X":
      return <FileIcon {...iconProps} />;
  }
}

function getCommitStatusClassName(status: WorkspaceCommitStatus): string {
  switch (status) {
    case "M":
      return "session-commit-file__status--modified";
    case "A":
      return "session-commit-file__status--added";
    case "R":
      return "session-commit-file__status--renamed";
    case "C":
      return "session-commit-file__status--copied";
    case "D":
      return "session-commit-file__status--deleted";
    case "T":
      return "session-commit-file__status--type-changed";
    case "U":
      return "session-commit-file__status--unmerged";
    case "X":
      return "session-commit-file__status--unknown";
  }
}
