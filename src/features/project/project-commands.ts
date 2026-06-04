import { invokeCommand } from "../../shared/commands/command-client";

export interface LocalDataStatus {
  databaseExists: boolean;
  currentVersion: string | null;
  appliedVersions: string[];
}

export function initializeLocalData(): Promise<LocalDataStatus> {
  return invokeCommand<LocalDataStatus>("initialize_local_data");
}
