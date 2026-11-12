/**
 * 终端视图滚动状态缓存。
 *
 * 用于在 workspace tab / Activity 切换后恢复滚动位置：
 * - 隐藏或卸载时记录 viewportY 与 sequence
 * - 项目终端：sequence 未变则恢复原滚动位置；sequence 前进则滚到最新底部
 * - Agent 会话终端可另传「切回是否滚到底」，覆盖序号规则
 */
export interface TerminalViewState {
  sequence: number;
  viewportY: number;
}

const states = new Map<string, TerminalViewState>();

export function saveTerminalViewState(
  key: string,
  state: TerminalViewState,
): void {
  states.set(key, state);
}

export function peekTerminalViewState(key: string): TerminalViewState | null {
  return states.get(key) ?? null;
}

/** 测试用：清空全部缓存。 */
export function clearTerminalViewStatesForTests(): void {
  states.clear();
}

/**
 * 历史回放后的滚动策略：
 * - `scrollToBottom === true` → 返回 null（调用方滚到底部）
 * - `scrollToBottom === false` 且有记录 → 恢复原 viewportY，即使 sequence 已前进
 * - 未指定时：sequence 未变恢复原 viewportY；否则返回 null（滚到底部）
 */
export function resolveHistoryScrollViewportY(
  saved: TerminalViewState | null,
  restoreSequence: number,
  options?: { scrollToBottom?: boolean },
): number | null {
  if (options?.scrollToBottom === true) {
    return null;
  }
  if (options?.scrollToBottom === false) {
    return saved === null ? null : saved.viewportY;
  }
  if (saved !== null && saved.sequence === restoreSequence) {
    return saved.viewportY;
  }
  return null;
}

/**
 * 零高度时 xterm 可能把 viewport 报成 0。
 * 已记录的非 0 位置不得被写成 0；没有可保留的位置时跳过本次写入。
 * 返回 null 表示不要覆盖缓存。
 */
export function viewportYToPersist(
  reportedViewportY: number,
  hostWidth: number,
  hostHeight: number,
  savedViewportY: number | null,
): number | null {
  const collapsed = hostWidth === 0 || hostHeight === 0;
  if (collapsed && reportedViewportY === 0) {
    if (savedViewportY !== null && savedViewportY !== 0) {
      return savedViewportY;
    }
    return null;
  }
  return reportedViewportY;
}
