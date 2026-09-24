/**
 * 单个工作区资源的加载态簿记：`isLoading = 无展示数据 && 当前资源有在途请求`。
 *
 * 变更列表 / 提交历史 / 会话侧栏这类数据由多档轮询、手动刷新、事件刷新共同驱动：
 *
 * - 已有展示数据的任何后台刷新都不进入加载态，绝不用加载态盖掉旧内容；
 * - 加载态只由「当前资源 key 是否仍在途」推导，不依赖请求序号匹配：切换工作区根
 *   后，旧根的迟到结算既不会收口新根的加载态，也不会把加载态留成永久。
 *
 * 与 `InFlightRequests` 配合使用：登记成功即视为该 key 有在途请求。key 里必须带
 * 项目与工作区根，切根后由 `setRequestKey` 指向新 key。
 */

import { useCallback, useMemo, useRef, useState } from "react";

import type { InFlightRequests } from "./in-flight-requests";

/**
 * 加载态簿记的控制接口。身份稳定，可直接进 hook 的依赖数组。
 */
export interface WorkspaceResourceLoadingControls {
  /** ref 语义的同步查询，供请求回调在同一 tick 内读取。 */
  isLoadingNow(): boolean;
  /** ref 语义：当前是否有展示数据。 */
  hasDisplay(): boolean;
  /** 标记展示数据有无：切根清空 / 无数据失败 → false；成功响应 → true。 */
  setHasDisplay(hasDisplay: boolean): void;
  /** 记录当前资源 key（资源名 + 项目 + 工作区根）；null 表示无当前资源。 */
  setRequestKey(requestKey: string | null): void;
  /** 依据「无展示数据 && 当前 key 有在途请求」重新推导加载态并收敛 state。 */
  recomputeLoading(): void;
}

export interface WorkspaceResourceLoadingResult {
  /** 渲染用加载态。 */
  isLoading: boolean;
  controls: WorkspaceResourceLoadingControls;
}

export function useWorkspaceResourceLoading(
  inFlightRequests: InFlightRequests,
): WorkspaceResourceLoadingResult {
  const [isLoading, setIsLoading] = useState(false);
  const isLoadingRef = useRef(false);
  const hasDisplayRef = useRef(false);
  const requestKeyRef = useRef<string | null>(null);

  const recomputeLoading = useCallback(() => {
    const requestKey = requestKeyRef.current;
    const nextIsLoading =
      !hasDisplayRef.current &&
      requestKey !== null &&
      inFlightRequests.isInFlight(requestKey);
    if (isLoadingRef.current === nextIsLoading) return;
    isLoadingRef.current = nextIsLoading;
    setIsLoading(nextIsLoading);
  }, [inFlightRequests]);

  const isLoadingNow = useCallback(() => isLoadingRef.current, []);

  const hasDisplay = useCallback(() => hasDisplayRef.current, []);

  const setHasDisplay = useCallback((nextHasDisplay: boolean) => {
    hasDisplayRef.current = nextHasDisplay;
  }, []);

  const setRequestKey = useCallback((requestKey: string | null) => {
    requestKeyRef.current = requestKey;
  }, []);

  const controls = useMemo<WorkspaceResourceLoadingControls>(
    () => ({
      isLoadingNow,
      hasDisplay,
      setHasDisplay,
      setRequestKey,
      recomputeLoading,
    }),
    [hasDisplay, isLoadingNow, recomputeLoading, setHasDisplay, setRequestKey],
  );

  return { isLoading, controls };
}
