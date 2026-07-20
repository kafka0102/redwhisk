import { invokeCommand } from "../../shared/commands/command-client";

export interface LocalDataStatus {
  databaseExists: boolean;
  currentVersion: string | null;
  appliedVersions: string[];
}

export interface CreateProjectInput {
  name: string;
  repoPath: string;
  worktreeLocation: ProjectWorktreeLocation;
  worktreeSetupCommand: string;
}

export interface ValidateProjectRepoPathInput {
  repoPath: string;
}

export interface ValidateProjectRepoPathResponse {
  repoPath: string;
  suggestedName: string;
}

export interface OpenProjectInput {
  projectId: number;
}

export interface RemoveProjectFromListInput {
  projectId: number;
}

export interface DeleteProjectInput {
  projectId: number;
}

export type ProjectWorktreeLocation =
  | "repo_sibling"
  | "repo_internal"
  | "user_home";

export type ProjectPathStatus = "available" | "missing";

export interface UpdateProjectSettingsInput {
  projectId: number;
  name: string;
  repoPath: string;
  worktreeLocation: ProjectWorktreeLocation;
  worktreeSetupCommand: string;
}

export interface ProjectRecord {
  id: number;
  name: string;
  repoPath: string;
  worktreeLocation: ProjectWorktreeLocation;
  worktreeSetupCommand: string;
  createdAt: number;
  lastOpenedAt: number;
  // Rust ProjectSummary.code_workspaces 是 Vec<CodeWorkspaceRoot>，无 skip_serializing_if，
  // 序列化时键始终存在（值可能为空数组）。前端 ProjectRecord.codeWorkspaces 与之同步。
  codeWorkspaces: Array<{
    branch: string;
    path: string;
    isProjectRoot: boolean;
  }>;
}

export interface ProjectListItem extends Omit<ProjectRecord, "codeWorkspaces"> {
  pathStatus: ProjectPathStatus;
}

export interface ProjectListResponse {
  projects: ProjectListItem[];
}

export interface OpenProjectWindowResponse {
  projectId: number;
  windowLabel: string;
}

export function initializeLocalData(): Promise<LocalDataStatus> {
  return invokeCommand<LocalDataStatus>("initialize_local_data");
}

export function createProject(
  input: CreateProjectInput,
): Promise<ProjectRecord> {
  return invokeCommand<ProjectRecord>("create_project", { input });
}

export function validateProjectRepoPath(
  input: ValidateProjectRepoPathInput,
): Promise<ValidateProjectRepoPathResponse> {
  return invokeCommand<ValidateProjectRepoPathResponse>(
    "validate_project_repo_path",
    { input },
  );
}

export function listProjects(): Promise<ProjectListResponse> {
  return invokeCommand<ProjectListResponse>("list_projects");
}

export function openProject(input: OpenProjectInput): Promise<ProjectRecord> {
  return invokeCommand<ProjectRecord>("open_project", { input });
}

export function updateProjectSettings(
  input: UpdateProjectSettingsInput,
): Promise<ProjectRecord> {
  return invokeCommand<ProjectRecord>("update_project_settings", {
    input,
  });
}

export function openProjectWindow(
  input: OpenProjectInput,
): Promise<OpenProjectWindowResponse> {
  return invokeCommand<OpenProjectWindowResponse>("open_project_window", {
    input,
  });
}

export function removeProjectFromList(
  input: RemoveProjectFromListInput,
): Promise<void> {
  return invokeCommand<void>("remove_project_from_list", { input });
}

export function deleteProject(input: DeleteProjectInput): Promise<void> {
  return invokeCommand<void>("delete_project", { input });
}
