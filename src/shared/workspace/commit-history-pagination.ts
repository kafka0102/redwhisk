import { COMMIT_HISTORY_PAGE_SIZE } from "./workspace-commands";
import type { WorkspaceCommitRecord } from "./workspace-commands";

/** 外层变更列表距底多少像素内触发已提交历史 load-more。 */
export const COMMIT_HISTORY_LOAD_MORE_THRESHOLD_PX = 80;

/**
 * 判断滚动容器是否已接近底部（含内容不足一屏：距离为负或 0 也视为 near）。
 * scrollHeight === 0 时容器尚未布局，返回 false 避免空请求。
 */
export function isNearScrollBottom(
  metrics: {
    scrollHeight: number;
    clientHeight: number;
    scrollTop: number;
  },
  thresholdPx: number = COMMIT_HISTORY_LOAD_MORE_THRESHOLD_PX,
): boolean {
  if (metrics.scrollHeight === 0) {
    return false;
  }
  return (
    metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <
    thresholdPx
  );
}

/** 整窗刷新 limit：至少一页，且不少于当前已加载条数。 */
export function commitHistoryRefreshLimit(
  loadedCount: number,
  pageSize: number = COMMIT_HISTORY_PAGE_SIZE,
): number {
  return Math.max(pageSize, loadedCount);
}

/** 按 hash 去重追加下一页；无新增时返回原引用。 */
export function appendUniqueCommitsByHash(
  existing: WorkspaceCommitRecord[],
  nextPage: WorkspaceCommitRecord[],
): WorkspaceCommitRecord[] {
  if (nextPage.length === 0) {
    return existing;
  }
  const seen = new Set(existing.map((commit) => commit.hash));
  const appended = nextPage.filter((commit) => !seen.has(commit.hash));
  if (appended.length === 0) {
    return existing;
  }
  return [...existing, ...appended];
}
