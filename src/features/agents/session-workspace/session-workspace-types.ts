import type {
  WorkspaceCommitChangedFile,
  WorkspaceChangedFile,
  WorkspaceFileContent,
} from "./session-workspace-commands";
import type { WorkspaceDiffTab } from "../../../shared/workspace/diff-viewer";
import type { MultiDiffViewState } from "../../../shared/workspace/multi-diff-types";

export interface SessionWorkspaceFile {
  fileName: string;
  filePath: string;
}

export interface SessionWorkspaceFileTab extends SessionWorkspaceFile {
  content: WorkspaceFileContent | null;
  isLoading: boolean;
  errorMessage: string | null;
}

/** Session 变更类 tab：单文件 diff 与提交全部更改互斥共用同一槽位。 */
export type SessionWorkspaceChangeTab =
  | SessionWorkspaceSingleFileChangeTab
  | SessionWorkspaceMultiDiffChangeTab;

export interface SessionWorkspaceSingleFileChangeTab extends WorkspaceDiffTab {
  mode: "file";
  change: WorkspaceChangedFile | WorkspaceCommitChangedFile;
  commitHash?: string | null;
}

export interface SessionWorkspaceMultiDiffChangeTab {
  mode: "multi";
  /** 短 hash + 空格 + 提交主题行（UI 层 CSS 截断过长文本）。 */
  label: string;
  commitHash: string;
  multiDiff: MultiDiffViewState;
}

export type SessionWorkspaceToolTabKind =
  | `terminal:${number}`
  | `browser:${number}`;
export type SessionWorkspaceTabKind =
  | "session"
  | "file"
  | "changes"
  | SessionWorkspaceToolTabKind;
export type SessionSidePanelTab = "issue" | "changes" | "files";

/** 组装提交全部更改 tab 标签：`短 hash + 空格 + 主题行`；无主题时仅短 hash。 */
export function formatCommitChangeTabLabel(
  shortHash: string,
  message: string,
): string {
  const subject = message.trim();
  return subject.length > 0 ? `${shortHash} ${subject}` : shortHash;
}

export function isSingleFileChangeTab(
  tab: SessionWorkspaceChangeTab | null | undefined,
): tab is SessionWorkspaceSingleFileChangeTab {
  return tab?.mode === "file";
}

export function isMultiDiffChangeTab(
  tab: SessionWorkspaceChangeTab | null | undefined,
): tab is SessionWorkspaceMultiDiffChangeTab {
  return tab?.mode === "multi";
}

export function getChangeTabLabel(tab: SessionWorkspaceChangeTab): string {
  return tab.mode === "multi" ? tab.label : tab.fileName;
}
