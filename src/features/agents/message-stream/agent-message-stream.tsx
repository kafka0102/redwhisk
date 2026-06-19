// 结构化消息流的顶层组件。
//
// 负责滚动容器、空态文案、轮次运行指示器与自动滚动到底部。自动滚动策略：
// 用户停留在底部附近时跟随新内容滚动；手动上滚后停止跟随（避免抢夺滚动位置）。
// "滚动到底部"按钮留到任务 6。

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, type UIEvent } from "react";

import type { AgentTimelineItem } from "../agent-stream-types";
import { useAgentMessageStream } from "./use-agent-message-stream";
import { AgentMessageCards } from "./agent-message-cards";
import type { MessageStreamEntry } from "./message-stream-types";

interface AgentMessageStreamProps {
  projectId: number;
  sessionId: number;
}

/** 距底部阈值（px），小于此值视为"贴底"，新内容自动跟随滚动。 */
const PIN_TO_BOTTOM_THRESHOLD_PX = 80;

export function AgentMessageStream({
  projectId,
  sessionId,
}: AgentMessageStreamProps) {
  const state = useAgentMessageStream({ projectId, sessionId });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isPinnedRef = useRef(true);
  const { entries, turnStatus, isInitialized, lastError } = state;

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
  }, [entries.length, lastSignature, turnStatus]);
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
      </div>
      {turnStatus === "running" ? (
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
      ) : null}
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
