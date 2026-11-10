import type { ProjectIssueSourceSettings } from "../settings/issue-source-commands";

export function isIssueConnectionReady(
  settings: ProjectIssueSourceSettings,
): boolean {
  const provider = settings.connection.provider;
  const host = settings.connection.hostUrl?.trim() ?? "";
  const repo = settings.connection.repoPath?.trim() ?? "";
  return (
    settings.connection.authStatus === "ready" &&
    (provider === "github" || provider === "gitlab") &&
    host.length > 0 &&
    repo.length > 0
  );
}

/** 仅远程时，连接未就绪不显示待办加号，也不回退成本地新建。 */
export function canCreateIssueFromBoard(
  settings: ProjectIssueSourceSettings | null,
): boolean {
  if (settings == null) {
    return false;
  }
  if (settings.issueSourceMode === "remote") {
    return isIssueConnectionReady(settings);
  }
  return true;
}
