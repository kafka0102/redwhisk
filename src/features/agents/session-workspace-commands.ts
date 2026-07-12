import { invokeCommand } from "../../shared/commands/command-client";

export type WorkspaceChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "binary";

export interface ProjectWorkspaceInput {
  projectId: number;
  sessionId?: number | null;
  workspacePath?: string | null;
}

export interface ProjectWorkspacePathInput extends ProjectWorkspaceInput {
  filePath: string;
  commitHash?: string | null;
}

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

export interface WorkspaceFileTreeNode {
  id: string;
  name: string;
  path: string;
  kind: "directory" | "file";
  children?: WorkspaceFileTreeNode[];
  sizeBytes?: number;
  modifiedAt?: number;
  isIgnored?: boolean;
}

export interface CodeWorkspaceRoot {
  branch: string;
  path: string;
  isProjectRoot: boolean;
}

export interface CodeWorkspaceRootsResponse {
  roots: CodeWorkspaceRoot[];
}

export const CODE_WORKSPACE_ROOTS_UPDATED_EVENT =
  "code-workspace-roots-updated";

export interface CodeWorkspaceRootsUpdatedEvent {
  projectId: number;
  roots: CodeWorkspaceRoot[];
}

export interface ProjectWorktreeFileTreeResponse {
  nodes: WorkspaceFileTreeNode[];
  signature: string;
}

export interface WorkspaceFileContent {
  filePath: string;
  language?: string | null;
  content: string;
  modifiedAt?: number | null;
  sizeBytes: number;
  isBinary: boolean;
  isTooLarge: boolean;
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

export function listCodeWorkspaceRoots(
  projectId: number,
): Promise<CodeWorkspaceRootsResponse> {
  return invokeCommand<CodeWorkspaceRootsResponse>(
    "list_code_workspace_roots",
    {
      projectId,
    },
  );
}

export function getProjectWorktreeFileTree(
  input: ProjectWorkspaceInput,
): Promise<ProjectWorktreeFileTreeResponse> {
  return invokeCommand<ProjectWorktreeFileTreeResponse>(
    "get_project_worktree_file_tree",
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

export function readProjectWorktreeFile(
  input: ProjectWorkspacePathInput,
): Promise<WorkspaceFileContent> {
  return invokeCommand<WorkspaceFileContent>("read_project_worktree_file", {
    input,
  });
}

export function readProjectWorktreeDiff(
  input: ProjectWorkspacePathInput,
): Promise<WorkspaceDiffContent> {
  return invokeCommand<WorkspaceDiffContent>("read_project_worktree_diff", {
    input,
  });
}
