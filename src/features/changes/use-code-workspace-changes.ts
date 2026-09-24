import { useCallback, useEffect, useRef, useState } from "react";

import {
  getCommandErrorMessage,
  toCommandError,
  type CommandError,
} from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import {
  createInFlightRequests,
  workspaceRequestKey,
} from "../../shared/workspace/in-flight-requests";
import { useWorkspaceResourceLoading } from "../../shared/workspace/use-workspace-resource-loading";
import {
  getProjectWorktreeChanges,
  type BranchSyncStatus,
  type WorkspaceChangedFile,
} from "../../shared/workspace/workspace-commands";
import {
  getCachedWorkspaceChanges,
  setCachedWorkspaceChanges,
} from "./changes-workspace-cache";
import {
  useCodeWorkspaceCommitHistory,
  type UseCodeWorkspaceCommitHistoryResult,
} from "./use-code-workspace-commit-history";

export interface UseCodeWorkspaceChangesResult extends UseCodeWorkspaceCommitHistoryResult {
  changes: WorkspaceChangedFile[];
  /** 相对 upstream 的同步状态；不可同步时为 null。 */
  branchSync: BranchSyncStatus | null;
  isChangesLoading: boolean;
  changesErrorMessage: string | null;
  isChangesUnavailable: boolean;
  refreshChanges: () => void;
}

/** 在途登记簿的资源名（配合项目 + 工作区根组成 key）。 */
const CHANGES_REQUEST_RESOURCE = "workspace-changes";

/**
 * 代码工作区左侧栏「变更」视图的数据源：未提交变更（本文件）+ 已提交历史
 * （`useCodeWorkspaceCommitHistory`）。按当前选中根的 workspacePath 取数：进入变更
 * 视图（enabled）或切换工作区时各拉取一次，手动刷新可再触发；不做轮询（轮询由
 * useChangesAutoRefresh 调用 refresh*）。
 *
 * 刷新收敛：
 * - 同一资源（资源名 + 项目 + 工作区根）同一时刻至多一个在途请求：轮询 tick、
 *   手动刷新、事件刷新都先尝试登记，登记失败即跳过本次（不作废在途请求）。慢机器 /
 *   大仓库下单次往返超过轮询间隔时，旧实现「新请求作废旧请求」会让每个响应都在
 *   落地前被丢弃，面板永久停在加载态。
 * - 加载态语义为「无展示数据 && 当前根有在途请求」（见 useWorkspaceResourceLoading）；
 *   任何一次结算（成功 / 失败 / 作废）都只收口它自己那次加载态，不再依赖请求序号匹配。
 *
 * soft revalidate（对齐文件树）：
 * - 首次 / 切根 clearStale：清空旧数据并进入 loading。
 * - 已有展示数据时后续 refresh：不进 loading；响应 signature 与上次相同则零
 *   setState（不替换 files/branchSync）；不同则静默更新。
 *
 * 跨卸载保留（见 ADR-0041）：切到别的 Activity 会整棵卸载 ChangesActivity，列表数据
 * 只存在 hook state 时切回必然清空重拉 → 每次都先闪空态 / loading。上次成功响应按
 * 「项目 + 工作区路径」缓存在 changes-workspace-cache，重挂载 / 切根时先回填旧数据
 * 再后台 soft revalidate；无快照（首次访问该工作区）才走 clearStale 进 loading。
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
  const [cacheSnapshot] = useState(() =>
    getCachedWorkspaceChanges(projectId, workspacePath),
  );
  const [changes, setChanges] = useState<WorkspaceChangedFile[]>(
    () => cacheSnapshot?.files ?? [],
  );
  const [branchSync, setBranchSync] = useState<BranchSyncStatus | null>(
    () => cacheSnapshot?.branchSync ?? null,
  );
  const [changesErrorMessage, setChangesErrorMessage] = useState<string | null>(
    null,
  );
  const [isChangesUnavailable, setIsChangesUnavailable] = useState(false);
  const changesRequestSequenceRef = useRef(0);
  const lastChangesSignatureRef = useRef<string | null>(null);
  const changesErrorMessageRef = useRef<string | null>(null);
  const isChangesUnavailableRef = useRef(false);
  const translateRef = useRef(t);
  // 同一资源同一时刻至多一个在途请求；key 含工作区根，切根时新根不被旧根阻塞。
  const [inFlightRequests] = useState(createInFlightRequests);
  const { isLoading: isChangesLoading, controls: changesLoading } =
    useWorkspaceResourceLoading(inFlightRequests);
  const commitHistory = useCodeWorkspaceCommitHistory(
    projectId,
    workspacePath,
    enabled,
    inFlightRequests,
  );

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  const runChangesRequest = useCallback(
    (options: { clearStale: boolean }) => {
      if (!workspacePath) return;
      const requestKey = workspaceRequestKey(
        CHANGES_REQUEST_RESOURCE,
        projectId,
        workspacePath,
      );
      // 同一资源已在途：跳过本次（不作废在途请求），由在途请求的结算收口加载态。
      if (!inFlightRequests.tryBegin(requestKey)) return;
      const requestSequence = (changesRequestSequenceRef.current += 1);

      void Promise.resolve()
        .then(() => {
          // 切换工作区时丢弃旧根数据与 signature，避免短暂展示他根变更 / 误命中去重。
          if (options.clearStale) {
            changesErrorMessageRef.current = null;
            setChangesErrorMessage(null);
            setChanges([]);
            setBranchSync(null);
            isChangesUnavailableRef.current = false;
            setIsChangesUnavailable(false);
            lastChangesSignatureRef.current = null;
            changesLoading.setHasDisplay(false);
          } else if (!changesLoading.hasDisplay()) {
            // 尚无展示数据的首次拉取仍进 loading。
            changesErrorMessageRef.current = null;
            setChangesErrorMessage(null);
          }
          // 加载态 = 无展示数据 && 当前根有在途请求；已有展示数据的 soft revalidate 不进 loading。
          changesLoading.recomputeLoading();
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
            changesLoading.hasDisplay() &&
            !changesLoading.isLoadingNow() &&
            changesErrorMessageRef.current == null &&
            !isChangesUnavailableRef.current
          ) {
            return;
          }
          lastChangesSignatureRef.current = response.signature;
          changesLoading.setHasDisplay(true);
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
        })
        .finally(() => {
          // 任何一次结算（成功 / 失败 / 过期）都收口它自己那次加载态。
          inFlightRequests.settle(requestKey);
          changesLoading.recomputeLoading();
        });
    },
    [changesLoading, inFlightRequests, projectId, workspacePath],
  );

  // 进入变更视图（enabled）、切换工作区或重挂载时各拉取一次。
  // 有缓存快照（上次本工作区的成功响应）→ 先回填旧数据再 soft revalidate，切回变更
  // 窗口时不闪空态 / loading；无快照 → 与旧行为一致，清空旧根数据并进 loading。
  // ref 在 effect 内同步补齐，状态回填放微任务（react-hooks/set-state-in-effect），
  // 微任务先于下方请求微任务执行，故请求能命中「已有展示数据」的 soft revalidate 分支。
  useEffect(() => {
    if (!enabled || !workspacePath) return;

    // 当前展示的资源 key：加载态只由「当前根是否有在途请求」推导，旧根的迟到结算
    // 不得收口新根的加载态。
    changesLoading.setRequestKey(
      workspaceRequestKey(CHANGES_REQUEST_RESOURCE, projectId, workspacePath),
    );

    const cachedChanges = getCachedWorkspaceChanges(projectId, workspacePath);
    if (cachedChanges) {
      changesLoading.setHasDisplay(true);
      lastChangesSignatureRef.current = cachedChanges.signature;
      changesErrorMessageRef.current = null;
      isChangesUnavailableRef.current = false;
      void Promise.resolve().then(() => {
        setChanges(cachedChanges.files);
        setBranchSync(cachedChanges.branchSync);
        changesLoading.recomputeLoading();
        setChangesErrorMessage(null);
        setIsChangesUnavailable(false);
      });
      runChangesRequest({ clearStale: false });
    } else {
      runChangesRequest({ clearStale: true });
    }
  }, [changesLoading, enabled, projectId, runChangesRequest, workspacePath]);

  const refreshChanges = useCallback(
    () => runChangesRequest({ clearStale: false }),
    [runChangesRequest],
  );

  return {
    ...commitHistory,
    changes,
    branchSync,
    isChangesLoading,
    changesErrorMessage,
    isChangesUnavailable,
    refreshChanges,
  };
}

// worktree 目录被删除/移动等不可恢复错误：停止自动行为，交用户手动处理。
function isWorkspaceRootInaccessibleError(error: CommandError): boolean {
  return (error.details ?? []).some(
    (detail) => detail["@type"] === "WorkspaceRoot",
  );
}
