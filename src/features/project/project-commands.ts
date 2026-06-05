import { invokeCommand } from "../../shared/commands/command-client";

export interface LocalDataStatus {
  databaseExists: boolean;
  currentVersion: string | null;
  appliedVersions: string[];
}

export interface CreateProjectInput {
  repoPath: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  repoPath: string;
  createdAt: string;
  lastOpenedAt: string;
}

export function initializeLocalData(): Promise<LocalDataStatus> {
  return invokeCommand<LocalDataStatus>("initialize_local_data");
}

export function createProject(
  input: CreateProjectInput,
): Promise<ProjectRecord> {
  return invokeCommand<ProjectRecord>("create_project", { input });
}
