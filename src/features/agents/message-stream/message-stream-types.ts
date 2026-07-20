// 结构化消息流的内部状态/视图类型。
//
// 消费 `agent-stream-types.ts` 的 `AgentStreamEvent` / `AgentTimelineItem`，
// 把后端事件折叠成可渲染的视图模型。本文件只定义类型，无运行时逻辑。

import type {
  AgentPermissionRequest,
  AgentStreamEvent,
  AgentTimelineItem,
  AgentUsage,
} from "../agent-stream-types";

/** 轮次运行状态。 */
export type TurnStatus = "idle" | "running" | "failed" | "canceled";

/**
 * 视图模型：把 timeline item 扁平成带稳定 key 的渲染条目。
 *
 * `id` 用于 React key 与 reducer 幂等 upsert 定位，取 messageId / callId；
 * 缺失时由 reducer 用自增序号生成 `local-{n}`。
 */
export interface MessageStreamEntry {
  id: string;
  kind: AgentTimelineItem["type"];
  item: AgentTimelineItem;
}

/** 消息流 reducer 的完整状态。 */
export interface MessageStreamState {
  entries: MessageStreamEntry[];
  turnStatus: TurnStatus;
  usage: AgentUsage | null;
  pendingPermissions: AgentPermissionRequest[];
  mode: string | null;
  model: string | null;
  effort: string | null;
  lastSeq: number | null;
  lastError: string | null;
  /** 上一轮是否异常终止（stop_reason 异常，或末条是已完成 tool_call 且无收尾消息）。 */
  turnInterrupted: boolean;
  /** 异常终止时携带的 SDK stop_reason（后端未上报时为 null）。 */
  interruptedStopReason: string | null;
  /** 异步子代理是否被中断（task_notification status 异常）：工作流可能因此暂停。 */
  subagentInterrupted: boolean;
  /** readAgentTimeline 完成前为 false，完成后为 true。 */
  isInitialized: boolean;
}

/** hook 内部 dispatch 的动作。 */
export type MessageStreamAction =
  | { type: "RESET" }
  | { type: "RESTORE"; state: MessageStreamState }
  | { type: "HYDRATE"; items: AgentTimelineItem[]; effort?: string | null }
  | { type: "HYDRATE_FAILED"; error: string }
  | { type: "EVENT"; event: AgentStreamEvent }
  | { type: "EVENT_BATCH"; events: AgentStreamEvent[] }
  | { type: "OPTIMISTIC_USER_MESSAGE"; text: string };
