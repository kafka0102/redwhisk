import { invokeCommand } from "../../shared/commands/command-client";

export type ProjectCompletionAction = "merge_to_base" | "open_pull_request";
export type ProjectPrTarget = "issue_base" | "repo_default";
export type ForgeHostName = "github" | "gitlab" | "none";

export interface ProjectForgeInspection {
  host: ForgeHostName;
  remoteLabel: string | null;
  cliInstalled: boolean;
  cliAuthenticated: boolean;
  repoDefaultBranch: string | null;
  completionAction: ProjectCompletionAction;
  prTarget: ProjectPrTarget;
  prDraft: boolean;
  confirmCompletionAction: boolean;
}

export interface ChangeRequestPreview {
  host: ForgeHostName;
  currentBranch: string | null;
  repoDefaultBranch: string | null;
  branches: string[];
  existingUrl: string | null;
  title: string;
  body: string;
  completionAction: ProjectCompletionAction;
  prTarget: ProjectPrTarget;
  prDraft: boolean;
}

export interface CreateChangeRequestInput {
  projectId: number;
  workspacePath: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
}

export function inspectProjectForge(
  projectId: number,
): Promise<ProjectForgeInspection> {
  return invokeCommand<ProjectForgeInspection>("inspect_project_forge", {
    projectId,
  });
}

export function previewChangeRequest(input: {
  projectId: number;
  workspacePath: string;
}): Promise<ChangeRequestPreview> {
  return invokeCommand<ChangeRequestPreview>("preview_change_request", {
    input,
  });
}

export function createChangeRequest(
  input: CreateChangeRequestInput,
): Promise<{ url: string }> {
  return invokeCommand<{ url: string }>("create_change_request", { input });
}

export interface ChangeRequestCheck {
  name: string;
  status: string;
}

export interface ChangeRequestStatus {
  title: string;
  state: string;
  checks: ChangeRequestCheck[];
}

export function viewProjectChangeRequest(input: {
  projectId: number;
  reference: string;
}): Promise<ChangeRequestStatus> {
  return invokeCommand<ChangeRequestStatus>("view_project_change_request", {
    input,
  });
}
