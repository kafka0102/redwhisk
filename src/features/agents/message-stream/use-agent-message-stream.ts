// 结构化消息流的 React hook。
//
// 进入会话时先 `readAgentTimeline` 拿历史 timeline 种子 reducer，再订阅
// `agent-session-stream-event` 事件流。切换 session 时从缓存恢复。
//
// 沿用项目既有范式：`isDisposed` + `unlisten` 双标志，await 期间若已卸载则
// 主动调用 unlisten 防泄漏（参考 `terminal-surface.tsx`、`agent-profile-form.tsx`）。
//
// 性能优化：使用 LRU 缓存最近访问的几个 session 的状态，避免每次切换都重新读取 timeline。

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

interface CachedSessionState {
  state: MessageStreamState;
  lastAccessTime: number;
}

// 最大缓存的 session 数量（LRU 策略）
const MAX_CACHED_SESSIONS = 5;

// 全局的 session 状态缓存
const sessionStateCache = new Map<number, CachedSessionState>();

// 获取或创建 session 缓存状态
function getCachedSessionState(sessionId: number): MessageStreamState {
  const cached = sessionStateCache.get(sessionId);
  if (cached) {
    // 更新最后访问时间
    cached.lastAccessTime = Date.now();
    return cached.state;
  }
  return createInitialState();
}

// 更新 session 缓存
function updateCachedSessionState(sessionId: number, state: MessageStreamState) {
  // LRU 清理：如果超过最大数量，删除最久未使用的
  if (sessionStateCache.size >= MAX_CACHED_SESSIONS) {
    let oldestSessionId: number | null = null;
    let oldestTime = Infinity;
    for (const [id, cached] of sessionStateCache.entries()) {
      if (cached.lastAccessTime < oldestTime) {
        oldestTime = cached.lastAccessTime;
        oldestSessionId = id;
      }
    }
    if (oldestSessionId !== null) {
      sessionStateCache.delete(oldestSessionId);
    }
  }
  sessionStateCache.set(sessionId, {
    state,
    lastAccessTime: Date.now(),
  });
}

/**
 * 订阅并聚合单个 Agent session 的结构化消息流。
 *
 * 返回当前 `MessageStreamState` 与 `dispatch`；首次加载历史前 `isInitialized`
 * 为 false。`dispatch` 供父组件做乐观更新（如发送消息后立即插入用户消息）。
 *
 * 性能优化：使用 LRU 缓存最近访问的几个 session，避免每次切换都重新读取 timeline。
 */
export function useAgentMessageStream({
  projectId,
  sessionId,
}: UseAgentMessageStreamArgs): {
  state: MessageStreamState;
  dispatch: Dispatch<MessageStreamAction>;
} {
  // 使用 reducer，但初始状态从缓存获取
  const [state, dispatch] = useReducer(
    messageStreamReducer,
    sessionId,
    getCachedSessionState,
  );

  // 监听 state 变化，更新缓存
  useEffect(() => {
    updateCachedSessionState(sessionId, state);
  }, [sessionId, state]);

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

    // 检查是否已有缓存的初始化状态
    const cachedState = sessionStateCache.get(sessionId);
    const hasCachedInitialized = cachedState?.state.isInitialized ?? false;

    // 如果没有缓存的初始化状态，才需要重置并重新加载
    if (!hasCachedInitialized) {
      dispatch({ type: "RESET" });
    }

    async function initialize() {
      // 如果已经有缓存的初始化状态，直接订阅事件，不需要重新读取 timeline
      if (hasCachedInitialized) {
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
            unlisten?.();
            unlisten = null;
          }
        } catch {
          // 订阅失败不阻塞：用户可刷新历史回放补齐。
        }
        return;
      }

      // 没有缓存的情况下，正常初始化
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
          unlisten?.();
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
