// 结构化消息流的 React hook。
//
// 进入会话时先 `readAgentTimeline` 拿历史 timeline 种子 reducer，再订阅
// `agent-session-stream-event` 事件流。切换 session 时重置。
//
// 沿用项目既有范式：`isDisposed` + `unlisten` 双标志，await 期间若已卸载则
// 主动调用 unlisten 防泄漏（参考 `terminal-surface.tsx`、`agent-profile-form.tsx`）。

import { useEffect, useReducer } from "react";
import type { Dispatch } from "react";

import type { AgentStreamEvent } from "../agent-stream-types";
import { readAgentTimeline } from "../agent-session-commands";
import { subscribeAgentSessionStream } from "./agent-stream-events";
import {
  createInitialState,
  messageStreamReducer,
} from "./message-stream-reducer";
import type {
  MessageStreamAction,
  MessageStreamState,
} from "./message-stream-types";
import { toCommandError } from "../../../shared/commands/command-error";

interface UseAgentMessageStreamArgs {
  projectId: number;
  sessionId: number;
}

/**
 * 订阅并聚合单个 Agent session 的结构化消息流。
 *
 * 返回当前 `MessageStreamState` 与 `dispatch`；首次加载历史前 `isInitialized`
 * 为 false。`dispatch` 供父组件做乐观更新（如发送消息后立即插入用户消息）。
 */
export function useAgentMessageStream({
  projectId,
  sessionId,
}: UseAgentMessageStreamArgs): {
  state: MessageStreamState;
  dispatch: Dispatch<MessageStreamAction>;
} {
  const [state, dispatch] = useReducer(
    messageStreamReducer,
    undefined,
    createInitialState,
  );

  useEffect(() => {
    let isDisposed = false;
    let unlisten: (() => void) | null = null;
    let pendingEvents: AgentStreamEvent[] = [];
    let flushHandle: ReturnType<typeof setTimeout> | number | null = null;
    let flushHandleKind: "animation-frame" | "timeout" | null = null;

    const scheduleFlush = () => {
      if (flushHandle !== null) {
        return;
      }
      const flush = () => {
        flushHandle = null;
        if (isDisposed || pendingEvents.length === 0) {
          pendingEvents = [];
          return;
        }
        const events = pendingEvents;
        pendingEvents = [];
        dispatch({ type: "EVENT_BATCH", events });
      };
      if (typeof window !== "undefined" && "requestAnimationFrame" in window) {
        flushHandle = window.requestAnimationFrame(flush);
        flushHandleKind = "animation-frame";
      } else {
        flushHandle = globalThis.setTimeout(flush, 16);
        flushHandleKind = "timeout";
      }
    };

    const cancelFlush = () => {
      if (flushHandle === null) {
        return;
      }
      if (
        flushHandleKind === "animation-frame" &&
        typeof window !== "undefined" &&
        "cancelAnimationFrame" in window
      ) {
        window.cancelAnimationFrame(flushHandle as number);
      } else {
        globalThis.clearTimeout(flushHandle);
      }
      flushHandle = null;
      flushHandleKind = null;
    };

    // 切换 session：先重置，避免上一个 session 的残留。
    dispatch({ type: "RESET" });

    async function initialize() {
      try {
        const { items, effort } = await readAgentTimeline({
          projectId,
          sessionId,
        });
        if (isDisposed) {
          return;
        }
        dispatch({ type: "HYDRATE", items, effort });
      } catch (error) {
        if (isDisposed) {
          return;
        }
        dispatch({
          type: "HYDRATE_FAILED",
          error: toCommandError(error).message,
        });
      }

      try {
        unlisten = await subscribeAgentSessionStream((envelope) => {
          if (
            envelope.projectId !== projectId ||
            envelope.sessionId !== sessionId
          ) {
            return;
          }
          if (envelope.event.type !== "timeline") {
            dispatch({ type: "EVENT", event: envelope.event });
            return;
          }
          pendingEvents.push(envelope.event);
          scheduleFlush();
        });
        if (isDisposed) {
          unlisten();
          unlisten = null;
        }
      } catch {
        // 订阅失败不阻塞：用户可刷新历史回放补齐。
      }
    }

    void initialize();

    return () => {
      isDisposed = true;
      cancelFlush();
      pendingEvents = [];
      unlisten?.();
    };
  }, [projectId, sessionId]);

  return { state, dispatch };
}
