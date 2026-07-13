import { invokeCommand } from "../commands/command-client";

export interface ProjectWorkspaceInput {
  projectId: number;
  sessionId?: number | null;
  workspacePath?: string | null;
}

export interface ProjectWorkspacePathInput extends ProjectWorkspaceInput {
  filePath: string;
  commitHash?: string | null;
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

export function readProjectWorktreeFile(
  input: ProjectWorkspacePathInput,
): Promise<WorkspaceFileContent> {
  return invokeCommand<WorkspaceFileContent>("read_project_worktree_file", {
    input,
  });
}
