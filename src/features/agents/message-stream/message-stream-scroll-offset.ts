// 结构化消息流的滚动位置缓存。
//
// 背景：Agents Activity 切到其它菜单（Issues / Code / Changes / …）时会整体卸载，
// 切回时消息流 DOM 重建、滚动位置归零；对已完成 Issue 的只读 session，这会触发
// 「贴底跟随」自动跳到底部，破坏用户来回切窗口复制文本时的阅读位置。
//
// 因此按 sessionId 记录最近一次滚动位置：组件卸载时写入，重挂载时由消息流按需恢复。
// 仅只读（Issue 已完成）session 恢复；运行中 session 仍按原行为跟随到底部。
//
// 键与 `sessionStateCache` 一致用 sessionId（单库内唯一）；session 删除时必须调用
// `clearMessageStreamScrollOffset`，避免 agent_sessions.id 复用后旧位置串入新 session。

const scrollOffsetBySessionId = new Map<number, number>();

/** 读取某 session 记录的滚动位置；从未记录过时返回 null（表示不需要恢复）。 */
export function readMessageStreamScrollOffset(
  sessionId: number,
): number | null {
  return scrollOffsetBySessionId.get(sessionId) ?? null;
}

/** 记录某 session 的滚动位置（负数按 0 处理）。 */
export function writeMessageStreamScrollOffset(
  sessionId: number,
  offset: number,
): void {
  scrollOffsetBySessionId.set(sessionId, Math.max(0, offset));
}

/** 删除 session 时清理其滚动位置。 */
export function clearMessageStreamScrollOffset(sessionId: number): void {
  scrollOffsetBySessionId.delete(sessionId);
}

/** 仅供测试隔离：module-level 单例会跨用例残留。 */
export function resetMessageStreamScrollOffsetCacheForTests(): void {
  scrollOffsetBySessionId.clear();
}
