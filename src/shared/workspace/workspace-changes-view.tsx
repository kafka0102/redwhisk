import {
  Cloud,
  FileIcon,
  FilePenLine,
  FilePlus,
  FileX,
  Files,
} from "lucide-react";
import { useState } from "react";

import { useI18n } from "../i18n/i18n";
import type {
  WorkspaceChangedFile,
  WorkspaceCommitChangedFile,
  WorkspaceCommitRecord,
  WorkspaceCommitStatus,
} from "./workspace-commands";
import {
  getChangeKindStatusClassName,
  getChangeKindStatusLabel,
} from "./workspace-change-status";

interface CommittedChangesTimelineProps {
  commits: WorkspaceCommitRecord[];
  errorMessage: string | null;
  expandedCommitHashes: Set<string>;
  isWorktree: boolean;
  isLoading: boolean;
  onOpenCommittedChangedFile: (
    commitHash: string,
    file: WorkspaceCommitChangedFile,
  ) => void;
  onToggleCommit: (hash: string) => void;
}

export function CommittedChangesTimeline({
  commits,
  errorMessage,
  expandedCommitHashes,
  isWorktree,
  isLoading,
  onOpenCommittedChangedFile,
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

  const firstPushedIndex = commits.findIndex(
    (commit) => commit.isPushed && commit.pushedTo,
  );

  return (
    <ol
      aria-label={messages.agentsFeature.committedTimeline}
      className="session-commit-timeline"
    >
      {commits.map((commit, index) => {
        const isExpanded = expandedCommitHashes.has(commit.hash);
        const showPushedTag = index === firstPushedIndex;
        return (
          <li className="session-commit-timeline__item" key={commit.hash}>
            <span className="session-commit-timeline__rail" aria-hidden="true">
              <span
                className={`session-commit-timeline__dot${getCommitTimelineDotModifier(commit, isWorktree)}`}
              />
            </span>
            <button
              aria-expanded={isExpanded}
              className="session-commit-row"
              type="button"
              onClick={() => onToggleCommit(commit.hash)}
            >
              <span className="session-commit-row__content">
                <span className="session-commit-row__message">
                  {commit.message || commit.shortHash}
                </span>
                <span className="session-commit-row__author">
                  {commit.authorName}
                </span>
              </span>
              {showPushedTag ? (
                <span
                  aria-label={messages.agentsFeature.pushedToRemote}
                  className="session-commit-row__remote-tag"
                  title={messages.agentsFeature.pushedToRemote}
                >
                  <Cloud aria-hidden="true" size={11} strokeWidth={1.8} />
                  <span>{commit.pushedTo}</span>
                </span>
              ) : null}
            </button>
            {isExpanded ? (
              <ul className="session-commit-files">
                {commit.files.map((file) => (
                  <CommittedFileRow
                    commitHash={commit.hash}
                    file={file}
                    key={`${commit.hash}:${file.status}:${file.filePath}:${file.oldPath ?? ""}`}
                    onOpenCommittedChangedFile={onOpenCommittedChangedFile}
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

// timeline 圆点着色修饰类：worktree 场景按是否当前 worktree 创建区分蓝/橘黄；
// 非 worktree 场景按是否已 push 到远端区分紫/蓝。
function getCommitTimelineDotModifier(
  commit: WorkspaceCommitRecord,
  isWorktree: boolean,
): string {
  if (isWorktree) {
    return commit.isCreatedInWorktree
      ? ""
      : " session-commit-timeline__dot--other-worktree";
  }
  return commit.isPushed ? " session-commit-timeline__dot--pushed" : "";
}

interface CommittedFileRowProps {
  commitHash: string;
  file: WorkspaceCommitChangedFile;
  onOpenCommittedChangedFile: (
    commitHash: string,
    file: WorkspaceCommitChangedFile,
  ) => void;
}

function CommittedFileRow({
  commitHash,
  file,
  onOpenCommittedChangedFile,
}: CommittedFileRowProps) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const parentPath = getParentPath(file.filePath);
  return (
    <li>
      <button
        aria-label={`${file.fileName} ${parentPath} ${file.status}`}
        className="session-commit-file"
        type="button"
        onBlur={() => setIsTooltipVisible(false)}
        onClick={() => onOpenCommittedChangedFile(commitHash, file)}
        onFocus={() => setIsTooltipVisible(true)}
        onMouseEnter={() => setIsTooltipVisible(true)}
        onMouseLeave={() => setIsTooltipVisible(false)}
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
        {isTooltipVisible ? (
          <span className="session-commit-file__tooltip" role="tooltip">
            {file.filePath}
          </span>
        ) : null}
      </button>
    </li>
  );
}

interface ChangedFileRowProps {
  file: WorkspaceChangedFile;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
}

export function ChangedFileRow({
  file,
  onOpenChangedFile,
}: ChangedFileRowProps) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const kindStatus = getChangeKindStatusLabel(file.kind);
  const kindStatusClassName = getChangeKindStatusClassName(file.kind);

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
        <span className="session-change-row__stats">
          <span className="session-change-row__added">{`+${file.additions}`}</span>
          <span className="session-change-row__deleted">{`-${file.deletions}`}</span>
        </span>
        <span
          className={`session-change-row__status session-commit-file__status ${kindStatusClassName}`}
        >
          {kindStatus}
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
