import {
  type IssueRecord,
  type IssueStatus,
  type IssueStatusTotals,
} from "./issue-commands";
import { ISSUE_PAGE_SIZE } from "./issue-activity-types";

const ISSUE_STATUSES: readonly IssueStatus[] = [
  "backlog",
  "running",
  "review",
  "completed",
];

interface LaneLoadState {
  /** 已为该甬道加载的条数，作为下一页的 offset。 */
  loadedCount: number;
  hasMore: boolean;
  isLoadingMore: boolean;
}

type LaneLoadStateMap = Record<IssueStatus, LaneLoadState>;

type LaneTotalsMap = Record<IssueStatus, number>;

const INITIAL_LANE_TOTALS: LaneTotalsMap = ISSUE_STATUSES.reduce(
  (acc, status) => {
    acc[status] = 0;
    return acc;
  },
  {} as LaneTotalsMap,
);

const INITIAL_LANE_LOAD_STATE: LaneLoadStateMap = ISSUE_STATUSES.reduce(
  (acc, status) => {
    acc[status] = { loadedCount: 0, hasMore: false, isLoadingMore: false };
    return acc;
  },
  {} as LaneLoadStateMap,
);

/** 把后端返回的各状态总数落到甬道计数；后端未返回时按已加载条数兜底。 */
function deriveLaneTotals(
  statusTotals: IssueStatusTotals | undefined,
  issues: IssueRecord[],
): LaneTotalsMap {
  if (statusTotals) {
    return {
      backlog: statusTotals.backlog,
      running: statusTotals.running,
      review: statusTotals.review,
      completed: statusTotals.completed,
    };
  }
  return ISSUE_STATUSES.reduce((acc, status) => {
    acc[status] = issues.filter((issue) => issue.status === status).length;
    return acc;
  }, {} as LaneTotalsMap);
}

/**
 * 单个 Issue 状态发生迁移（含新增/删除）时，按 (prev, next) 平移甬道总数。
 * prev 与 next 状态相同（如仅编辑内容）时为空操作。
 */
function shiftLaneTotals(
  totals: LaneTotalsMap,
  prev: IssueRecord | null | undefined,
  next: IssueRecord | null | undefined,
): LaneTotalsMap {
  if (prev?.status === next?.status) {
    return totals;
  }
  const result = { ...totals };
  if (prev) {
    result[prev.status] = Math.max(0, result[prev.status] - 1);
  }
  if (next) {
    result[next.status] = result[next.status] + 1;
  }
  return result;
}

/** 根据首屏返回的扁平列表，计算每个甬道的分页状态。 */
function computeLaneLoadState(issues: IssueRecord[]): LaneLoadStateMap {
  return ISSUE_STATUSES.reduce((acc, status) => {
    const count = issues.filter((issue) => issue.status === status).length;
    acc[status] = {
      loadedCount: count,
      hasMore: count >= ISSUE_PAGE_SIZE,
      isLoadingMore: false,
    };
    return acc;
  }, {} as LaneLoadStateMap);
}

/** 追加下一页数据，按 id 去重，保留既有顺序。 */
function mergeIssues(
  current: IssueRecord[],
  next: IssueRecord[],
): IssueRecord[] {
  const existingIds = new Set(current.map((issue) => issue.id));
  return sortIssuesByIdDesc([
    ...current,
    ...next.filter((issue) => !existingIds.has(issue.id)),
  ]);
}

function sortIssuesByIdDesc(issues: IssueRecord[]): IssueRecord[] {
  return [...issues].sort((left, right) => right.id - left.id);
}

export {
  type LaneLoadState,
  type LaneLoadStateMap,
  type LaneTotalsMap,
  INITIAL_LANE_TOTALS,
  INITIAL_LANE_LOAD_STATE,
  deriveLaneTotals,
  shiftLaneTotals,
  computeLaneLoadState,
  mergeIssues,
  sortIssuesByIdDesc,
};
