// 结构化消息流的顶层组件。
//
// 负责滚动容器、空态文案、轮次运行指示器与自动滚动到底部。自动滚动策略：
// 用户停留在底部附近时跟随新内容滚动；手动上滚后停止跟随（避免抢夺滚动位置）。
// "滚动到底部"按钮留到任务 6。
//
// 拆分为两层：
// - `AgentMessageStream`：自包含，内部调 `useAgentMessageStream` 订阅，用于独立场景/测试。
// - `AgentMessageStreamView`：纯渲染，接收外部 `state`，供 `AgentSessionView` 父组件
//   统一订阅后下传，避免双订阅。

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, type UIEvent } from "react";

import type { AgentTimelineItem } from "../agent-stream-types";
import { useAgentMessageStream } from "./use-agent-message-stream";
import { AgentMessageCards } from "./agent-message-cards";
import type {
  MessageStreamEntry,
  MessageStreamState,
} from "./message-stream-types";

interface AgentMessageStreamProps {
  projectId: number;
  sessionId: number;
}

/** 距底部阈值（px），小于此值视为"贴底"，新内容自动跟随滚动。 */
const PIN_TO_BOTTOM_THRESHOLD_PX = 80;

/** 自包含变体：内部订阅事件流，用于独立场景与测试。 */
export function AgentMessageStream({
  projectId,
  sessionId,
}: AgentMessageStreamProps) {
  const { state } = useAgentMessageStream({ projectId, sessionId });
  return <AgentMessageStreamView state={state} />;
}

interface AgentMessageStreamViewProps {
  state: MessageStreamState;
  isTurnRunning?: boolean;
}

/**
 * 纯渲染变体：接收外部 state，不自行订阅。
 *
 * 供 `AgentSessionView` 等父组件统一调 `useAgentMessageStream` 后下传，
 * 避免消息流与 composer 各自订阅形成双数据源。
 */
export function AgentMessageStreamView({
  state,
  isTurnRunning = false,
}: AgentMessageStreamViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isPinnedRef = useRef(true);
  const { entries, turnStatus, isInitialized, lastError } = state;
  const shouldShowThinking = turnStatus === "running" || isTurnRunning;

  // 新内容到达时，若用户贴底则滚动到底。
  const lastSignature =
    entries.length > 0 ? signatureOf(entries[entries.length - 1]) : "";
  useEffect(() => {
    if (!isPinnedRef.current) {
      return;
    }
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [entries.length, lastSignature, turnStatus, shouldShowThinking]);
  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const node = event.currentTarget;
    const distanceFromBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight;
    isPinnedRef.current = distanceFromBottom <= PIN_TO_BOTTOM_THRESHOLD_PX;
  }

  return (
    <div
      className="agents-message-stream"
      aria-label="Agent 会话消息流"
      data-initialized={isInitialized}
    >
      <div
        ref={scrollRef}
        className="agents-message-stream__scroll"
        onScroll={handleScroll}
      >
        {isInitialized && entries.length === 0 && !lastError ? (
          <p className="agents-message-stream__empty">发送一条消息开始对话。</p>
        ) : null}
        {lastError && entries.length === 0 ? (
          <p className="agents-message-stream__error" role="status">
            {lastError}
          </p>
        ) : null}
        <AgentMessageCards entries={entries} />
        {shouldShowThinking ? (
          <div className="agents-message__entry agents-message__entry--running">
            <div
              className="agents-message-stream__running"
              role="status"
              aria-live="polite"
            >
              <LoaderCircle
                aria-hidden="true"
                size={13}
                strokeWidth={2}
                className="agents-message__spinner"
              />
              <span>正在思考…</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 生成最后一条 entry 的内容签名，用于驱动自动滚动 effect 依赖。 */
function signatureOf(entry: MessageStreamEntry): string {
  const item: AgentTimelineItem = entry.item;
  switch (item.type) {
    case "assistant_message":
    case "reasoning":
      return `${item.type}:${item.text.length}`;
    case "tool_call":
      return `${item.type}:${item.status}:${item.detail.type}`;
    default:
      return item.type;
  }
}
