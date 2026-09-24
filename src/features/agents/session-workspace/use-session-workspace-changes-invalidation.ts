import { useEffect } from "react";

import {
  refreshAfterIdle,
  type InFlightRequests,
} from "../../../shared/workspace/in-flight-requests";
import { subscribeDebouncedSessionListChange } from "../agent-session-list-change-subscription";

interface UseSessionWorkspaceChangesInvalidationInput {
  projectId: number;
  sessionId: number | null;
  /** 本会话的在途请求登记簿；无会话时为 null（不订阅）。 */
  inFlightRequests: InFlightRequests | null;
  /** 未提交变更的请求 key（资源名 + 项目 + 会话）；null 表示当前不在看，不刷新。 */
  changesRequestKey: string | null;
  /** 已提交历史的请求 key；null 表示当前不在看（未展开 / 非 changes tab），不刷新。 */
  commitHistoryRequestKey: string | null;
  refreshChanges: () => void;
  refreshCommitHistory: () => void;
}

/**
 * 会话列表变更事件 → 会话右侧栏「未提交变更 / 已提交历史」的失效刷新。
 *
 * 提交发生在 Agent 回合内（应用内没有 commit 命令，提交提示由完成流程注入），回合开始 /
 * 结束会广播会话列表变更事件：命中本项目 + 本会话时去抖后立即刷新，让未提交数量与侧栏
 * 列表立刻收敛，不再等 2s / 5s 的下一个 tick。
 *
 * - 失效刷新走同一在途登记（`refreshAfterIdle`）：在途时不叠加请求，结算后补一次。
 * - 门控由调用方 fold 进 key：失焦 / 侧栏关闭 / 面板未展开 / 仓库不可访问时对应 key 为
 *   null——既不订阅也不刷新；门控收紧时本 effect 的 teardown 会让停泊中的补刷新作废，
 *   后台窗口不会因事件恢复刷新（重新聚焦仍由轮询的 refreshOnActivate 补拉）。
 */
export function useSessionWorkspaceChangesInvalidation({
  projectId,
  sessionId,
  inFlightRequests,
  changesRequestKey,
  commitHistoryRequestKey,
  refreshChanges,
  refreshCommitHistory,
}: UseSessionWorkspaceChangesInvalidationInput): void {
  // 两个资源各自订阅：收起「已提交」面板只作废已提交历史的补刷新，不影响未提交变更
  // （反之亦然）；同一资源仍只有一条订阅、一轮请求。
  useSessionWorkspaceResourceInvalidation({
    projectId,
    sessionId,
    inFlightRequests,
    requestKey: changesRequestKey,
    refresh: refreshChanges,
  });
  useSessionWorkspaceResourceInvalidation({
    projectId,
    sessionId,
    inFlightRequests,
    requestKey: commitHistoryRequestKey,
    refresh: refreshCommitHistory,
  });
}

interface UseSessionWorkspaceResourceInvalidationInput {
  projectId: number;
  sessionId: number | null;
  inFlightRequests: InFlightRequests | null;
  /** null 表示该资源当前不在看（不订阅、不刷新）。 */
  requestKey: string | null;
  refresh: () => void;
}

/**
 * 单个会话侧栏资源的失效订阅：命中「本项目 + 本会话」的事件去抖后，无在途请求立即刷新，
 * 已有在途请求时等它结算后补一次。key 变 null（面板收起 / 切 tab / 关侧栏 / 失焦 / 仓库
 * 不可访问）或切会话 / 卸载时，effect 的 teardown 会让停泊中的补刷新作废。
 */
function useSessionWorkspaceResourceInvalidation({
  projectId,
  sessionId,
  inFlightRequests,
  requestKey,
  refresh,
}: UseSessionWorkspaceResourceInvalidationInput): void {
  useEffect(() => {
    if (inFlightRequests === null) return;
    if (requestKey === null) return;

    let isStillWanted = true;
    const unsubscribe = subscribeDebouncedSessionListChange(
      { projectId, sessionId },
      () => {
        refreshAfterIdle(
          requestKey,
          inFlightRequests,
          refresh,
          () => isStillWanted,
        );
      },
    );

    return () => {
      isStillWanted = false;
      unsubscribe();
    };
  }, [inFlightRequests, projectId, refresh, requestKey, sessionId]);
}
