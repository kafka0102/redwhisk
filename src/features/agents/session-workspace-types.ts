import type {
  WorkspaceCommitChangedFile,
  WorkspaceChangedFile,
  WorkspaceFileContent,
} from "./session-workspace-commands";
import type { WorkspaceDiffTab } from "../../shared/workspace/diff-viewer";

export interface SessionWorkspaceFile {
  fileName: string;
  filePath: string;
}

export interface SessionWorkspaceFileTab extends SessionWorkspaceFile {
  content: WorkspaceFileContent | null;
  isLoading: boolean;
  errorMessage: string | null;
}

export interface SessionWorkspaceChangeTab extends WorkspaceDiffTab {
  change: WorkspaceChangedFile | WorkspaceCommitChangedFile;
  commitHash?: string | null;
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
