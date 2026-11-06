import { invokeCommand } from "../../shared/commands/command-client";

export type IssueSourceMode = "local" | "remote" | "mixed";
export type IssueSyncScope = "assigned_to_me" | "all_open" | "label" | "all";
export type IssueCreateSource = "local" | "remote";
export type ForgeProvider = "github" | "gitlab";
export type ForgeAuthStatus =
  | "unknown"
  | "ready"
  | "expired"
  | "unauthenticated"
  | "cli_missing"
  | "not_forge";

export interface ProjectIssueConnection {
  provider: ForgeProvider | null;
  hostUrl: string | null;
  repoPath: string | null;
  login: string | null;
  cliInstalled: boolean;
  cliAuthenticated: boolean;
  authStatus: ForgeAuthStatus;
  checkedAt: number;
}

export interface ProjectIssueSourceSettings {
  projectId: number;
  issueSourceMode: IssueSourceMode;
  issueSyncScope: IssueSyncScope;
  issueSyncLabel: string | null;
  issueSyncEnabled: boolean;
  issueSyncIntervalSeconds: number;
  issueWritebackCloseOnComplete: boolean;
  issueWritebackCloseOnPrMerge: boolean;
  issueWritebackComment: boolean;
  issueCreateSource: IssueCreateSource;
  localIssueCount: number;
  remoteIssueCount: number;
  connection: ProjectIssueConnection;
}

export interface UpdateProjectIssueSourceSettingsInput {
  projectId: number;
  issueSourceMode?: IssueSourceMode;
  issueSyncScope?: IssueSyncScope;
  issueSyncLabel?: string;
  issueSyncEnabled?: boolean;
  issueSyncIntervalSeconds?: number;
  issueWritebackCloseOnComplete?: boolean;
  issueWritebackCloseOnPrMerge?: boolean;
  issueWritebackComment?: boolean;
  issueCreateSource?: IssueCreateSource;
}

export function getProjectIssueSourceSettings(
  projectId: number,
): Promise<ProjectIssueSourceSettings> {
  return invokeCommand<ProjectIssueSourceSettings>(
    "get_project_issue_source_settings",
    { projectId },
  );
}

export function updateProjectIssueSourceSettings(
  input: UpdateProjectIssueSourceSettingsInput,
): Promise<ProjectIssueSourceSettings> {
  return invokeCommand<ProjectIssueSourceSettings>(
    "update_project_issue_source_settings",
    { input },
  );
}

export function inspectProjectIssueConnection(
  projectId: number,
): Promise<ProjectIssueSourceSettings> {
  return invokeCommand<ProjectIssueSourceSettings>(
    "inspect_project_issue_connection",
    { projectId },
  );
}
