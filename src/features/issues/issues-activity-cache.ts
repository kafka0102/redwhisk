import type { DialogMode, IssueFormState } from "./issue-activity-types";

export interface CachedIssuePageState {
  dialogMode: DialogMode;
  form: IssueFormState;
  previousSelectedIssueId: number | null;
  selectedIssueId: number | null;
}

export const issuePageStateCache = new Map<number, CachedIssuePageState>();

export function resetIssuePageStateCacheForTests() {
  issuePageStateCache.clear();
}
