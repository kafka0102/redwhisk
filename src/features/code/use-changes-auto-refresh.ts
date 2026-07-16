import { useCallback, useEffect, useRef, useState } from "react";

import {
  type AgentSessionListItem,
  listAgentSessions,
} from "../agents/agent-session-commands";
import {
  type AgentSessionListChangedEvent,
  subscribeAgentSessionListChanged,
} from "../agents/agent-session-events";

const SESSION_LIST_EVENT_REFRESH_DEBOUNCE_MS = 500;
const RUNNING_SESSION_FALLBACK_POLL_MS = 5_000;
const CHANGES_REFRESH_INTERVAL_RUNNING_MS = 4_000;
const CHANGES_REFRESH_INTERVAL_IDLE_MS = 8_000;

/**
 * 判定选中 worktree 上是否存在 running turn 的 Agent session。
 *
 * 数据来自 listAgentSessions 全量过滤（无按 worktree 取 session 的专用 command）；
 * 监听 agent-session-list-changed 事件，payload 命中本 projectId 时去抖 500ms
 * 重算（先例 agents-activity.tsx），外加 5s 慢速兜底轮询保证事件丢失时仍能收敛。
 * `workspacePath` 为空或未启用 → false。卸载时清理监听与定时器。
 */
export function useWorktreeRunningSession(
  projectId: number,
  workspacePath: string | null,
  enabled: boolean,
): boolean {
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (!enabled || !workspacePath) {
      // setState 放进微任务，避免 react-hooks/set-state-in-effect。
      void Promise.resolve().then(() => setIsRunning(false));
      return;
    }

    let isDisposed = false;
    let debounceTimer: number | null = null;
    let fallbackTimer: number | null = null;
    let unlisten: (() => void) | null = null;

    const recompute = () => {
      void listAgentSessions(projectId)
        .then((response) => {
          if (isDisposed) return;
          setIsRunning(hasRunningTurn(response.sessions, workspacePath));
        })
        .catch(() => {
          // 拉取失败时保持既有 running 标志，下次事件 / 兜底轮询会重试。
        });
    };

    const scheduleRecompute = () => {
      if (debounceTimer !== null) return;
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        recompute();
      }, SESSION_LIST_EVENT_REFRESH_DEBOUNCE_MS);
    };

    recompute();
    fallbackTimer = window.setInterval(
      recompute,
      RUNNING_SESSION_FALLBACK_POLL_MS,
    );

    void subscribeAgentSessionListChanged(
      (event: AgentSessionListChangedEvent) => {
        if (event.projectId !== projectId) return;
        scheduleRecompute();
      },
    ).then((nextUnlisten) => {
      if (isDisposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    return () => {
      isDisposed = true;
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      if (fallbackTimer !== null) window.clearInterval(fallbackTimer);
      unlisten?.();
    };
  }, [projectId, workspacePath, enabled]);

  return isRunning;
}

function hasRunningTurn(
  sessions: AgentSessionListItem[],
  workspacePath: string,
): boolean {
  return sessions.some(
    (session) =>
      session.workspacePath === workspacePath &&
      session.status === "running" &&
      session.isTurnRunning === true,
  );
}

export interface UseChangesAutoRefreshOptions {
  /** 仅 changes 视图启用；files 视图传 false 不起任何定时器与监听。 */
  enabled: boolean;
  workspacePath: string | null;
  /** 选中 worktree 上是否存在 running turn，由 useWorktreeRunningSession 提供。 */
  running: boolean;
  refreshChanges: () => void;
  refreshCommitHistory: () => void;
  /** worktree 不可恢复（isWorkspaceRootInaccessibleError）时停轮询。 */
  isUnavailable: boolean;
}

/**
 * 变更视图条件轮询：可见 + running turn → 4s；可见 + 空闲 → 8s；隐藏 → 暂停。
 * 每次 tick 同时刷新未提交变更与已提交历史。由隐藏恢复可见时立即补拉一次；
 * worktree 不可恢复（isUnavailable）→ 停轮询，待切分支重置 / 再次可见时重试。
 *
 * 不在挂载或 workspacePath 变化时主动补拉——useCodeWorkspaceChanges 已在进入
 * 视图 / 切分支时各拉取一次（signature 去重），轮询 hook 只在「由隐藏恢复可见」
 * 与「定时 tick」时触发，避免制造冗余请求。
 */
export function useChangesAutoRefresh({
  enabled,
  workspacePath,
  running,
  refreshChanges,
  refreshCommitHistory,
  isUnavailable,
}: UseChangesAutoRefreshOptions): void {
  const [isVisible, setIsVisible] = useState(
    typeof document === "undefined" || document.visibilityState === "visible",
  );
  const wasVisibleRef = useRef(isVisible);

  const refresh = useCallback(() => {
    refreshChanges();
    refreshCommitHistory();
  }, [refreshChanges, refreshCommitHistory]);

  // 可见性监听：enabled 期间同步一次真实可见性（避免未监听时段 state stale），
  // 并在 visibilitychange 时更新。挂载不触发事件，故不会在挂载时补拉。
  // setState 放进微任务，避免 react-hooks/set-state-in-effect。
  useEffect(() => {
    if (!enabled) return;
    void Promise.resolve().then(() => {
      setIsVisible(document.visibilityState === "visible");
    });
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled]);

  // 由隐藏恢复可见 → 立即补拉一次（挂载时 wasVisibleRef 已为初始可见，跳过）。
  useEffect(() => {
    if (!enabled) {
      wasVisibleRef.current = isVisible;
      return;
    }
    if (!wasVisibleRef.current && isVisible && !isUnavailable) {
      refresh();
    }
    wasVisibleRef.current = isVisible;
  }, [isVisible, enabled, isUnavailable, refresh]);

  // 档位定时器：可见且非 unavailable 时按 running 选 4s/8s；隐藏 → 不起定时器。
  useEffect(() => {
    if (!enabled || !isVisible || isUnavailable) return;
    const interval = running
      ? CHANGES_REFRESH_INTERVAL_RUNNING_MS
      : CHANGES_REFRESH_INTERVAL_IDLE_MS;
    const timerId = window.setInterval(() => {
      refresh();
    }, interval);
    return () => {
      window.clearInterval(timerId);
    };
  }, [enabled, isVisible, running, isUnavailable, workspacePath, refresh]);
}
