import { invokeCommand } from "../../shared/commands/command-client";

export interface LocalDataStatus {
  databaseExists: boolean;
  currentVersion: string | null;
  appliedVersions: string[];
}

export interface CreateProjectInput {
  repoPath: string;
}

export interface OpenProjectInput {
  projectId: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  repoPath: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface ProjectListItem extends ProjectRecord {
  pathStatus: "available" | "missing";
}

export interface ProjectListResponse {
  projects: ProjectListItem[];
}

export interface OpenProjectWindowResponse {
  projectId: string;
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

export function listProjects(): Promise<ProjectListResponse> {
  return invokeCommand<ProjectListResponse>("list_projects");
}

export function openProject(input: OpenProjectInput): Promise<ProjectRecord> {
  return invokeCommand<ProjectRecord>("open_project", { input });
}

export function openProjectWindow(
  input: OpenProjectInput,
): Promise<OpenProjectWindowResponse> {
  return invokeCommand<OpenProjectWindowResponse>("open_project_window", {
    input,
  });
}
