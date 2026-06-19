// 结构化 Agent 事件流的订阅封装。
//
// 紧邻 `agent-terminal-events.ts` 的模式：返回 `Promise<() => void>`，
// 内部 `listen` 并解包 `event.payload`。事件名与后端
// `AGENT_SESSION_STREAM_EVENT`（`agent-session-stream-event`）一致。

import { listen } from "@tauri-apps/api/event";

import type { AgentStreamEventEnvelope } from "../agent-stream-types";

/** 结构化 Agent 事件流的 Tauri event 名（与后端常量一致）。 */
export const AGENT_SESSION_STREAM_EVENT = "agent-session-stream-event";

/**
 * 订阅结构化 Agent 事件流。
 *
 * handler 收到的是已解包的 envelope（含 projectId/sessionId/seq/epoch/event）。
 * 返回的 unlisten 函数用于取消订阅。
 */
export function subscribeAgentSessionStream(
  handler: (envelope: AgentStreamEventEnvelope) => void,
): Promise<() => void> {
  return listen<AgentStreamEventEnvelope>(
    AGENT_SESSION_STREAM_EVENT,
    (event) => {
      handler(event.payload);
    },
  );
}
