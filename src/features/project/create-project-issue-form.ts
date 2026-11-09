import type {
  IssueSourceMode,
  IssueSyncScope,
  ProjectIssueConnection,
} from "../settings/issue-source-commands";
import type { ProjectPrTarget } from "./project-forge-commands";
import type { ValidatedExistingProject } from "./project-commands";

export interface CreateProjectIssueForm {
  mode: IssueSourceMode;
  scope: IssueSyncScope;
  label: string;
  syncEnabled: boolean;
  intervalSeconds: number;
  closeOnComplete: boolean;
  closeOnMerge: boolean;
  writebackComment: boolean;
  prTarget: ProjectPrTarget;
  prDraft: boolean;
}

export function newIssueForm(): CreateProjectIssueForm {
  return {
    mode: "local",
    scope: "assigned_to_me",
    label: "",
    syncEnabled: true,
    intervalSeconds: 90,
    closeOnComplete: true,
    closeOnMerge: true,
    writebackComment: true,
    prTarget: "issue_base",
    prDraft: false,
  };
}

export function issueFormFromProject(
  project: ValidatedExistingProject,
): CreateProjectIssueForm {
  return {
    mode: project.issueSourceMode,
    scope: project.issueSyncScope,
    label: project.issueSyncLabel ?? "",
    syncEnabled: project.issueSyncEnabled,
    intervalSeconds: project.issueSyncIntervalSeconds,
    closeOnComplete: project.issueWritebackCloseOnComplete,
    closeOnMerge: project.issueWritebackCloseOnPrMerge,
    writebackComment: project.issueWritebackComment,
    prTarget: project.prTarget,
    prDraft: project.prDraft,
  };
}

export function unknownConnection(
  provider: ProjectIssueConnection["provider"],
): ProjectIssueConnection {
  return {
    provider,
    hostUrl: null,
    repoPath: null,
    login: null,
    cliInstalled: false,
    cliAuthenticated: false,
    authStatus: "unknown",
    checkedAt: 0,
  };
}
