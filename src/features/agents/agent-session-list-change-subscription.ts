import { subscribeTauriEvent } from "../../shared/tauri-event/use-tauri-event";
import {
  AGENT_SESSION_LIST_CHANGED_EVENT,
  isAgentSessionListChangedFor,
  type AgentSessionListChangedEvent,
} from "./agent-session-events";

/**
 * 会话列表变更事件的失效去抖窗口。
 *
 * 取值理由：一次回合开始 / 结束会连发多条会话列表变更事件（回合开始 / 结束、prompt
 * 注入等），去抖把突发合并成有限次刷新；500ms 与既有先例（`agents-activity.tsx` 的会话
 * 列表刷新、变更 Activity 的 running 重算）同档——这些消费方只做数据失效，不承担
 * 「尽快提醒」的延迟，故取比通知轮询 300ms 略长的窗口以多合并几条。
 */
export const SESSION_LIST_EVENT_REFRESH_DEBOUNCE_MS = 500;

/**
 * 订阅 `agent-session-list-changed` 并去抖：命中 `scope`（项目 + 可选会话）的突发事件
 * 合并成一次 `onInvalidate`，窗口内不再重复触发。返回同步 teardown，含清掉未到期的窗口。
 *
 * 本模块只负责「事件 → 命中判定 → 去抖」这一层，不含门控与请求：调用方在自己的 effect
 * 里决定何时订阅（可见 / 聚焦 / 面板在看在用），并在 teardown 里连带作废停泊中的补刷新。
 */
export function subscribeDebouncedSessionListChange(
  scope: { projectId: number; sessionId?: number | null },
  onInvalidate: () => void,
): () => void {
  let debounceTimer: number | null = null;
  const unsubscribe = subscribeTauriEvent<AgentSessionListChangedEvent>(
    AGENT_SESSION_LIST_CHANGED_EVENT,
    (event) => {
      if (!isAgentSessionListChangedFor(event, scope)) return;
      if (debounceTimer !== null) return;
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        onInvalidate();
      }, SESSION_LIST_EVENT_REFRESH_DEBOUNCE_MS);
    },
  );

  return () => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
    }
    unsubscribe();
  };
}
