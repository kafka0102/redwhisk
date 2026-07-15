// 结构化消息流的顶层组件。
//
// 负责滚动容器、空态文案、轮次运行指示器与自动滚动到底部。自动滚动策略：
// 用户停留在底部附近时跟随新内容滚动；手动上滚后停止跟随（避免抢夺滚动位置）。
// 长内容（超过两屏）时在右下角显示跳转按钮：贴顶显示向下、贴底显示向上，中间隐藏。
//
// 拆分为两层：
// - `AgentMessageStream`：自包含，内部调 `useAgentMessageStream` 订阅，用于独立场景/测试。
// - `AgentMessageStreamView`：纯渲染，接收外部 `state`，供 `AgentSessionView` 父组件
//   统一订阅后下传，避免双订阅。

import { ArrowDown, ArrowUp, LoaderCircle } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type UIEvent,
} from "react";

import type { AgentTimelineItem } from "../agent-stream-types";
import type { AgentType } from "../agent-session-commands";
import { useI18n } from "../../../shared/i18n/i18n";
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

/** 距顶部阈值（px），小于此值视为"贴顶"，显示回到底部按钮。 */
const SCROLL_TOP_THRESHOLD_PX = 4;

/** 长内容跳转按钮的方向；hidden 时不渲染按钮。 */
type ScrollNavTarget = "hidden" | "to-bottom" | "to-top";

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
  /** 当前 session 的 agent 类型，用于区分 Claude / Codex 的渲染策略。 */
  agentType?: AgentType;
  /** 本 session 是否为当前选中（实例池模式下未被 hidden 遮蔽）。
   * 由 false 变 true 表示用户切换到了本 session。 */
  isActive?: boolean;
  /** 切换到本 session（isActive 由 false 变 true）时是否自动定位到底部。
   * 完成态 session 传 false 以保持原样。 */
  autoScrollOnActivate?: boolean;
}

/**
 * 纯渲染变体：接收外部 state，不自行订阅。
 *
 * 供 `AgentSessionView` 等父组件统一调 `useAgentMessageStream` 后下传，
 * 避免消息流与 composer 各自订阅形成双数据源。
 *
 * memo 化：实例池模式下 state 引用稳定（reducer 不 dispatch 时不变），
 * 父组件因 sessions 列表刷新重渲染时跳过本子树。
 */
export const AgentMessageStreamView = memo(function AgentMessageStreamView({
  state,
  isTurnRunning = false,
  agentType,
  isActive = true,
  autoScrollOnActivate = false,
}: AgentMessageStreamViewProps) {
  const { messages } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isPinnedRef = useRef(true);
  const [navTarget, setNavTarget] = useState<ScrollNavTarget>("hidden");
  const {
    entries,
    turnStatus,
    isInitialized,
    lastError,
    turnInterrupted,
    interruptedStopReason,
  } = state;
  const isClaude = agentType === "claude" || agentType === "claude_code";
  const isTurnActive = turnStatus === "running" || isTurnRunning;
  // Claude Code 首次运行时，从用户消息展示到 Claude 首条输出之间有数秒连接延迟。
  // 此前对 Claude 完全隐藏「正在思考」占位，导致这段空白无反馈。现在改为：
  // Claude 一旦有任意产出（assistant_message/reasoning/tool_call/todo/error/
  // compaction）就永久隐藏占位行；在此之前若 turn 正在运行则展示。
  // Codex 保持原行为（turn 运行时始终展示）。
  const hasClaudeOutput =
    isClaude && entries.some((entry) => entry.kind !== "user_message");
  const shouldShowThinking = isTurnActive && (!isClaude || !hasClaudeOutput);

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
  }, [
    entries.length,
    lastSignature,
    turnStatus,
    shouldShowThinking,
    hasClaudeOutput,
    turnInterrupted,
  ]);
  // 切换到本 session（isActive 由 false 变 true）时，若非完成态且消息流可见，
  // 定位到底部，便于查看正在执行的输出或待确认项。
  // - 完成态（autoScrollOnActivate=false）保持原样，不强行改写滚动位置；
  // - 消息流被其他子 tab 遮蔽（clientHeight 为 0，等价 display:none）时跳过，
  //   避免在隐藏状态下因 scrollHeight 为 0 把 scrollTop 置 0 反而破坏位置。
  // 用 useLayoutEffect 在 paint 前定位，避免切回时先闪现旧位置再跳底。
  const prevIsActiveRef = useRef(isActive);
  useLayoutEffect(() => {
    const wasActive = prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;
    if (!isActive || wasActive || !autoScrollOnActivate) {
      return;
    }
    const node = scrollRef.current;
    if (!node || node.clientHeight === 0) {
      return;
    }
    node.scrollTop = node.scrollHeight;
    isPinnedRef.current = true;
  }, [isActive, autoScrollOnActivate]);
  // 计算长内容跳转按钮方向：仅当内容超过两屏且贴顶/贴底时显示，中间位置隐藏。
  const measureNav = useCallback(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    const { scrollHeight, clientHeight, scrollTop } = node;
    const longEnough = scrollHeight > clientHeight * 2;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    let next: ScrollNavTarget = "hidden";
    if (longEnough) {
      if (scrollTop <= SCROLL_TOP_THRESHOLD_PX) {
        next = "to-bottom";
      } else if (distanceFromBottom <= PIN_TO_BOTTOM_THRESHOLD_PX) {
        next = "to-top";
      }
    }
    setNavTarget((prev) => (prev === next ? prev : next));
  }, []);
  // 内容变化（消息条目 / 思考占位）后等 DOM 提交再重测，覆盖流式增长场景。
  useEffect(() => {
    const id = requestAnimationFrame(measureNav);
    return () => cancelAnimationFrame(id);
  }, [
    entries.length,
    lastSignature,
    turnStatus,
    shouldShowThinking,
    hasClaudeOutput,
    turnInterrupted,
    measureNav,
  ]);
  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const node = event.currentTarget;
    const distanceFromBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight;
    isPinnedRef.current = distanceFromBottom <= PIN_TO_BOTTOM_THRESHOLD_PX;
    measureNav();
  }

  return (
    <div
      className="agents-message-stream"
      aria-label={messages.agentsFeature.messageStream}
      data-initialized={isInitialized}
    >
      <div
        ref={scrollRef}
        className="agents-message-stream__scroll"
        onScroll={handleScroll}
      >
        {!isInitialized ? (
          <div className="agents-message-stream__loading" role="status">
            <LoaderCircle
              aria-hidden="true"
              size={15}
              strokeWidth={2}
              className="agents-message__spinner"
            />
            <span>{messages.settings.loading}</span>
          </div>
        ) : null}
        {isInitialized && entries.length === 0 && !lastError ? (
          <p className="agents-message-stream__empty">
            {messages.agentsFeature.emptyMessageStream}
          </p>
        ) : null}
        {lastError && entries.length === 0 ? (
          <p className="agents-message-stream__error" role="status">
            {lastError}
          </p>
        ) : null}
        <AgentMessageCards entries={entries} />
        {turnInterrupted ? (
          <div className="agents-message__entry agents-message__entry--interrupted">
            <p className="agents-message-stream__interrupted" role="status">
              {interruptedStopReason
                ? messages.agentsFeature.turnInterruptedWithReason(
                    interruptedStopReason,
                  )
                : messages.agentsFeature.turnInterrupted}
            </p>
          </div>
        ) : null}
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
              <span>{messages.agentsFeature.thinking}</span>
            </div>
          </div>
        ) : null}
      </div>
      {navTarget !== "hidden" ? (
        <button
          type="button"
          className="agents-message-stream__nav"
          aria-label={
            navTarget === "to-bottom"
              ? messages.agentsFeature.scrollToBottom
              : messages.agentsFeature.scrollToTop
          }
          onClick={() => {
            const node = scrollRef.current;
            if (!node) {
              return;
            }
            const toTop = navTarget === "to-top";
            const reduceMotion = window.matchMedia(
              "(prefers-reduced-motion: reduce)",
            ).matches;
            node.scrollTo({
              top: toTop ? 0 : node.scrollHeight,
              behavior: reduceMotion ? "auto" : "smooth",
            });
          }}
        >
          {navTarget === "to-bottom" ? (
            <ArrowDown aria-hidden="true" size={16} strokeWidth={2} />
          ) : (
            <ArrowUp aria-hidden="true" size={16} strokeWidth={2} />
          )}
        </button>
      ) : null}
    </div>
  );
});

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
