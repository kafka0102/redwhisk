import { invokeCommand } from "../../shared/commands/command-client";
import type {
  ProjectWorkspaceInput,
  ProjectWorkspacePathInput,
} from "../../shared/workspace/workspace-commands";

// 共享的文件树 / 文件读取 / Code 根 API 与类型。agents 内部继续从本模块 re-export，
// 避免 session 侧大规模改 import；CodeWorkspace 应直接从 shared/workspace 引用。
export type {
  CodeWorkspaceRoot,
  CodeWorkspaceRootsResponse,
  CodeWorkspaceRootsUpdatedEvent,
  ProjectWorktreeFileTreeResponse,
  ProjectWorkspaceInput,
  ProjectWorkspacePathInput,
  WorkspaceFileContent,
  WorkspaceFileTreeNode,
} from "../../shared/workspace/workspace-commands";
export {
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT,
  getProjectWorktreeFileTree,
  listCodeWorkspaceRoots,
  readProjectWorktreeFile,
} from "../../shared/workspace/workspace-commands";

export type WorkspaceChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "binary";

export interface WorkspaceChangedFile {
  filePath: string;
  oldPath?: string | null;
  fileName: string;
  kind: WorkspaceChangeKind;
  status: string;
  additions: number;
  deletions: number;
  isBinary: boolean;
  contentHash: string;
  metadataSignature: string;
}

export type WorkspaceCommitStatus =
  | "A"
  | "M"
  | "D"
  | "R"
  | "C"
  | "T"
  | "U"
  | "X";

export interface WorkspaceCommitChangedFile {
  filePath: string;
  oldPath?: string | null;
  fileName: string;
  kind: WorkspaceChangeKind;
  status: WorkspaceCommitStatus;
}

export interface WorkspaceCommitRecord {
  hash: string;
  shortHash: string;
  message: string;
  authorName: string;
  committedAt: number;
  files: WorkspaceCommitChangedFile[];
  isPushed: boolean;
  pushedTo?: string | null;
  isCreatedInWorktree: boolean;
}

export interface ProjectWorktreeChangesResponse {
  files: WorkspaceChangedFile[];
  signature: string;
}

export interface ProjectWorktreeCommitHistoryResponse {
  commits: WorkspaceCommitRecord[];
  signature: string;
  isWorktree: boolean;
}

export interface WorkspaceDiffContent {
  filePath: string;
  oldPath?: string | null;
  kind: WorkspaceChangeKind;
  language?: string | null;
  originalContent: string;
  modifiedContent: string;
  isBinary: boolean;
  isTooLarge: boolean;
}

export function getProjectWorktreeChanges(
  input: ProjectWorkspaceInput,
): Promise<ProjectWorktreeChangesResponse> {
  return invokeCommand<ProjectWorktreeChangesResponse>(
    "get_project_worktree_changes",
    { input },
  );
}

export function getProjectWorktreeCommitHistory(
  input: ProjectWorkspaceInput,
): Promise<ProjectWorktreeCommitHistoryResponse> {
  return invokeCommand<ProjectWorktreeCommitHistoryResponse>(
    "get_project_worktree_commit_history",
    { input },
  );
}

export function readProjectWorktreeDiff(
  input: ProjectWorkspacePathInput,
): Promise<WorkspaceDiffContent> {
  return invokeCommand<WorkspaceDiffContent>("read_project_worktree_diff", {
    input,
  });
}
