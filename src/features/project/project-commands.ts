import { invokeCommand } from "../../shared/commands/command-client";

export interface LocalDataStatus {
  databaseExists: boolean;
  currentVersion: string | null;
  appliedVersions: string[];
}

export interface CreateProjectInput {
  name: string;
  repoPath: string;
  completionPolicy: ProjectCompletionPolicy;
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

export type ProjectCompletionPolicy = "manual" | "agent_auto_commit";

export interface UpdateProjectCompletionPolicyInput {
  projectId: number;
  completionPolicy: ProjectCompletionPolicy;
}

export interface UpdateProjectSettingsInput {
  projectId: number;
  name: string;
  repoPath: string;
  completionPolicy: ProjectCompletionPolicy;
}

export interface ProjectRecord {
  id: number;
  name: string;
  repoPath: string;
  completionPolicy: ProjectCompletionPolicy;
  createdAt: number;
  lastOpenedAt: number;
}

export interface ProjectListItem extends ProjectRecord {
  pathStatus: "available" | "missing";
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

export function updateProjectCompletionPolicy(
  input: UpdateProjectCompletionPolicyInput,
): Promise<ProjectRecord> {
  return invokeCommand<ProjectRecord>("update_project_completion_policy", {
    input,
  });
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
