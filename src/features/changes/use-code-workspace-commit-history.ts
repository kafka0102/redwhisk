import { useCallback, useEffect, useRef, useState } from "react";

import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import {
  appendUniqueCommitsByHash,
  commitHistoryRefreshLimit,
} from "../../shared/workspace/commit-history-pagination";
import {
  type InFlightRequests,
  workspaceRequestKey,
} from "../../shared/workspace/in-flight-requests";
import { useWorkspaceResourceLoading } from "../../shared/workspace/use-workspace-resource-loading";
import {
  COMMIT_HISTORY_PAGE_SIZE,
  getProjectWorktreeCommitHistory,
  type WorkspaceCommitRecord,
} from "../../shared/workspace/workspace-commands";
import {
  getCachedWorkspaceCommitHistory,
  setCachedWorkspaceCommitHistory,
} from "./changes-workspace-cache";

type CommitHistoryRequestMode = "initial" | "refresh" | "load-more";

/** 在途登记簿的资源名（配合项目 + 工作区根组成 key）。 */
const COMMIT_HISTORY_REQUEST_RESOURCE = "workspace-commit-history";

export interface UseCodeWorkspaceCommitHistoryResult {
  commitHistory: WorkspaceCommitRecord[];
  isCommitHistoryLoading: boolean;
  commitHistoryErrorMessage: string | null;
  isWorktree: boolean;
  // worktree 场景下解析出的分叉基分支名；非 worktree / 主分支 / 解析失败时为 null。
  // 透传给变更面板渲染首条黄色提交右侧的黄色 base Tag（spec F3/F5）。
  baseBranch: string | null;
  /** 是否还有更早的已提交历史。 */
  hasMoreCommitHistory: boolean;
  isLoadingMoreCommitHistory: boolean;
  loadMoreCommitHistoryErrorMessage: string | null;
  refreshCommitHistory: () => void;
  loadMoreCommitHistory: () => void;
}

/**
 * 代码工作区「已提交历史」数据源，按当前选中根的 workspacePath 取数并分页。
 *
 * - 首页 50 条；load-more 按 loadedCount offset 追加；刷新按
 *   max(50, loadedCount) 整窗替换且不清空旧列表。
 * - 同一资源同一时刻至多一个在途请求（见 useWorkspaceResourceLoading）：load-more
 *   在途时后台刷新被跳过（不被抢占、也不留下永久加载），切根时新根是新 key 可以
 *   并发，旧根响应由请求序号丢弃。
 * - 加载态只在无展示数据时出现；已有 commits 的刷新静默更新。跨卸载按
 *   「项目 + 工作区路径」缓存上次成功响应（见 ADR-0041），重挂载首帧先回填再
 *   soft revalidate。
 * - setState 全部放进 Promise 微任务，避免 react-hooks/set-state-in-effect。
 */
export function useCodeWorkspaceCommitHistory(
  projectId: number,
  workspacePath: string | null,
  enabled: boolean,
  inFlightRequests: InFlightRequests,
): UseCodeWorkspaceCommitHistoryResult {
  const { t } = useI18n();
  // 挂载首帧就回填缓存快照：惰性 state 承载只读快照（不在 render 期写 ref）。
  const [cacheSnapshot] = useState(() =>
    getCachedWorkspaceCommitHistory(projectId, workspacePath),
  );
  const [commitHistory, setCommitHistory] = useState<WorkspaceCommitRecord[]>(
    () => cacheSnapshot?.commits ?? [],
  );
  const [commitHistoryErrorMessage, setCommitHistoryErrorMessage] = useState<
    string | null
  >(null);
  const [isWorktree, setIsWorktree] = useState(
    () => cacheSnapshot?.isWorktree ?? false,
  );
  const [baseBranch, setBaseBranch] = useState<string | null>(
    () => cacheSnapshot?.baseBranch ?? null,
  );
  const [hasMoreCommitHistory, setHasMoreCommitHistory] = useState(
    () => cacheSnapshot?.hasMore ?? false,
  );
  const [isLoadingMoreCommitHistory, setIsLoadingMoreCommitHistory] =
    useState(false);
  const [
    loadMoreCommitHistoryErrorMessage,
    setLoadMoreCommitHistoryErrorMessage,
  ] = useState<string | null>(null);
  const commitHistoryRequestSequenceRef = useRef(0);
  const lastCommitHistorySignatureRef = useRef<string | null>(null);
  const commitHistoryErrorMessageRef = useRef<string | null>(null);
  const commitHistoryRef = useRef<WorkspaceCommitRecord[]>([]);
  const hasMoreCommitHistoryRef = useRef(false);
  const translateRef = useRef(t);
  const { isLoading: isCommitHistoryLoading, controls } =
    useWorkspaceResourceLoading(inFlightRequests);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  useEffect(() => {
    commitHistoryRef.current = commitHistory;
  }, [commitHistory]);

  useEffect(() => {
    hasMoreCommitHistoryRef.current = hasMoreCommitHistory;
  }, [hasMoreCommitHistory]);

  const runCommitHistoryRequest = useCallback(
    (mode: CommitHistoryRequestMode) => {
      if (!workspacePath) return;

      if (mode === "load-more" && !hasMoreCommitHistoryRef.current) return;

      const requestKey = workspaceRequestKey(
        COMMIT_HISTORY_REQUEST_RESOURCE,
        projectId,
        workspacePath,
      );
      // 同一资源已在途：跳过本次（不作废在途请求）。后台刷新不会抢占 load-more，
      // 也不会因为「新请求作废旧请求」把加载态留成永久。
      if (!inFlightRequests.tryBegin(requestKey)) return;
      const requestSequence = (commitHistoryRequestSequenceRef.current += 1);

      // 追加 / 整窗刷新都以「当前展示的整窗」为基准：优先取快照（本工作区最近一次被
      // 采纳的整窗，同步写入，不受渲染时序影响），缺失时兜底渲染镜像 ref。
      // 同一时刻最多一个 commit-history 请求在飞，故该基准在整个请求周期内保持有效。
      const loadedCommitHistory =
        getCachedWorkspaceCommitHistory(projectId, workspacePath)?.commits ??
        commitHistoryRef.current;
      const loadedCount = loadedCommitHistory.length;
      const limit =
        mode === "load-more"
          ? COMMIT_HISTORY_PAGE_SIZE
          : commitHistoryRefreshLimit(loadedCount);
      const offset = mode === "load-more" ? loadedCount : 0;

      void Promise.resolve()
        .then(() => {
          if (mode === "load-more") {
            setIsLoadingMoreCommitHistory(true);
            setLoadMoreCommitHistoryErrorMessage(null);
          } else {
            // 切根时新 key 可与旧根的 load-more 并发，需作废旧根的 load-more UI 态。
            setIsLoadingMoreCommitHistory(false);
            setLoadMoreCommitHistoryErrorMessage(null);
            if (mode === "initial") {
              commitHistoryErrorMessageRef.current = null;
              setCommitHistoryErrorMessage(null);
              setCommitHistory([]);
              setHasMoreCommitHistory(false);
              lastCommitHistorySignatureRef.current = null;
              controls.setHasDisplay(false);
            } else if (!controls.hasDisplay()) {
              // 尚无展示数据时仍进 loading。
              commitHistoryErrorMessageRef.current = null;
              setCommitHistoryErrorMessage(null);
            }
            // 加载态 = 无展示数据 && 当前根有在途请求；已有展示数据的 refresh 不进 loading。
            controls.recomputeLoading();
          }
          return getProjectWorktreeCommitHistory({
            projectId,
            workspacePath,
            limit,
            offset,
          });
        })
        .then((response) => {
          if (
            !response ||
            commitHistoryRequestSequenceRef.current !== requestSequence
          ) {
            return;
          }
          if (mode === "load-more") {
            const nextCommitHistory = appendUniqueCommitsByHash(
              loadedCommitHistory,
              response.commits,
            );
            setCommitHistory(nextCommitHistory);
            setIsWorktree(response.isWorktree);
            setBaseBranch(response.baseBranch ?? null);
            setHasMoreCommitHistory(response.hasMore);
            // load-more 的 signature 仅代表一页；清空以便下次整窗刷新必应用
            //（快照同步置空，重挂载恢复后也走整窗刷新）。
            lastCommitHistorySignatureRef.current = null;
            controls.setHasDisplay(true);
            setCachedWorkspaceCommitHistory(projectId, workspacePath, {
              commits: nextCommitHistory,
              isWorktree: response.isWorktree,
              baseBranch: response.baseBranch ?? null,
              hasMore: response.hasMore,
              signature: null,
            });
            setIsLoadingMoreCommitHistory(false);
            setLoadMoreCommitHistoryErrorMessage(null);
          } else {
            const unchanged =
              lastCommitHistorySignatureRef.current === response.signature;
            if (
              unchanged &&
              controls.hasDisplay() &&
              !controls.isLoadingNow() &&
              commitHistoryErrorMessageRef.current == null
            ) {
              return;
            }
            lastCommitHistorySignatureRef.current = response.signature;
            controls.setHasDisplay(true);
            if (!unchanged) {
              setCommitHistory(response.commits);
              setIsWorktree(response.isWorktree);
              setBaseBranch(response.baseBranch ?? null);
              setHasMoreCommitHistory(response.hasMore);
              // 快照紧跟展示数据写入，供下次重挂载首帧回填。
              setCachedWorkspaceCommitHistory(projectId, workspacePath, {
                commits: response.commits,
                isWorktree: response.isWorktree,
                baseBranch: response.baseBranch ?? null,
                hasMore: response.hasMore,
                signature: response.signature,
              });
            }
            commitHistoryErrorMessageRef.current = null;
            setCommitHistoryErrorMessage(null);
          }
        })
        .catch((error) => {
          if (commitHistoryRequestSequenceRef.current !== requestSequence) {
            return;
          }
          if (mode === "load-more") {
            setLoadMoreCommitHistoryErrorMessage(
              getCommandErrorMessage(error, translateRef.current),
            );
            setIsLoadingMoreCommitHistory(false);
          } else {
            const message = getCommandErrorMessage(error, translateRef.current);
            commitHistoryErrorMessageRef.current = message;
            setCommitHistoryErrorMessage(message);
          }
        })
        .finally(() => {
          // 任何一次结算（成功 / 失败 / 过期）都收口它自己那次加载态。
          inFlightRequests.settle(requestKey);
          controls.recomputeLoading();
        });
    },
    [controls, inFlightRequests, projectId, workspacePath],
  );

  // 进入变更视图（enabled）、切换工作区或重挂载时各拉取一次。
  // 有缓存快照（上次本工作区的成功响应）→ 先回填旧数据再 soft revalidate，切回变更
  // 窗口时不闪空态 / loading；无快照 → 清空旧根数据并进 loading。
  // ref 在 effect 内同步补齐，状态回填放微任务（react-hooks/set-state-in-effect），
  // 微任务先于请求微任务执行，故请求能命中「已有展示数据」的 soft revalidate 分支。
  useEffect(() => {
    if (!enabled || !workspacePath) return;

    // 当前展示的资源 key：加载态只由「当前根是否有在途请求」推导，旧根的迟到结算
    // 不得收口新根的加载态。
    controls.setRequestKey(
      workspaceRequestKey(
        COMMIT_HISTORY_REQUEST_RESOURCE,
        projectId,
        workspacePath,
      ),
    );

    const cachedCommitHistory = getCachedWorkspaceCommitHistory(
      projectId,
      workspacePath,
    );
    if (cachedCommitHistory) {
      controls.setHasDisplay(true);
      lastCommitHistorySignatureRef.current = cachedCommitHistory.signature;
      commitHistoryErrorMessageRef.current = null;
      commitHistoryRef.current = cachedCommitHistory.commits;
      hasMoreCommitHistoryRef.current = cachedCommitHistory.hasMore;
      void Promise.resolve().then(() => {
        setCommitHistory(cachedCommitHistory.commits);
        setIsWorktree(cachedCommitHistory.isWorktree);
        setBaseBranch(cachedCommitHistory.baseBranch);
        setHasMoreCommitHistory(cachedCommitHistory.hasMore);
        controls.recomputeLoading();
        setCommitHistoryErrorMessage(null);
      });
      runCommitHistoryRequest("refresh");
    } else {
      runCommitHistoryRequest("initial");
    }
  }, [controls, enabled, projectId, workspacePath, runCommitHistoryRequest]);

  const refreshCommitHistory = useCallback(
    () => runCommitHistoryRequest("refresh"),
    [runCommitHistoryRequest],
  );

  const loadMoreCommitHistory = useCallback(
    () => runCommitHistoryRequest("load-more"),
    [runCommitHistoryRequest],
  );

  return {
    commitHistory,
    isCommitHistoryLoading,
    commitHistoryErrorMessage,
    isWorktree,
    baseBranch,
    hasMoreCommitHistory,
    isLoadingMoreCommitHistory,
    loadMoreCommitHistoryErrorMessage,
    refreshCommitHistory,
    loadMoreCommitHistory,
  };
}
