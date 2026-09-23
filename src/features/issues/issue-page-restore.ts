import {
  getIssueOpenRequestId,
  type IssueOpenRequest,
} from "./issue-open-request";
import {
  EMPTY_FORM,
  type DialogMode,
  type IssueFormState,
} from "./issue-activity-types";
import type { IssueRecord, IssueStatusTotals } from "./issue-commands";
import {
  type LaneLoadStateMap,
  type LaneTotalsMap,
  computeLaneLoadState,
  deriveLaneTotals,
  mergeIssues,
  sortIssuesByStatusChangedAtDesc,
} from "./issue-lane-helpers";
import { issueToForm } from "./issue-form/issue-description-serializer";
import {
  issuePageStateCache,
  noteIssueOpenRequest,
  shouldApplyIssueOpenRequest,
  type CachedIssuePageState,
} from "./issues-activity-cache";

export interface InitialIssuePageState {
  applyOpenRequest: boolean;
  openRequestToken: number;
  requestedIssueId: number | null;
  hasRequestedIssue: boolean;
  issues: IssueRecord[];
  selectedIssueId: number | null;
  dialogMode: DialogMode | null;
  form: IssueFormState;
  isReadOnlyEditRequested: boolean;
  previousSelectedIssueId: number | null;
}

export interface ResolvedIssuePage {
  issues: IssueRecord[];
  laneLoadState: LaneLoadStateMap;
  laneTotals: LaneTotalsMap;
  selectedIssueId: number | null;
  dialogMode: DialogMode | null;
  form: IssueFormState;
  previousSelectedIssueId: number | null;
  isReadOnlyEditRequested: boolean;
  clearCache: boolean;
}

export function readInitialIssuePageState(input: {
  projectId: number;
  requestedIssue: IssueOpenRequest | number | null;
  legacyRequestedIssueId: number | null;
}): InitialIssuePageState {
  const cached = issuePageStateCache.get(input.projectId) ?? null;
  const requestedIssueId =
    getIssueOpenRequestId(input.requestedIssue) ?? input.legacyRequestedIssueId;
  const hasRequestedIssue = requestedIssueId != null;
  const openRequestToken = noteIssueOpenRequest(
    input.projectId,
    input.requestedIssue ?? input.legacyRequestedIssueId,
  );
  const applyOpenRequest = shouldApplyIssueOpenRequest(
    input.projectId,
    openRequestToken,
    hasRequestedIssue,
  );
  const restore = applyOpenRequest ? null : cached;

  return {
    applyOpenRequest,
    openRequestToken,
    requestedIssueId,
    hasRequestedIssue,
    issues:
      restore?.dialogMode === "edit" && restore.issueSnapshot
        ? [restore.issueSnapshot]
        : [],
    selectedIssueId: applyOpenRequest
      ? requestedIssueId
      : (restore?.selectedIssueId ?? null),
    dialogMode: applyOpenRequest ? "edit" : (restore?.dialogMode ?? null),
    form: applyOpenRequest ? EMPTY_FORM : (restore?.form ?? EMPTY_FORM),
    isReadOnlyEditRequested: applyOpenRequest
      ? false
      : (restore?.isReadOnlyEditRequested ?? false),
    previousSelectedIssueId: applyOpenRequest
      ? null
      : (restore?.previousSelectedIssueId ?? null),
  };
}

/**
 * 看板首屏每个状态只返回前 N 条。正在新建 / 编辑的 issue 可能不在这页里，
 * 不能据此把表单清回看板。session 打开请求只在身份变化时覆盖草稿。
 */
export function resolveLoadedIssuePage(input: {
  issues: IssueRecord[];
  statusTotals: IssueStatusTotals | undefined;
  applyOpenRequest: boolean;
  requestedIssueId: number | null;
  cached: CachedIssuePageState | null;
}): ResolvedIssuePage {
  const serverIssues = sortIssuesByStatusChangedAtDesc(input.issues);
  const laneLoadState = computeLaneLoadState(serverIssues);
  const laneTotals = deriveLaneTotals(input.statusTotals, serverIssues);

  if (input.applyOpenRequest) {
    const requested =
      serverIssues.find((issue) => issue.id === input.requestedIssueId) ?? null;
    if (!requested) {
      return {
        issues: serverIssues,
        laneLoadState,
        laneTotals,
        selectedIssueId: serverIssues[0]?.id ?? null,
        dialogMode: null,
        form: EMPTY_FORM,
        previousSelectedIssueId: null,
        isReadOnlyEditRequested: false,
        clearCache: true,
      };
    }

    return {
      issues: serverIssues,
      laneLoadState,
      laneTotals,
      selectedIssueId: requested.id,
      dialogMode: "edit",
      form: issueToForm(requested),
      previousSelectedIssueId: null,
      isReadOnlyEditRequested: false,
      clearCache: false,
    };
  }

  const cached = input.cached;
  if (cached && canRestoreCachedIssuePage(cached, serverIssues)) {
    const snapshot = cached.issueSnapshot;
    const issues =
      cached.dialogMode === "edit" &&
      snapshot &&
      !serverIssues.some((issue) => issue.id === snapshot.id)
        ? mergeIssues(serverIssues, [snapshot])
        : serverIssues;

    return {
      issues,
      laneLoadState,
      laneTotals,
      selectedIssueId: cached.selectedIssueId,
      dialogMode: cached.dialogMode,
      form: cached.form,
      previousSelectedIssueId: cached.previousSelectedIssueId,
      isReadOnlyEditRequested: cached.isReadOnlyEditRequested,
      clearCache: false,
    };
  }

  return {
    issues: serverIssues,
    laneLoadState,
    laneTotals,
    selectedIssueId:
      serverIssues.find((issue) => issue.id === input.requestedIssueId)?.id ??
      serverIssues[0]?.id ??
      null,
    dialogMode: null,
    form: EMPTY_FORM,
    previousSelectedIssueId: null,
    isReadOnlyEditRequested: false,
    clearCache: true,
  };
}

function canRestoreCachedIssuePage(
  cached: CachedIssuePageState,
  serverIssues: IssueRecord[],
): boolean {
  if (cached.dialogMode === "create") {
    return true;
  }

  if (serverIssues.some((issue) => issue.id === cached.selectedIssueId)) {
    return true;
  }

  return cached.dialogMode === "edit" && cached.issueSnapshot != null;
}
