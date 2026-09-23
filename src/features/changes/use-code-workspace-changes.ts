import { useCallback, useEffect, useRef, useState } from "react";

import {
  getCommandErrorMessage,
  toCommandError,
  type CommandError,
} from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import {
  appendUniqueCommitsByHash,
  commitHistoryRefreshLimit,
} from "../../shared/workspace/commit-history-pagination";
import {
  COMMIT_HISTORY_PAGE_SIZE,
  getProjectWorktreeChanges,
  getProjectWorktreeCommitHistory,
  type BranchSyncStatus,
  type WorkspaceChangedFile,
  type WorkspaceCommitRecord,
} from "../../shared/workspace/workspace-commands";
import {
  getCachedWorkspaceChanges,
  getCachedWorkspaceCommitHistory,
  setCachedWorkspaceChanges,
  setCachedWorkspaceCommitHistory,
} from "./changes-workspace-cache";

export interface UseCodeWorkspaceChangesResult {
  changes: WorkspaceChangedFile[];
  /** 相对 upstream 的同步状态；不可同步时为 null。 */
  branchSync: BranchSyncStatus | null;
  isChangesLoading: boolean;
  changesErrorMessage: string | null;
  isChangesUnavailable: boolean;
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
  refreshChanges: () => void;
  refreshCommitHistory: () => void;
  loadMoreCommitHistory: () => void;
}

type CommitHistoryRequestMode = "initial" | "refresh" | "load-more";

/**
 * 代码工作区左侧栏「变更」视图的数据源。按当前选中根的 workspacePath 拉取未提交
 * 变更与已提交历史：进入变更视图（enabled）或切换工作区时各拉取一次，手动刷新可
 * 再触发；不做轮询（轮询由 useChangesAutoRefresh 调用 refresh*）。
 *
 * soft revalidate（对齐文件树）：
 * - 首次 / 切根 clearStale：清空旧数据并进入 loading。
 * - 已有展示数据时后续 refresh：不进 loading；响应 signature 与上次相同则零
 *   setState（不替换 files/branchSync/commits）；不同则静默更新。
 *
 * 跨卸载保留（见 ADR-0041）：切到别的 Activity 会整棵卸载 ChangesActivity，列表数据
 * 只存在 hook state 时切回必然清空重拉 → 每次都先闪空态 / loading。上次成功响应按
 * 「项目 + 工作区路径」缓存在 changes-workspace-cache，重挂载 / 切根时先回填旧数据
 * 再后台 soft revalidate；无快照（首次访问该工作区）才走 clearStale 进 loading。
 *
 * 已提交历史支持分页：首页 50；load-more 按 loadedCount offset 追加；刷新按
 * max(50, loadedCount) 整窗替换且不清空旧列表。刷新优先于 load-more，generation
 * 作废过期响应；同时最多一个 commit-history 请求。
 *
 * 与 Agent 会话侧的 useSessionWorkspaceCache 不同：本 hook 以 workspacePath 为键
 * （无 sessionId），且不轮询；signature 去重 + 请求序号防竞态的写法与会话侧一致。
 * setState 全部放进 Promise 微任务，避免 react-hooks/set-state-in-effect。
 */
export function useCodeWorkspaceChanges(
  projectId: number,
  workspacePath: string | null,
  enabled: boolean,
): UseCodeWorkspaceChangesResult {
  const { t } = useI18n();
  // 挂载首帧就回填缓存快照：惰性 state 承载只读快照（不在 render 期写 ref）。
  const [cacheSnapshot] = useState(() => ({
    changes: getCachedWorkspaceChanges(projectId, workspacePath),
    commitHistory: getCachedWorkspaceCommitHistory(projectId, workspacePath),
  }));
  const [changes, setChanges] = useState<WorkspaceChangedFile[]>(
    () => cacheSnapshot.changes?.files ?? [],
  );
  const [branchSync, setBranchSync] = useState<BranchSyncStatus | null>(
    () => cacheSnapshot.changes?.branchSync ?? null,
  );
  const [isChangesLoading, setIsChangesLoading] = useState(false);
  const [changesErrorMessage, setChangesErrorMessage] = useState<string | null>(
    null,
  );
  const [isChangesUnavailable, setIsChangesUnavailable] = useState(false);
  const [commitHistory, setCommitHistory] = useState<WorkspaceCommitRecord[]>(
    () => cacheSnapshot.commitHistory?.commits ?? [],
  );
  const [isCommitHistoryLoading, setIsCommitHistoryLoading] = useState(false);
  const [commitHistoryErrorMessage, setCommitHistoryErrorMessage] = useState<
    string | null
  >(null);
  const [isWorktree, setIsWorktree] = useState(
    () => cacheSnapshot.commitHistory?.isWorktree ?? false,
  );
  const [baseBranch, setBaseBranch] = useState<string | null>(
    () => cacheSnapshot.commitHistory?.baseBranch ?? null,
  );
  const [hasMoreCommitHistory, setHasMoreCommitHistory] = useState(
    () => cacheSnapshot.commitHistory?.hasMore ?? false,
  );
  const [isLoadingMoreCommitHistory, setIsLoadingMoreCommitHistory] =
    useState(false);
  const [
    loadMoreCommitHistoryErrorMessage,
    setLoadMoreCommitHistoryErrorMessage,
  ] = useState<string | null>(null);
  const changesRequestSequenceRef = useRef(0);
  const lastChangesSignatureRef = useRef<string | null>(null);
  const hasChangesDisplayRef = useRef(false);
  const isChangesLoadingRef = useRef(false);
  const changesErrorMessageRef = useRef<string | null>(null);
  const isChangesUnavailableRef = useRef(false);
  const commitHistoryRequestSequenceRef = useRef(0);
  const lastCommitHistorySignatureRef = useRef<string | null>(null);
  const hasCommitHistoryDisplayRef = useRef(false);
  const isCommitHistoryLoadingRef = useRef(false);
  const commitHistoryErrorMessageRef = useRef<string | null>(null);
  const commitHistoryRef = useRef<WorkspaceCommitRecord[]>([]);
  const hasMoreCommitHistoryRef = useRef(false);
  const commitHistoryInFlightRef = useRef(false);
  const translateRef = useRef(t);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  useEffect(() => {
    commitHistoryRef.current = commitHistory;
  }, [commitHistory]);

  useEffect(() => {
    hasMoreCommitHistoryRef.current = hasMoreCommitHistory;
  }, [hasMoreCommitHistory]);

  const runChangesRequest = useCallback(
    (options: { clearStale: boolean }) => {
      if (!workspacePath) return;
      const requestSequence = (changesRequestSequenceRef.current += 1);

      void Promise.resolve()
        .then(() => {
          // 切换工作区时丢弃旧根数据与 signature，避免短暂展示他根变更 / 误命中去重。
          if (options.clearStale) {
            isChangesLoadingRef.current = true;
            setIsChangesLoading(true);
            changesErrorMessageRef.current = null;
            setChangesErrorMessage(null);
            setChanges([]);
            setBranchSync(null);
            isChangesUnavailableRef.current = false;
            setIsChangesUnavailable(false);
            lastChangesSignatureRef.current = null;
            hasChangesDisplayRef.current = false;
          } else if (!hasChangesDisplayRef.current) {
            // 尚无展示数据的首次拉取仍进 loading。
            isChangesLoadingRef.current = true;
            setIsChangesLoading(true);
            changesErrorMessageRef.current = null;
            setChangesErrorMessage(null);
          }
          // soft revalidate：已有展示数据时不进 loading。
          return getProjectWorktreeChanges({ projectId, workspacePath });
        })
        .then((response) => {
          if (
            !response ||
            changesRequestSequenceRef.current !== requestSequence
          ) {
            return;
          }
          const unchanged =
            lastChangesSignatureRef.current === response.signature;
          // signature 相同且已有展示、无 loading/错误需收口：零 setState。
          if (
            unchanged &&
            hasChangesDisplayRef.current &&
            !isChangesLoadingRef.current &&
            changesErrorMessageRef.current == null &&
            !isChangesUnavailableRef.current
          ) {
            return;
          }
          lastChangesSignatureRef.current = response.signature;
          hasChangesDisplayRef.current = true;
          if (!unchanged) {
            setChanges(response.files);
            setBranchSync(response.branchSync ?? null);
            // 快照紧跟展示数据写入，供下次重挂载首帧回填。
            setCachedWorkspaceChanges(projectId, workspacePath, {
              files: response.files,
              branchSync: response.branchSync ?? null,
              signature: response.signature,
            });
          }
          isChangesLoadingRef.current = false;
          setIsChangesLoading(false);
          changesErrorMessageRef.current = null;
          setChangesErrorMessage(null);
          isChangesUnavailableRef.current = false;
          setIsChangesUnavailable(false);
        })
        .catch((error) => {
          if (changesRequestSequenceRef.current !== requestSequence) return;
          const commandError = toCommandError(error);
          const unavailable = isWorkspaceRootInaccessibleError(commandError);
          isChangesUnavailableRef.current = unavailable;
          setIsChangesUnavailable(unavailable);
          const message = getCommandErrorMessage(error, translateRef.current);
          changesErrorMessageRef.current = message;
          setChangesErrorMessage(message);
          isChangesLoadingRef.current = false;
          setIsChangesLoading(false);
        });
    },
    [projectId, workspacePath],
  );

  const runCommitHistoryRequest = useCallback(
    (mode: CommitHistoryRequestMode) => {
      if (!workspacePath) return;

      if (mode === "load-more") {
        if (!hasMoreCommitHistoryRef.current) return;
        if (commitHistoryInFlightRef.current) return;
      }

      const requestSequence = (commitHistoryRequestSequenceRef.current += 1);
      commitHistoryInFlightRef.current = true;

      // 追加 / 整窗刷新都以「当前展示的整窗」为基准：优先取快照（本工作区最近一次被
      // 采纳的整窗，同步写入，不受渲染时序影响），缺失时兜底渲染镜像 ref。
      // 同一时刻最多一个 commit-history 请求在飞（load-more 遇 in-flight 直接跳过，
      // 刷新会作废先前请求），故该基准在整个请求周期内保持有效。
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
            // 刷新优先：作废进行中的 load-more UI 态。
            setIsLoadingMoreCommitHistory(false);
            setLoadMoreCommitHistoryErrorMessage(null);
            if (mode === "initial") {
              isCommitHistoryLoadingRef.current = true;
              setIsCommitHistoryLoading(true);
              commitHistoryErrorMessageRef.current = null;
              setCommitHistoryErrorMessage(null);
              setCommitHistory([]);
              setHasMoreCommitHistory(false);
              lastCommitHistorySignatureRef.current = null;
              hasCommitHistoryDisplayRef.current = false;
            } else if (!hasCommitHistoryDisplayRef.current) {
              // 尚无展示数据时仍进 loading。
              isCommitHistoryLoadingRef.current = true;
              setIsCommitHistoryLoading(true);
              commitHistoryErrorMessageRef.current = null;
              setCommitHistoryErrorMessage(null);
            }
            // soft revalidate：已有展示数据时 refresh 不进 loading。
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
            hasCommitHistoryDisplayRef.current = true;
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
              hasCommitHistoryDisplayRef.current &&
              !isCommitHistoryLoadingRef.current &&
              commitHistoryErrorMessageRef.current == null
            ) {
              commitHistoryInFlightRef.current = false;
              return;
            }
            lastCommitHistorySignatureRef.current = response.signature;
            hasCommitHistoryDisplayRef.current = true;
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
            isCommitHistoryLoadingRef.current = false;
            setIsCommitHistoryLoading(false);
            commitHistoryErrorMessageRef.current = null;
            setCommitHistoryErrorMessage(null);
          }
          commitHistoryInFlightRef.current = false;
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
            isCommitHistoryLoadingRef.current = false;
            setIsCommitHistoryLoading(false);
          }
          commitHistoryInFlightRef.current = false;
        });
    },
    [projectId, workspacePath],
  );

  // 进入变更视图（enabled）、切换工作区或重挂载时各拉取一次。
  // 有缓存快照（上次本工作区的成功响应）→ 先回填旧数据再 soft revalidate，切回变更
  // 窗口时不闪空态 / loading；无快照 → 与旧行为一致，清空旧根数据并进 loading。
  // ref 在 effect 内同步补齐，状态回填放微任务（react-hooks/set-state-in-effect），
  // 微任务先于下方请求微任务执行，故请求能命中「已有展示数据」的 soft revalidate 分支。
  useEffect(() => {
    if (!enabled || !workspacePath) return;

    const cachedChanges = getCachedWorkspaceChanges(projectId, workspacePath);
    if (cachedChanges) {
      hasChangesDisplayRef.current = true;
      lastChangesSignatureRef.current = cachedChanges.signature;
      isChangesLoadingRef.current = false;
      changesErrorMessageRef.current = null;
      isChangesUnavailableRef.current = false;
      void Promise.resolve().then(() => {
        setChanges(cachedChanges.files);
        setBranchSync(cachedChanges.branchSync);
        setIsChangesLoading(false);
        setChangesErrorMessage(null);
        setIsChangesUnavailable(false);
      });
      runChangesRequest({ clearStale: false });
    } else {
      runChangesRequest({ clearStale: true });
    }

    const cachedCommitHistory = getCachedWorkspaceCommitHistory(
      projectId,
      workspacePath,
    );
    if (cachedCommitHistory) {
      hasCommitHistoryDisplayRef.current = true;
      lastCommitHistorySignatureRef.current = cachedCommitHistory.signature;
      isCommitHistoryLoadingRef.current = false;
      commitHistoryErrorMessageRef.current = null;
      commitHistoryRef.current = cachedCommitHistory.commits;
      hasMoreCommitHistoryRef.current = cachedCommitHistory.hasMore;
      void Promise.resolve().then(() => {
        setCommitHistory(cachedCommitHistory.commits);
        setIsWorktree(cachedCommitHistory.isWorktree);
        setBaseBranch(cachedCommitHistory.baseBranch);
        setHasMoreCommitHistory(cachedCommitHistory.hasMore);
        setIsCommitHistoryLoading(false);
        setCommitHistoryErrorMessage(null);
      });
      runCommitHistoryRequest("refresh");
    } else {
      runCommitHistoryRequest("initial");
    }
  }, [
    enabled,
    projectId,
    workspacePath,
    runChangesRequest,
    runCommitHistoryRequest,
  ]);

  const refreshChanges = useCallback(
    () => runChangesRequest({ clearStale: false }),
    [runChangesRequest],
  );

  const refreshCommitHistory = useCallback(
    () => runCommitHistoryRequest("refresh"),
    [runCommitHistoryRequest],
  );

  const loadMoreCommitHistory = useCallback(
    () => runCommitHistoryRequest("load-more"),
    [runCommitHistoryRequest],
  );

  return {
    changes,
    branchSync,
    isChangesLoading,
    changesErrorMessage,
    isChangesUnavailable,
    commitHistory,
    isCommitHistoryLoading,
    commitHistoryErrorMessage,
    isWorktree,
    baseBranch,
    hasMoreCommitHistory,
    isLoadingMoreCommitHistory,
    loadMoreCommitHistoryErrorMessage,
    refreshChanges,
    refreshCommitHistory,
    loadMoreCommitHistory,
  };
}

// worktree 目录被删除/移动等不可恢复错误：停止自动行为，交用户手动处理。
function isWorkspaceRootInaccessibleError(error: CommandError): boolean {
  return (error.details ?? []).some(
    (detail) => detail["@type"] === "WorkspaceRoot",
  );
}
