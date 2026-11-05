import { invokeCommand } from "../../shared/commands/command-client";

export const ISSUE_SYNC_CHANGED_EVENT = "issue-sync-changed";

export type IssueSyncOutcome =
  | "synced"
  | "skipped"
  | "credential_expired"
  | "cache_failed";

export interface IssueSyncResult {
  outcome: IssueSyncOutcome;
}

export interface IssueSyncStatus {
  lastSyncedAt: number | null;
  syncError: string | null;
}

export interface IssueSyncChangedEvent {
  projectId: number;
  outcome: IssueSyncOutcome;
}

export function syncProjectIssues(projectId: number): Promise<IssueSyncResult> {
  return invokeCommand<IssueSyncResult>("sync_project_issues", { projectId });
}

export function getIssueSyncStatus(
  projectId: number,
): Promise<IssueSyncStatus> {
  return invokeCommand<IssueSyncStatus>("get_issue_sync_status", { projectId });
}
