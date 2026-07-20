/**
 * 终端视图滚动状态缓存。
 *
 * 用于在 workspace tab / Activity 切换后恢复滚动位置：
 * - 隐藏或卸载时记录 viewportY 与 sequence
 * - 再次可见时若 sequence 未变（期间无新输出），恢复原滚动位置
 * - 若 sequence 前进（期间有输出），则滚到最新底部
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
 * - 隐藏期间 sequence 未变 → 恢复原 viewportY
 * - 首次展示或期间有新输出 → 返回 null（调用方滚到底部）
 */
export function resolveHistoryScrollViewportY(
  saved: TerminalViewState | null,
  restoreSequence: number,
): number | null {
  if (saved !== null && saved.sequence === restoreSequence) {
    return saved.viewportY;
  }
  return null;
}
