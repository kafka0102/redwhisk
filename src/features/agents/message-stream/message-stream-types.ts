// 结构化消息流的内部状态/视图类型。
//
// 消费 `agent-stream-types.ts` 的 `AgentStreamEvent` / `AgentTimelineItem`，
// 把后端事件折叠成可渲染的视图模型。本文件只定义类型，无运行时逻辑。

import type {
  AgentPermissionRequest,
  AgentStreamEvent,
  AgentTimelineItem,
  AgentUsage,
  TimelineHistoryItem,
} from "../agent-stream-types";

/** 轮次运行状态。 */
export type TurnStatus = "idle" | "running" | "failed" | "canceled";

/** 从日志重建的一条子智能体。prompt 为空时界面用「子智能体 N」。 */
export interface SubagentRosterEntry {
  id: string;
  prompt: string | null;
  ended: boolean;
  /**
   * 花名册明确说过这一路还在跑。父 Turn 结束后仍显示运行中。
   * 只从输出里推断出来的子智能体没有这个标记，仍跟着用户 Turn 走。
   */
  live?: boolean;
}

/**
 * 视图模型：把 timeline item 扁平成带稳定 key 的渲染条目。
 *
 * `id` 用于 React key 与 reducer 幂等 upsert 定位，取 messageId / callId；
 * 缺失时由 reducer 用自增序号生成 `local-{n}`。
 */
export interface MessageStreamEntry {
  id: string;
  kind: AgentTimelineItem["type"] | "turn_boundary";
  item: AgentTimelineItem;
  /** 这一条最新一次快照在会话日志中的起始字节。展开占位时按它回读一行。 */
  logOffset?: number;
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
  /** 从已保存日志重建的子智能体花名册。选中档不在这里。 */
  subagents: SubagentRosterEntry[];
  /** readAgentTimeline 完成前为 false，完成后为 true。 */
  isInitialized: boolean;
  /** 用户正在展开的可折叠项。超出热区也留正文，收起后再收成占位。 */
  expandedEntryIds: string[];
  /** 展开占位回读失败时的说明。卡片仍留在原处。 */
  entryLoadErrors: Record<string, string>;
}

/** hook 内部 dispatch 的动作。 */
export type MessageStreamAction =
  | { type: "RESET" }
  | { type: "RESTORE"; state: MessageStreamState }
  | {
      type: "HYDRATE";
      items: Array<AgentTimelineItem | TimelineHistoryItem>;
      effort?: string | null;
      model?: string | null;
    }
  | { type: "HYDRATE_FAILED"; error: string }
  | { type: "EVENT"; event: AgentStreamEvent; logOffset?: number }
  | {
      type: "EVENT_BATCH";
      events: Array<{ event: AgentStreamEvent; logOffset?: number }>;
    }
  | { type: "OPTIMISTIC_USER_MESSAGE"; text: string }
  | { type: "SET_ENTRY_EXPANDED"; entryId: string; expanded: boolean }
  | {
      type: "RESTORE_ENTRY_BODY";
      entryId: string;
      item: AgentTimelineItem;
    }
  | { type: "SET_ENTRY_LOAD_ERROR"; entryId: string; error: string | null };
