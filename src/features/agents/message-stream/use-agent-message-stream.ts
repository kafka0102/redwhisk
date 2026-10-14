// 结构化消息流的 React hook。
//
// 进入会话时先 `readAgentTimeline` 拿历史 timeline 种子 reducer，再订阅
// `agent-session-stream-event` 事件流。切换 session 时从缓存恢复。
//
// 沿用项目既有范式：`isDisposed` + `unlisten` 双标志，await 期间若已卸载则
// 主动调用 unlisten 防泄漏（参考 `terminal-surface.tsx`、`agent-profile-form.tsx`）。
//
// 性能优化：使用 LRU 缓存最近访问的几个 session 的状态。
// 进程内第一次进入才读打开回放；同一次运行里切回直接恢复缓存，不再重读。

import { useEffect, useReducer, useRef } from "react";
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
import { getCommandErrorMessage } from "../../../shared/commands/command-error";
import { useI18n } from "../../../shared/i18n/i18n";

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

// 全局的 session 状态缓存。键含 projectId，避免不同项目的同号会话串缓存。
const sessionStateCache = new Map<string, CachedSessionState>();

function cacheKey(projectId: number, sessionId: number): string {
  return `${projectId}:${sessionId}`;
}

export function clearAgentMessageStreamCacheForTest(): void {
  sessionStateCache.clear();
}

// 更新 session 缓存
function updateCachedSessionState(
  projectId: number,
  sessionId: number,
  state: MessageStreamState,
) {
  const key = cacheKey(projectId, sessionId);
  // LRU 清理：如果超过最大数量，删除最久未使用的
  if (
    !sessionStateCache.has(key) &&
    sessionStateCache.size >= MAX_CACHED_SESSIONS
  ) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [id, cached] of sessionStateCache.entries()) {
      if (cached.lastAccessTime < oldestTime) {
        oldestTime = cached.lastAccessTime;
        oldestKey = id;
      }
    }
    if (oldestKey !== null) {
      sessionStateCache.delete(oldestKey);
    }
  }
  sessionStateCache.set(key, {
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
 * 进程内第一次进入读打开回放。同一次运行里切回沿用缓存，不用新的末尾窗口替换。
 */
export function useAgentMessageStream({
  projectId,
  sessionId,
}: UseAgentMessageStreamArgs): {
  state: MessageStreamState;
  dispatch: Dispatch<MessageStreamAction>;
} {
  const { t } = useI18n();
  // 初始状态保持轻量。缓存恢复在 effect 中延迟到下一帧，保证 session tab
  // 的选中态可以先完成提交。
  const [state, dispatch] = useReducer(
    messageStreamReducer,
    undefined,
    createInitialState,
  );
  const stateSessionIdRef = useRef(sessionId);
  const stateProjectIdRef = useRef(projectId);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 监听 state 变化，更新缓存
  useEffect(() => {
    if (stateSessionIdRef.current !== sessionId) {
      return;
    }
    if (!state.isInitialized) {
      return;
    }
    updateCachedSessionState(projectId, sessionId, state);
  }, [projectId, sessionId, state]);

  useEffect(() => {
    let isDisposed = false;
    const previousSessionId = stateSessionIdRef.current;
    const previousProjectId = stateProjectIdRef.current;
    if (
      (previousSessionId !== sessionId || previousProjectId !== projectId) &&
      stateRef.current.isInitialized
    ) {
      updateCachedSessionState(
        previousProjectId,
        previousSessionId,
        stateRef.current,
      );
    }
    const cachedState = sessionStateCache.get(cacheKey(projectId, sessionId));
    const hasCachedInitialized = cachedState?.state.isInitialized ?? false;
    // 进程内第一次进入才清空。同一次运行里切回直接沿用缓存，避免先闪空再盖掉。
    if (!hasCachedInitialized) {
      dispatch({ type: "RESET" });
    } else {
      dispatch({ type: "RESTORE", state: cachedState!.state });
    }

    let unlisten: (() => void) | null = null;
    let pendingEvents: Array<{
      event: AgentStreamEvent;
      logOffset?: number;
    }> = [];
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

    stateSessionIdRef.current = sessionId;
    stateProjectIdRef.current = projectId;

    // 所有事件走同一有序队列再按帧 flush。
    // 旧实现把 turn_completed 等非 timeline 事件立刻 dispatch，会越过尚未
    // flush 的 assistant_message/reasoning：turn_completed 误把末条 completed
    // tool_call 当成异常中断，后续 batched timeline 再把 turnStatus 恢复成
    // running，于是 session card 已因 grace 结束变蓝点，session view 仍卡在
    // 「思考中」。统一入队可保持事件相对顺序。
    const dispatchStreamEvent = (
      event: AgentStreamEvent,
      logOffset?: number,
    ) => {
      pendingEvents.push({ event, logOffset });
      scheduleFlush();
    };

    async function initialize() {
      // 同一次运行里再次进入：沿用内存中的消息流，不重读打开回放。
      if (hasCachedInitialized && cachedState) {
        cachedState.lastAccessTime = Date.now();

        try {
          unlisten = await subscribeAgentSessionStream((envelope) => {
            if (
              envelope.projectId !== projectId ||
              envelope.sessionId !== sessionId
            ) {
              return;
            }
            dispatchStreamEvent(envelope.event, envelope.logOffset);
          });
          if (isDisposed) {
            unlisten?.();
            unlisten = null;
          }
        } catch {
          // 订阅失败不阻塞：已有消息流仍留在页面上。
        }
        return;
      }

      // 没有缓存的情况下，正常初始化
      try {
        const { items, effort, model } = await readAgentTimeline({
          projectId,
          sessionId,
        });
        if (isDisposed) {
          return;
        }
        dispatch({ type: "HYDRATE", items, effort, model });
      } catch (error) {
        if (isDisposed) {
          return;
        }
        dispatch({
          type: "HYDRATE_FAILED",
          error: getCommandErrorMessage(error, t),
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
          dispatchStreamEvent(envelope.event);
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
  }, [projectId, sessionId, t]);

  return { state, dispatch };
}
