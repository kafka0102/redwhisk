import {
  Cloud,
  FileIcon,
  FilePenLine,
  FilePlus,
  FileX,
  Files,
  GitBranch,
} from "lucide-react";
import { useCallback, useState } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../../components/ui/context-menu";
import { useI18n } from "../i18n/i18n";
import { toast } from "../toast";
import { openCommitOnGithub } from "./open-commit-on-github";
import type { WorkspaceGithubRemote } from "./workspace-commands";
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

interface CommitContextMenuState {
  commit: WorkspaceCommitRecord;
  x: number;
  y: number;
}

interface CommittedChangesTimelineProps {
  commits: WorkspaceCommitRecord[];
  errorMessage: string | null;
  expandedCommitHashes: Set<string>;
  isWorktree: boolean;
  isLoading: boolean;
  // worktree 场景下解析出的分叉基分支名；非 worktree / 主分支 / 解析失败时为 null。
  // 由父层从 getProjectWorktreeCommitHistory 响应透传，用于首条黄色提交右侧渲染
  // 黄色 base Tag（spec F3/F5）。
  baseBranch?: string | null;
  onOpenCommittedChangedFile: (
    commitHash: string,
    file: WorkspaceCommitChangedFile,
  ) => void;
  /** 提交上下文菜单「打开更改」；后续多 diff 视图由上层接线。 */
  onOpenCommitChanges?: (commit: WorkspaceCommitRecord) => void;
  /** 可解析的 github.com remote；有值时显示「在 GitHub 上打开」，与 isPushed 无关。 */
  githubRemote?: WorkspaceGithubRemote | null;
  onToggleCommit: (hash: string) => void;
}

export function CommittedChangesTimeline({
  commits,
  errorMessage,
  expandedCommitHashes,
  isWorktree,
  isLoading,
  baseBranch,
  onOpenCommittedChangedFile,
  onOpenCommitChanges,
  githubRemote = null,
  onToggleCommit,
}: CommittedChangesTimelineProps) {
  const { messages } = useI18n();
  const [menu, setMenu] = useState<CommitContextMenuState | null>(null);

  const handleCopy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard?.writeText(text);
        toast.success(messages.agentsFeature.copiedToClipboard);
      } catch {
        // 剪贴板写入失败时静默忽略，与文件树 / terminal 既有处理一致。
      }
    },
    [messages.agentsFeature.copiedToClipboard],
  );

  const handleOpenCommitChanges = useCallback(
    (commit: WorkspaceCommitRecord) => {
      onOpenCommitChanges?.(commit);
      // 「打开更改」顺带展开；已展开则保持，避免 toggle 收起。
      if (!expandedCommitHashes.has(commit.hash)) {
        onToggleCommit(commit.hash);
      }
    },
    [expandedCommitHashes, onOpenCommitChanges, onToggleCommit],
  );

  const handleOpenOnGithub = useCallback(
    async (commit: WorkspaceCommitRecord) => {
      if (!githubRemote) {
        return;
      }
      const outcome = await openCommitOnGithub({
        owner: githubRemote.owner,
        repo: githubRemote.repo,
        commitHash: commit.hash,
      });
      if (outcome === "not_found") {
        toast.error(messages.agentsFeature.commitNotFoundOnGithub);
        return;
      }
      if (outcome === "network_error" || outcome === "open_failed") {
        toast.error(messages.agentsFeature.openCommitOnGithubNetworkError);
      }
    },
    [
      githubRemote,
      messages.agentsFeature.commitNotFoundOnGithub,
      messages.agentsFeature.openCommitOnGithubNetworkError,
    ],
  );

  if (commits.length === 0) {
    if (errorMessage) {
      return <p className="session-side-panel__empty">{errorMessage}</p>;
    }
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
  // base Tag 落在 worktree 模式下首条黄色提交（fork point / merge-base）。仅在
  // baseBranch 提供时计算，否则保持 -1 完全不影响 pushed Tag 现状（spec F3）。
  const firstBaseTagIndex = baseBranch
    ? commits.findIndex((commit) => !commit.isCreatedInWorktree)
    : -1;
  const showBaseTagAt = firstBaseTagIndex >= 0 ? firstBaseTagIndex : -1;
  // F4 共存：当首条黄色提交同时是首条已 push 提交时，base Tag 占右侧位，pushed Tag
  // 顺延到其后首个已 push 提交；不同 commit 时各自显示；无 baseBranch 时不变。
  let pushedTagIndex = firstPushedIndex;
  if (showBaseTagAt >= 0 && showBaseTagAt === firstPushedIndex) {
    pushedTagIndex = commits.findIndex(
      (commit, i) => i > showBaseTagAt && commit.isPushed && commit.pushedTo,
    );
  }

  return (
    <>
      {errorMessage ? (
        <p className="session-side-panel__empty">{errorMessage}</p>
      ) : null}
      <ol
        aria-label={messages.agentsFeature.committedTimeline}
        className="session-commit-timeline"
      >
        {commits.map((commit, index) => {
          const isExpanded = expandedCommitHashes.has(commit.hash);
          const showBaseTag = index === showBaseTagAt;
          const showPushedTag = index === pushedTagIndex;
          return (
            <li className="session-commit-timeline__item" key={commit.hash}>
              <span
                className="session-commit-timeline__rail"
                aria-hidden="true"
              >
                <span
                  className={`session-commit-timeline__dot${getCommitTimelineDotModifier(commit, isWorktree)}`}
                />
              </span>
              <button
                aria-expanded={isExpanded}
                className="session-commit-row"
                type="button"
                onClick={() => onToggleCommit(commit.hash)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({
                    commit,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
              >
                <span className="session-commit-row__content">
                  <span className="session-commit-row__message">
                    {commit.message || commit.shortHash}
                  </span>
                  <span className="session-commit-row__author">
                    {commit.authorName}
                  </span>
                </span>
                {showBaseTag && baseBranch ? (
                  <span
                    aria-label={messages.agentsFeature.baseBranchTag}
                    className="session-commit-row__base-tag"
                    title={messages.agentsFeature.baseBranchTag}
                  >
                    <GitBranch aria-hidden="true" size={11} strokeWidth={1.8} />
                    <span>{baseBranch}</span>
                  </span>
                ) : null}
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
      <ContextMenu
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMenu(null);
          }
        }}
      >
        <ContextMenuContent anchor={menu ? { x: menu.x, y: menu.y } : null}>
          <ContextMenuItem
            onClick={() => {
              if (menu) {
                handleOpenCommitChanges(menu.commit);
              }
            }}
          >
            {messages.agentsFeature.openCommitChanges}
          </ContextMenuItem>
          {githubRemote ? (
            <ContextMenuItem
              onClick={() => {
                if (menu) {
                  void handleOpenOnGithub(menu.commit);
                }
              }}
            >
              {messages.agentsFeature.openCommitOnGithub}
            </ContextMenuItem>
          ) : null}
          {githubRemote ? <ContextMenuSeparator /> : null}
          <ContextMenuItem
            onClick={() => {
              if (menu) {
                void handleCopy(menu.commit.hash);
              }
            }}
          >
            {messages.agentsFeature.copyCommitId}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              if (menu) {
                void handleCopy(menu.commit.message);
              }
            }}
          >
            {messages.agentsFeature.copyCommitMessage}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
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
