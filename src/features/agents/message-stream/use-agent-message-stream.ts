// 结构化消息流的 React hook。
//
// 进入会话时先 `readAgentTimeline` 拿历史 timeline 种子 reducer，再订阅
// `agent-session-stream-event` 事件流。切换 session 时从缓存恢复。
//
// 沿用项目既有范式：`isDisposed` + `unlisten` 双标志，await 期间若已卸载则
// 主动调用 unlisten 防泄漏（参考 `terminal-surface.tsx`、`agent-profile-form.tsx`）。
//
// 性能优化：使用 LRU 缓存最近访问的几个 session 的状态；命中缓存时先提交轻量
// loading 状态，下一帧再恢复大 timeline，避免切换 session 被大量历史 DOM 阻塞。

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

export function clearAgentMessageStreamCacheForTest(): void {
  sessionStateCache.clear();
}

// 更新 session 缓存
function updateCachedSessionState(
  sessionId: number,
  state: MessageStreamState,
) {
  // LRU 清理：如果超过最大数量，删除最久未使用的
  if (
    !sessionStateCache.has(sessionId) &&
    sessionStateCache.size >= MAX_CACHED_SESSIONS
  ) {
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
  // 初始状态保持轻量。缓存恢复在 effect 中延迟到下一帧，保证 session tab
  // 的选中态可以先完成提交。
  const [state, dispatch] = useReducer(
    messageStreamReducer,
    undefined,
    createInitialState,
  );
  const stateSessionIdRef = useRef(sessionId);

  // 监听 state 变化，更新缓存
  useEffect(() => {
    if (stateSessionIdRef.current !== sessionId) {
      return;
    }
    if (!state.isInitialized) {
      return;
    }
    updateCachedSessionState(sessionId, state);
  }, [sessionId, state]);

  useEffect(() => {
    let isDisposed = false;
    // 切换session时立刻重置状态，显示loading，避免旧内容停留
    dispatch({ type: "RESET" });

    // 切换session时立刻重置状态，显示loading，避免旧内容停留

    let unlisten: (() => void) | null = null;
    let pendingEvents: AgentStreamEvent[] = [];
    let deferredEvents: AgentStreamEvent[] = [];
    let isCacheRestored = false;
    let flushHandle: ReturnType<typeof setTimeout> | number | null = null;
    let flushHandleKind: "animation-frame" | "timeout" | null = null;
    let restoreFrameHandle: number | null = null;
    let restoreTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

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

    stateSessionIdRef.current = sessionId;

    const dispatchStreamEvent = (event: AgentStreamEvent) => {
      if (hasCachedInitialized && !isCacheRestored) {
        deferredEvents.push(event);
        return;
      }
      if (event.type !== "timeline") {
        dispatch({ type: "EVENT", event });
        return;
      }
      pendingEvents.push(event);
      scheduleFlush();
    };

    const scheduleCacheRestore = (restore: () => void) => {
      if (typeof window !== "undefined" && "requestAnimationFrame" in window) {
        restoreFrameHandle = window.requestAnimationFrame(() => {
          restoreFrameHandle = null;
          restoreTimeoutHandle = globalThis.setTimeout(() => {
            restoreTimeoutHandle = null;
            restore();
          }, 0);
        });
        return;
      }
      restoreTimeoutHandle = globalThis.setTimeout(() => {
        restoreTimeoutHandle = null;
        restore();
      }, 0);
    };

    async function initialize() {
      // 如果已经有缓存的初始化状态，直接订阅事件，不需要重新读取 timeline
      if (hasCachedInitialized && cachedState) {
        // 分批次恢复缓存，避免一次性渲染大量DOM阻塞主线程
        scheduleCacheRestore(() => {
          if (isDisposed) {
            return;
          }
          isCacheRestored = true;
          cachedState.lastAccessTime = Date.now();

          const fullState = cachedState.state;
          const allEntries = fullState.entries;
          const BATCH_SIZE = 50; // 每次恢复50条

          if (allEntries.length <= BATCH_SIZE) {
            // 条目不多，一次性恢复
            dispatch({ type: "RESTORE", state: fullState });
            if (deferredEvents.length > 0) {
              const events = deferredEvents;
              deferredEvents = [];
              dispatch({ type: "EVENT_BATCH", events });
            }
            return;
          }

          // 先恢复最新的BATCH_SIZE条，让用户尽快看到内容
          let currentEntries = allEntries.slice(-BATCH_SIZE);
          dispatch({
            type: "RESTORE",
            state: {
              ...fullState,
              entries: currentEntries,
            },
          });

          let currentIndex = allEntries.length - BATCH_SIZE;

          // 逐步恢复历史消息，从旧到新
          const restoreNextBatch = () => {
            if (isDisposed || currentIndex <= 0) {
              // 全部恢复完成，处理 deferred events
              if (deferredEvents.length > 0) {
                const events = deferredEvents;
                deferredEvents = [];
                dispatch({ type: "EVENT_BATCH", events });
              }
              return;
            }

            const endIndex = currentIndex;
            currentIndex = Math.max(0, currentIndex - BATCH_SIZE);
            const batchEntries = allEntries.slice(currentIndex, endIndex);

            // 合并到现有 entries 前面
            currentEntries = [...batchEntries, ...currentEntries];
            dispatch({
              type: "RESTORE",
              state: {
                ...fullState,
                entries: currentEntries,
              },
            });

            // 下一帧继续恢复下一批
            restoreFrameHandle = window.requestAnimationFrame(restoreNextBatch);
          };

          // 延迟一帧再开始恢复历史
          restoreFrameHandle = window.requestAnimationFrame(restoreNextBatch);
        });

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
      if (restoreFrameHandle !== null) {
        window.cancelAnimationFrame(restoreFrameHandle);
      }
      if (restoreTimeoutHandle !== null) {
        globalThis.clearTimeout(restoreTimeoutHandle);
      }
      cancelFlush();
      pendingEvents = [];
      deferredEvents = [];
      unlisten?.();
    };
  }, [projectId, sessionId]);

  return { state, dispatch };
}
