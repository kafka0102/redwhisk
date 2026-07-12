import type {
  WorkspaceCommitChangedFile,
  WorkspaceChangedFile,
  WorkspaceDiffContent,
  WorkspaceFileContent,
} from "./session-workspace-commands";

export interface SessionWorkspaceFile {
  fileName: string;
  filePath: string;
}

export interface SessionWorkspaceFileTab extends SessionWorkspaceFile {
  content: WorkspaceFileContent | null;
  isLoading: boolean;
  errorMessage: string | null;
}

export interface SessionWorkspaceChangeTab extends SessionWorkspaceFile {
  change: WorkspaceChangedFile | WorkspaceCommitChangedFile;
  commitHash?: string | null;
  diff: WorkspaceDiffContent | null;
  isLoading: boolean;
  errorMessage: string | null;
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
