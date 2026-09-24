import { useCallback, useEffect, useRef, useState } from "react";

import {
  type AgentSessionListItem,
  listAgentSessions,
} from "../agents/agent-session-commands";
import { subscribeDebouncedSessionListChange } from "../agents/agent-session-list-change-subscription";
import { useWindowFocus } from "../../shared/window/use-window-focus";
import { useConditionalPolling } from "../../shared/workspace/use-conditional-polling";
import {
  createInFlightRequests,
  workspaceRequestKey,
} from "../../shared/workspace/in-flight-requests";
import { fetchProjectRemotes } from "../../shared/workspace/workspace-commands";

const RUNNING_SESSION_FALLBACK_POLL_MS = 5_000;
const CHANGES_REFRESH_INTERVAL_RUNNING_MS = 4_000;
const CHANGES_REFRESH_INTERVAL_IDLE_MS = 8_000;
/** 主 checkout 可见时后台更新 remote-tracking 的间隔；不嵌套在 4s/8s 本地轮询里。 */
const CHANGES_REMOTE_FETCH_INTERVAL_MS = 60_000;
/** 会话列表（running 判定）在途登记簿的资源名。 */
const RUNNING_SESSIONS_REQUEST_RESOURCE = "worktree-running-sessions";

/**
 * 判定选中 worktree 上是否存在 running turn 的 Agent session。
 *
 * 数据来自 listAgentSessions（传 status=running 只取运行中会话）再按 workspacePath 判定；
 * 监听 agent-session-list-changed 事件，payload 命中本 projectId 时去抖 500ms
 * 重算（先例 agents-activity.tsx），外加 5s 慢速兜底轮询保证事件丢失时仍能收敛。
 * 同一工作区同一时刻至多一个在途会话列表请求：兜底 tick 与事件去抖在途时跳过本次
 * （单次往返超过 5s 时不再按 tick 堆叠请求）。
 * `workspacePath` 为空或未启用 → false。卸载时清理监听与定时器。
 */
export function useWorktreeRunningSession(
  projectId: number,
  workspacePath: string | null,
  enabled: boolean,
): boolean {
  const [isRunning, setIsRunning] = useState(false);
  // 事件（agent-session-list-changed）是主路径；5s 兜底轮询只在窗口可见且聚焦时跑，
  // 失焦的后台窗口不再每 5s 拉一次会话列表。
  const isPollingActive = useWindowFocus();
  const [inFlightRequests] = useState(createInFlightRequests);

  useEffect(() => {
    if (!enabled || !workspacePath) {
      // setState 放进微任务，避免 react-hooks/set-state-in-effect。
      void Promise.resolve().then(() => setIsRunning(false));
      return;
    }

    let isDisposed = false;
    let fallbackTimer: number | null = null;

    const recompute = () => {
      const requestKey = workspaceRequestKey(
        RUNNING_SESSIONS_REQUEST_RESOURCE,
        projectId,
        workspacePath,
      );
      // 同一工作区已在途：跳过本次（不作废在途请求），running 状态由在途请求收口。
      if (!inFlightRequests.tryBegin(requestKey)) return;
      // 命令调用放进微任务：同步抛错也走 catch/finally，不让在途登记悬挂。
      void Promise.resolve()
        .then(() => listAgentSessions(projectId, { status: "running" }))
        .then((response) => {
          if (isDisposed) return;
          setIsRunning(hasRunningTurn(response.sessions, workspacePath));
        })
        .catch(() => {
          // 拉取失败时保持既有 running 标志，下次事件 / 兜底轮询会重试。
        })
        .finally(() => {
          inFlightRequests.settle(requestKey);
        });
    };

    if (isPollingActive) {
      recompute();
      fallbackTimer = window.setInterval(
        recompute,
        RUNNING_SESSION_FALLBACK_POLL_MS,
      );
    }

    const unsubscribe = subscribeDebouncedSessionListChange(
      { projectId },
      recompute,
    );

    return () => {
      isDisposed = true;
      if (fallbackTimer !== null) window.clearInterval(fallbackTimer);
      unsubscribe();
    };
  }, [projectId, workspacePath, enabled, isPollingActive, inFlightRequests]);

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
  /** 选中 worktree 上是否存在 running turn，由 useWorktreeRunningSession 提供。 */
  running: boolean;
  refreshChanges: () => void;
  refreshCommitHistory: () => void;
  /**
   * 会话列表变更事件（回合开始 / 结束，Agent 可能刚提交）命中的即时失效入口：
   * 无在途请求立即刷新；已有在途请求时等它结算后补一次，不叠加、不丢失。
   * `isStillWanted` 在补刷新发起前求值（续延期间门控收紧时返回 false 即可放弃）。
   */
  invalidateChanges: (isStillWanted: () => boolean) => void;
  invalidateCommitHistory: (isStillWanted: () => boolean) => void;
  /** worktree 不可恢复（isWorkspaceRootInaccessibleError）时停轮询。 */
  isUnavailable: boolean;
  /** 项目 ID；主 checkout 后台 fetch 需要。 */
  projectId: number;
  /** 当前选中根路径；为空时不后台 fetch。 */
  workspacePath: string | null;
  /**
   * 是否项目主 checkout。仅主 checkout 做低频 `git fetch`（后端 remote ops
   * 同样只允许主根）；linked worktree 只做本地 4s/8s 轮询。
   */
  isProjectRoot: boolean;
}

/**
 * 变更视图条件轮询：可见 + running turn → 4s；可见 + 空闲 → 8s；隐藏 → 暂停。
 * 每次 tick 同时刷新未提交变更与已提交历史。由隐藏恢复可见时立即补拉一次；
 * worktree 不可恢复（isUnavailable）→ 停轮询，待切分支重置 / 再次可见时重试。
 * 另：会话列表变更事件（回合开始 / 结束，Agent 可能在回合内提交）在聚焦窗口下去抖
 * 立即失效未提交变更与已提交历史——提交后数量收敛走这条主路径，4s/8s 只做兜底。
 *
 * 另：项目主 checkout 且页面可见时，激活即后台 `fetch_project_remotes`
 *（`git fetch --all --prune`，fire-and-forget 不阻塞首屏），之后每 60s 再拉；
 * 成功后再 soft revalidate 本地变更数据，使远端 push 能驱动 ahead/behind 与
 *「同步更改」。fetch 失败静默忽略，不打断本地轮询。不嵌套进 4s/8s 路径。
 * 变更 Activity 切走会卸载本 hook：若仅「首拍等满 60s」则短时进入永远发现不了
 * 远端 behind（用户体感「一直暂无未提交变更」）。
 *
 * 不在挂载或工作区切换时主动补拉本地数据——useCodeWorkspaceChanges 已在进入
 * 视图 / 切分支时各拉取一次（signature 去重），轮询 hook 只在「由隐藏恢复可见」
 * 与「定时 tick」时触发，避免制造冗余请求。
 */
export function useChangesAutoRefresh({
  enabled,
  running,
  refreshChanges,
  refreshCommitHistory,
  invalidateChanges,
  invalidateCommitHistory,
  isUnavailable,
  projectId,
  workspacePath,
  isProjectRoot,
}: UseChangesAutoRefreshOptions): void {
  const [isVisible, setIsVisible] = useState(
    typeof document === "undefined" || document.visibilityState === "visible",
  );
  // 失焦窗口（多窗口时的后台窗口）不轮询、也不做后台 fetch；重新聚焦立即补拉一次。
  const isWindowFocused = useWindowFocus();
  const isPollingActive = isVisible && isWindowFocused;
  const wasPollingActiveRef = useRef(isPollingActive);
  const remoteFetchInFlightRef = useRef(false);

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

  // 由隐藏/失焦恢复 → 立即补拉一次本地数据（挂载时已是初始激活态，跳过）。
  useEffect(() => {
    if (!enabled) {
      wasPollingActiveRef.current = isPollingActive;
      return;
    }
    if (!wasPollingActiveRef.current && isPollingActive && !isUnavailable) {
      refresh();
    }
    wasPollingActiveRef.current = isPollingActive;
  }, [isPollingActive, enabled, isUnavailable, refresh]);

  // 失效信号：会话列表变更（回合开始 / 结束，Agent 可能在回合内真的 `git commit`）
  // → 去抖后即时刷新未提交变更与已提交历史，让数量与列表立刻收敛，不再等下一个 tick。
  // 门控与轮询一致（enabled + 可见 + 聚焦 + 仓库可访问）：多窗口下后台窗口不因事件恢复
  // 刷新；门控收紧（失焦 / 隐藏 / 切根 / 卸载）时 effect teardown 一到，既丢掉未到期的去抖
  // 窗口，也让停泊在「等在途结算」上的补刷新作废，恢复可见仍走既有补拉。
  useEffect(() => {
    if (!enabled || !isPollingActive || isUnavailable) {
      return;
    }

    let isStillWanted = true;
    const unsubscribe = subscribeDebouncedSessionListChange(
      { projectId },
      () => {
        const isStillWantedNow = () => isStillWanted;
        invalidateChanges(isStillWantedNow);
        invalidateCommitHistory(isStillWantedNow);
      },
    );

    return () => {
      isStillWanted = false;
      unsubscribe();
    };
  }, [
    enabled,
    invalidateChanges,
    invalidateCommitHistory,
    isPollingActive,
    isUnavailable,
    projectId,
  ]);

  // 档位定时器：可见、聚焦且非 unavailable 时按 running 选 4s/8s；隐藏 / 失焦 → 不起定时器。
  // refreshOnActivate=false：挂载 / 门控激活都不补拉（外层 useCodeWorkspaceChanges
  // 已在进入视图 / 切分支时首拉；「由隐藏恢复可见」的补拉由上方 recovery effect 负责）。
  useConditionalPolling({
    refresh,
    intervalMs: running
      ? CHANGES_REFRESH_INTERVAL_RUNNING_MS
      : CHANGES_REFRESH_INTERVAL_IDLE_MS,
    isActive: enabled && isPollingActive && !isUnavailable,
    refreshOnActivate: false,
  });

  // 主 checkout 后台 fetch：更新 origin/* 后走既有 soft revalidate。
  // 与 4s/8s 本地轮询解耦；失败静默；同一时刻最多一个 in-flight。
  // 激活（挂载 / 由 hidden 恢复 / 切回主根）时立即首拍一次：变更 Activity 切走会
  // 卸载本 hook，仅 setInterval(60s) 会导致「短时多次进入永远不 fetch」。
  useEffect(() => {
    const canFetchRemote =
      enabled &&
      isPollingActive &&
      !isUnavailable &&
      isProjectRoot &&
      workspacePath != null &&
      workspacePath.length > 0;
    if (!canFetchRemote) {
      return;
    }

    let isDisposed = false;

    const runRemoteFetch = () => {
      if (isDisposed || remoteFetchInFlightRef.current) {
        return;
      }
      remoteFetchInFlightRef.current = true;
      void fetchProjectRemotes({ projectId, workspacePath })
        .then(() => {
          if (isDisposed) return;
          refresh();
        })
        .catch(() => {
          // 网络 / 凭证失败：保留旧 UI，下次间隔再试；本地轮询不受影响。
        })
        .finally(() => {
          remoteFetchInFlightRef.current = false;
        });
    };

    runRemoteFetch();
    const timerId = window.setInterval(
      runRemoteFetch,
      CHANGES_REMOTE_FETCH_INTERVAL_MS,
    );
    return () => {
      isDisposed = true;
      window.clearInterval(timerId);
    };
  }, [
    enabled,
    isPollingActive,
    isUnavailable,
    isProjectRoot,
    projectId,
    workspacePath,
    refresh,
  ]);
}
