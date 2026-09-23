import type { IssueOpenRequest } from "./issue-open-request";
import type { IssueRecord } from "./issue-commands";
import type { DialogMode, IssueFormState } from "./issue-activity-types";

export interface CachedIssuePageState {
  dialogMode: DialogMode;
  form: IssueFormState;
  previousSelectedIssueId: number | null;
  selectedIssueId: number | null;
  isReadOnlyEditRequested: boolean;
  /** 首屏分页可能不包含正在编辑的 issue，用快照保住表单。 */
  issueSnapshot: IssueRecord | null;
}

type IssueOpenRequestIdentity = IssueOpenRequest | number | null;

interface SeenIssueOpenRequest {
  request: IssueOpenRequestIdentity;
  token: number;
}

export const issuePageStateCache = new Map<number, CachedIssuePageState>();

const seenIssueOpenRequestByProject = new Map<number, SeenIssueOpenRequest>();
const appliedIssueOpenRequestTokenByProject = new Map<number, number>();

export function noteIssueOpenRequest(
  projectId: number,
  request: IssueOpenRequestIdentity,
): number {
  const seen = seenIssueOpenRequestByProject.get(projectId);
  if (seen && seen.request === request) {
    return seen.token;
  }

  const token = (seen?.token ?? 0) + 1;
  seenIssueOpenRequestByProject.set(projectId, { request, token });
  return token;
}

export function shouldApplyIssueOpenRequest(
  projectId: number,
  token: number,
  hasRequestedIssue: boolean,
): boolean {
  if (!hasRequestedIssue) {
    return false;
  }

  return appliedIssueOpenRequestTokenByProject.get(projectId) !== token;
}

export function markIssueOpenRequestApplied(
  projectId: number,
  token: number,
): void {
  appliedIssueOpenRequestTokenByProject.set(projectId, token);
}

export function resetIssuePageStateCacheForTests() {
  issuePageStateCache.clear();
  seenIssueOpenRequestByProject.clear();
  appliedIssueOpenRequestTokenByProject.clear();
}
