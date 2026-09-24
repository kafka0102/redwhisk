import { useCallback, useMemo, useRef, useState } from "react";

import {
  getCommandErrorMessage,
  toCommandError,
  type CommandError,
} from "../../../shared/commands/command-error";
import { useI18n } from "../../../shared/i18n/i18n";
import {
  appendUniqueCommitsByHash,
  commitHistoryRefreshLimit,
} from "../../../shared/workspace/commit-history-pagination";
import { buildFileTreeDecorations } from "../../../shared/workspace/file-tree-git-decorations";
import {
  createInFlightRequests,
  type InFlightRequests,
  workspaceRequestKey,
} from "../../../shared/workspace/in-flight-requests";
import {
  ROOT_FILE_TREE_DIRECTORY,
  assembleFileTree,
  fileTreeDirectoryPathsToLoad,
  isFileTreeDirectoryLoaded,
  normalizeFileTreeDirectoryPath,
  upsertFileTreeListing,
  type FileTreeDirectoryListing,
} from "../../../shared/workspace/file-tree-listings";
import { useConditionalPolling } from "../../../shared/workspace/use-conditional-polling";
import { useWindowFocus } from "../../../shared/window/use-window-focus";
import { useSessionWorkspaceChangesInvalidation } from "./use-session-workspace-changes-invalidation";
import {
  COMMIT_HISTORY_PAGE_SIZE,
  getProjectWorktreeChanges,
  getProjectWorktreeCommitHistory,
  getProjectWorktreeFileTree,
  readProjectWorktreeDiff,
  readProjectWorktreeFile,
  type WorkspaceCommitChangedFile,
  type WorkspaceCommitRecord,
  type WorkspaceChangedFile,
  type WorkspaceFileTreeNode,
} from "./session-workspace-commands";
import type {
  SessionSidePanelTab,
  SessionWorkspaceChangeTab,
  SessionWorkspaceFileTab,
  SessionWorkspaceTabKind,
} from "./session-workspace-types";
import {
  formatCommitChangeTabLabel,
  isSingleFileChangeTab,
} from "./session-workspace-types";
import { mapPool } from "../../../shared/workspace/map-pool";
import type {
  MultiDiffFileState,
  MultiDiffViewMode,
} from "../../../shared/workspace/multi-diff-types";
import { clearSessionFileReadingPositions } from "./session-file-reading-position";

const CHANGES_POLL_INTERVAL_MS = 2_000;
const COMMIT_HISTORY_POLL_INTERVAL_MS = 5_000;
const FILE_TREE_POLL_INTERVAL_MS = 5_000;
/** 提交全部更改多文件 diff 有界并发上限。 */
const MULTI_DIFF_CONCURRENCY = 5;
/** 在途登记簿的资源名（配合项目 + 会话组成 key）。 */
const CHANGES_REQUEST_RESOURCE = "session-workspace-changes";
const COMMIT_HISTORY_REQUEST_RESOURCE = "session-workspace-commit-history";

interface UseSessionWorkspaceCacheInput {
  projectId: number;
  sessionId: number | null;
  isSidePanelOpen: boolean;
}

/**
 * 单个 session 的 workspace tab 状态快照（只读）。
 *
 * 供实例池中非当前 session 的 `SessionWorkspacePane` 渲染自己冻结的 tab 选中态、
 * file / change tab 内容。
 */
export interface SessionWorkspaceTabState {
  activeWorkspaceTab: SessionWorkspaceTabKind;
  fileTab: SessionWorkspaceFileTab | null;
  changeTab: SessionWorkspaceChangeTab | null;
}

interface SessionWorkspaceCache {
  activeWorkspaceTab: SessionWorkspaceTabKind;
  changeTab: SessionWorkspaceChangeTab | null;
  changes: WorkspaceChangedFile[];
  changesErrorMessage: string | null;
  changesRequestSequence: number;
  committedChangesExpanded: boolean;
  uncommittedChangesExpanded: boolean;
  commitHistory: WorkspaceCommitRecord[];
  isCommitFromWorktree: boolean;
  // worktree 场景下解析出的分叉基分支名；非 worktree / 主分支 / 解析失败时为 null。
  // 透传到 SessionSidePanel -> SessionChangesPanel 渲染首条黄色提交右侧的黄色 base Tag。
  baseBranch: string | null;
  /** 是否还有更早的已提交历史。 */
  hasMoreCommitHistory: boolean;
  isLoadingMoreCommitHistory: boolean;
  loadMoreCommitHistoryErrorMessage: string | null;
  commitHistoryErrorMessage: string | null;
  commitHistoryRequestSequence: number;
  fileTab: SessionWorkspaceFileTab | null;
  fileTree: WorkspaceFileTreeNode[];
  fileTreeListings: Record<string, FileTreeDirectoryListing>;
  fileTreeErrorMessage: string | null;
  /** 未提交变更是否已有可展示数据（含空列表的成功响应）：加载态 = 无展示数据 && 在途。 */
  hasChangesDisplay: boolean;
  /** 已提交历史是否已有可展示数据（含空列表的成功响应）。 */
  hasCommitHistoryDisplay: boolean;
  isChangesLoading: boolean;
  isChangesUnavailable: boolean;
  isCommitHistoryLoading: boolean;
  isFileTreeLoading: boolean;
  lastCommitHistorySignature: string | null;
  lastChangesSignature: string | null;
  lastFileTreeSignature: string | null;
  sidePanelTab: SessionSidePanelTab;
}

const sessionWorkspaceCacheBySessionId = new Map<
  number,
  SessionWorkspaceCache
>();
const inFlightRequestsBySessionId = new Map<number, InFlightRequests>();
const fileTreeListingSequenceByKey = new Map<string, number>();

/**
 * 会话侧栏资源 key：资源名 + 项目 + 会话（会话即本 hook 的工作区标识）。
 */
function sessionWorkspaceRequestKey(
  resource: string,
  projectId: number,
  sessionId: number,
): string {
  return workspaceRequestKey(resource, projectId, `session:${sessionId}`);
}

/**
 * 会话侧栏的在途请求登记簿，与 module-level 会话缓存同寿命（删除会话 / 测试隔离时一并丢弃）。
 *
 * 同一会话同一资源（未提交变更 / 已提交历史）同一时刻至多一个在途请求：轮询 tick、
 * 重新展开 / 切回 Tab 的补拉、手动刷新都先尝试登记，登记失败即跳过本次而不作废在途请求。
 * 否则慢机器 / 大仓库下单次往返超过轮询间隔时，每个响应都会在落地前被下一个 tick 作废，
 * 面板永久停在加载态。登记簿跨 hook 实例存活：快速重挂载复用同一份在途状态，不并发发起。
 */
function inFlightRequestsForSession(sessionId: number): InFlightRequests {
  const existing = inFlightRequestsBySessionId.get(sessionId);
  if (existing) {
    return existing;
  }
  const next = createInFlightRequests();
  inFlightRequestsBySessionId.set(sessionId, next);
  return next;
}

/**
 * 会话侧栏加载标记在缓存里的字段：未提交变更 / 已提交历史各一个。
 */
type ResourceLoadingField = "isChangesLoading" | "isCommitHistoryLoading";

/**
 * 推导并收敛加载态：加载态 = 无展示数据 && 本资源有在途请求（与
 * `useWorkspaceResourceLoading` 同一语义）。
 *
 * 会话侧栏的数据与加载态同存于 module-level Map（跨 Activity 卸载复用，且按会话隔离），
 * 因此这里在缓存里直接推导，而不是用基于 React state 的 `useWorkspaceResourceLoading`：
 * 已有展示数据时后台刷新 / 补拉 / 手动刷新都不进加载态，任何一次结算（成功 / 失败 /
 * 过期 / 被跳过）都收口它自己那次加载态。返回同一引用表示无需更新缓存（不触发无谓重渲染）。
 */
function reconcileResourceLoading(
  cache: SessionWorkspaceCache,
  loadingField: ResourceLoadingField,
  hasDisplay: boolean,
  inFlightRequests: InFlightRequests,
  requestKey: string,
): SessionWorkspaceCache {
  const isLoading = !hasDisplay && inFlightRequests.isInFlight(requestKey);
  return cache[loadingField] === isLoading
    ? cache
    : { ...cache, [loadingField]: isLoading };
}

function fileTreeListingSeqKey(
  sessionId: number,
  directoryPath: string,
): string {
  return `${sessionId}::${directoryPath}`;
}

function bumpFileTreeListingSequence(
  sessionId: number,
  directoryPath: string,
): number {
  const key = fileTreeListingSeqKey(sessionId, directoryPath);
  const next = (fileTreeListingSequenceByKey.get(key) ?? 0) + 1;
  fileTreeListingSequenceByKey.set(key, next);
  return next;
}

function isCurrentFileTreeListingSequence(
  sessionId: number,
  directoryPath: string,
  requestSequence: number,
): boolean {
  return (
    fileTreeListingSequenceByKey.get(
      fileTreeListingSeqKey(sessionId, directoryPath),
    ) === requestSequence
  );
}

/**
 * 清除指定 sessionId 的 workspace tab 缓存。
 *
 * 供 Session 删除流程调用：agent_sessions.id 无 AUTOINCREMENT，删除后可能被复用，
 * 不清则旧 file / change tab 会串入复用该 id 的新 Session。
 */
export function clearSessionWorkspaceCache(sessionId: number): void {
  sessionWorkspaceCacheBySessionId.delete(sessionId);
  // agent_sessions.id 可能被复用：连同该会话的在途登记一起丢弃，避免新会话首次取数被旧
  // 会话的在途请求挡住。
  inFlightRequestsBySessionId.delete(sessionId);
  // agent_sessions.id 可能被复用：一并清掉该 session 的文件阅读位置，避免串味。
  clearSessionFileReadingPositions(sessionId);
}

/**
 * 清空全部 session workspace cache。仅供测试隔离使用：module-level 单例会跨用例残留。
 */
export function clearSessionWorkspaceCacheForTest(): void {
  sessionWorkspaceCacheBySessionId.clear();
  inFlightRequestsBySessionId.clear();
  fileTreeListingSequenceByKey.clear();
}

const defaultWorkspaceCache = (): SessionWorkspaceCache => ({
  activeWorkspaceTab: "session",
  changeTab: null,
  changes: [],
  changesErrorMessage: null,
  changesRequestSequence: 0,
  // Session 侧默认两个面板均展开（进程内默认值，不落盘，与 code-workspace 侧持久化于
  // codeWorkspaceStateCache 的两个默认展开值观感一致）：进入「变更」Tab 即看到提交历史，
  // 并触发已提交历史首次拉取与后续 5s 轮询（见 committed 轮询 effect）；收起面板 / 切走
  // Tab / 关闭侧栏即停止轮询。
  committedChangesExpanded: true,
  uncommittedChangesExpanded: true,
  commitHistory: [],
  isCommitFromWorktree: false,
  baseBranch: null,
  hasMoreCommitHistory: false,
  isLoadingMoreCommitHistory: false,
  loadMoreCommitHistoryErrorMessage: null,
  commitHistoryErrorMessage: null,
  commitHistoryRequestSequence: 0,
  fileTab: null,
  fileTree: [],
  fileTreeListings: {},
  fileTreeErrorMessage: null,
  hasChangesDisplay: false,
  hasCommitHistoryDisplay: false,
  isChangesLoading: false,
  isChangesUnavailable: false,
  isCommitHistoryLoading: false,
  isFileTreeLoading: false,
  lastCommitHistorySignature: null,
  lastChangesSignature: null,
  lastFileTreeSignature: null,
  sidePanelTab: "changes",
});

export function useSessionWorkspaceCache({
  projectId,
  sessionId,
  isSidePanelOpen,
}: UseSessionWorkspaceCacheInput) {
  const { t } = useI18n();
  // 失焦窗口（多窗口后台窗口）不轮询侧栏数据：2s 变更 + 5s 文件树 / 提交历史会按
  // 窗口数线性叠加；重新聚焦由 useConditionalPolling 的 refreshOnActivate 补拉。
  const isWindowFocused = useWindowFocus();
  // 跨 Activity 卸载复用同一份 module-level Map：切走 Issues/Code 再回来时
  // 保留已打开的 file / change tab，而不是随着 hook 实例销毁丢失。
  const cacheBySessionRef = useRef(sessionWorkspaceCacheBySessionId);
  const [, setCacheVersion] = useState(0);

  const currentCache =
    sessionId == null
      ? defaultWorkspaceCache()
      : getSessionCache(cacheBySessionRef.current, sessionId);

  // 按指定 sessionId 更新其 workspace cache。
  //
  // 与 `updateCurrentCache` 的区别：它不依赖当前 `sessionId` 闭包，可被实例池中
  // 非当前 session 的 `SessionWorkspacePane` 用来操作自己的 tab 状态（切换/关闭
  // terminal、browser 等）。由于 sessionId 来自外部参数且通过 ref 写入 Map，
  // 该回调身份稳定（空依赖），不会因 currentSessionId 切换而变化。
  const updateSessionCache = useCallback(
    (
      targetSessionId: number,
      updater: (cache: SessionWorkspaceCache) => SessionWorkspaceCache,
    ) => {
      const cache = getSessionCache(cacheBySessionRef.current, targetSessionId);
      const nextCache = updater(cache);
      // 引用未变时跳过 setState，避免 agent 流式重渲染 / 轮询无变化时
      // 把整棵 AgentsActivity 连带文件树一起刷掉（点击会感觉迟钝）。
      if (nextCache === cache) {
        return;
      }
      cacheBySessionRef.current.set(targetSessionId, nextCache);
      setCacheVersion((currentVersion) => currentVersion + 1);
    },
    [],
  );

  const updateCurrentCache = useCallback(
    (updater: (cache: SessionWorkspaceCache) => SessionWorkspaceCache) => {
      if (sessionId == null) {
        return;
      }
      updateSessionCache(sessionId, updater);
    },
    [sessionId, updateSessionCache],
  );

  // 读取任意 sessionId 的 workspace tab 状态（只读快照）。
  //
  // 供实例池中非当前 session 的 `SessionWorkspacePane` 读取自己冻结的 tab 状态
  // （activeWorkspaceTab / fileTab / changeTab）。非当前 session 的 tab 状态在
  // 切走后不再变化，仅在「切换 session」触发 `AgentsActivity` 重渲染时被重新读取，
  // 因此无需额外的订阅机制即可拿到最新值。
  const getWorkspaceTabState = useCallback(
    (targetSessionId: number): SessionWorkspaceTabState => {
      const cache = cacheBySessionRef.current.get(targetSessionId);
      if (!cache) {
        const fallback = defaultWorkspaceCache();
        return {
          activeWorkspaceTab: fallback.activeWorkspaceTab,
          fileTab: fallback.fileTab,
          changeTab: fallback.changeTab,
        };
      }
      return {
        activeWorkspaceTab: cache.activeWorkspaceTab,
        fileTab: cache.fileTab,
        changeTab: cache.changeTab,
      };
    },
    [],
  );

  const refreshChanges = useCallback(async () => {
    if (sessionId == null) {
      return;
    }

    const requestSessionId = sessionId;
    const requestKey = sessionWorkspaceRequestKey(
      CHANGES_REQUEST_RESOURCE,
      projectId,
      requestSessionId,
    );
    const inFlightRequests = inFlightRequestsForSession(requestSessionId);
    // 同一资源已在途：跳过本次（不作废在途请求），加载态由在途请求的结算收口。
    if (!inFlightRequests.tryBegin(requestKey)) {
      return;
    }

    let requestSequence = 0;
    updateSessionCache(requestSessionId, (cache) =>
      reconcileResourceLoading(
        {
          ...cache,
          changesRequestSequence: (requestSequence =
            cache.changesRequestSequence + 1),
          changesErrorMessage: null,
        },
        "isChangesLoading",
        cache.hasChangesDisplay,
        inFlightRequests,
        requestKey,
      ),
    );

    try {
      const response = await getProjectWorktreeChanges({
        projectId,
        sessionId: requestSessionId,
      });

      updateSessionCache(requestSessionId, (cache) =>
        cache.changesRequestSequence === requestSequence
          ? {
              ...cache,
              changes:
                cache.lastChangesSignature === response.signature
                  ? cache.changes
                  : response.files,
              hasChangesDisplay: true,
              isChangesLoading: false,
              changesErrorMessage: null,
              isChangesUnavailable: false,
              lastChangesSignature: response.signature,
            }
          : cache,
      );
    } catch (error) {
      const commandError = toCommandError(error);
      const isUnavailable = isWorkspaceRootInaccessibleError(commandError);
      updateSessionCache(requestSessionId, (cache) =>
        cache.changesRequestSequence === requestSequence
          ? {
              ...cache,
              isChangesLoading: false,
              changesErrorMessage: getCommandErrorMessage(error, t),
              isChangesUnavailable: isUnavailable,
            }
          : cache,
      );
    } finally {
      // 任何一次结算（成功 / 失败 / 过期）都收口它自己那次加载态。
      inFlightRequests.settle(requestKey);
      updateSessionCache(requestSessionId, (cache) =>
        reconcileResourceLoading(
          cache,
          "isChangesLoading",
          cache.hasChangesDisplay,
          inFlightRequests,
          requestKey,
        ),
      );
    }
  }, [projectId, sessionId, updateSessionCache, t]);

  const fetchFileTreeDirectory = useCallback(
    async (targetSessionId: number, directoryPath: string, force: boolean) => {
      const pathKey = normalizeFileTreeDirectoryPath(directoryPath);
      const cache = sessionWorkspaceCacheBySessionId.get(targetSessionId);
      if (
        !force &&
        cache != null &&
        isFileTreeDirectoryLoaded(
          cache.fileTreeListings,
          cache.fileTree,
          pathKey,
        )
      ) {
        return;
      }
      const requestSequence = bumpFileTreeListingSequence(
        targetSessionId,
        pathKey,
      );
      try {
        const response = await getProjectWorktreeFileTree({
          projectId,
          sessionId: targetSessionId,
          directoryPath:
            pathKey === ROOT_FILE_TREE_DIRECTORY ? undefined : pathKey,
        });
        if (
          !isCurrentFileTreeListingSequence(
            targetSessionId,
            pathKey,
            requestSequence,
          )
        ) {
          return;
        }
        updateSessionCache(targetSessionId, (current) => {
          const listings = upsertFileTreeListing(
            current.fileTreeListings,
            pathKey,
            { nodes: response.nodes, signature: response.signature },
          );
          if (
            listings === current.fileTreeListings &&
            !current.isFileTreeLoading &&
            current.fileTreeErrorMessage == null
          ) {
            return current;
          }
          const fileTree = assembleFileTree(listings);
          const rootSignature =
            listings[ROOT_FILE_TREE_DIRECTORY]?.signature ??
            current.lastFileTreeSignature;
          return {
            ...current,
            fileTree,
            fileTreeListings: listings,
            isFileTreeLoading: false,
            fileTreeErrorMessage: null,
            lastFileTreeSignature: rootSignature,
          };
        });
      } catch (error) {
        if (
          !isCurrentFileTreeListingSequence(
            targetSessionId,
            pathKey,
            requestSequence,
          )
        ) {
          return;
        }
        if (pathKey !== ROOT_FILE_TREE_DIRECTORY) {
          return;
        }
        updateSessionCache(targetSessionId, (current) => ({
          ...current,
          isFileTreeLoading: false,
          fileTreeErrorMessage: getCommandErrorMessage(error, t),
        }));
      }
    },
    [projectId, t, updateSessionCache],
  );

  const loadDirectory = useCallback(
    (directoryPath: string) => {
      if (sessionId == null) {
        return;
      }
      void fetchFileTreeDirectory(sessionId, directoryPath, false);
    },
    [fetchFileTreeDirectory, sessionId],
  );

  const refreshFileTree = useCallback(async () => {
    if (sessionId == null) {
      return;
    }

    const currentCache =
      sessionWorkspaceCacheBySessionId.get(sessionId) ??
      defaultWorkspaceCache();
    const directoryPaths = fileTreeDirectoryPathsToLoad(
      currentCache.fileTreeListings,
    );

    // 仅在尚无树数据时进入 loading；后台轮询不写 cache，避免侧栏无意义重渲染。
    updateCurrentCache((cache) => {
      if (cache.fileTree.length > 0) {
        return cache;
      }
      return {
        ...cache,
        isFileTreeLoading: true,
        fileTreeErrorMessage: null,
      };
    });

    await Promise.all(
      directoryPaths.map((directoryPath) =>
        fetchFileTreeDirectory(sessionId, directoryPath, true),
      ),
    );
  }, [fetchFileTreeDirectory, sessionId, updateCurrentCache]);

  const refreshCommitHistory = useCallback(async () => {
    if (sessionId == null) {
      return;
    }

    const requestSessionId = sessionId;
    const requestKey = sessionWorkspaceRequestKey(
      COMMIT_HISTORY_REQUEST_RESOURCE,
      projectId,
      requestSessionId,
    );
    const inFlightRequests = inFlightRequestsForSession(requestSessionId);
    // 同一资源已在途（后台刷新或 load-more）：跳过本次，加载态由在途请求的结算收口。
    // 因此后台刷新不抢占在途的 load-more，也不会把「新请求作废旧请求」变成永久加载。
    if (!inFlightRequests.tryBegin(requestKey)) {
      return;
    }

    let requestSequence = 0;
    let loadedCount = 0;
    updateSessionCache(requestSessionId, (cache) => {
      requestSequence = cache.commitHistoryRequestSequence + 1;
      loadedCount = cache.commitHistory.length;
      return reconcileResourceLoading(
        {
          ...cache,
          commitHistoryRequestSequence: requestSequence,
          commitHistoryErrorMessage: null,
        },
        "isCommitHistoryLoading",
        cache.hasCommitHistoryDisplay,
        inFlightRequests,
        requestKey,
      );
    });

    try {
      const response = await getProjectWorktreeCommitHistory({
        projectId,
        sessionId: requestSessionId,
        limit: commitHistoryRefreshLimit(loadedCount),
        offset: 0,
      });

      updateSessionCache(requestSessionId, (cache) =>
        cache.commitHistoryRequestSequence === requestSequence
          ? {
              ...cache,
              commitHistory:
                cache.lastCommitHistorySignature === response.signature
                  ? cache.commitHistory
                  : response.commits,
              isCommitFromWorktree: response.isWorktree,
              baseBranch: response.baseBranch ?? null,
              hasMoreCommitHistory:
                cache.lastCommitHistorySignature === response.signature
                  ? cache.hasMoreCommitHistory
                  : response.hasMore,
              hasCommitHistoryDisplay: true,
              isCommitHistoryLoading: false,
              commitHistoryErrorMessage: null,
              // 整窗刷新成功在语义上覆盖上一轮失败的 load-more：清掉它的错误提示，
              // 否则该错误会永久挡住面板的自动连拉与后续重试。
              loadMoreCommitHistoryErrorMessage: null,
              lastCommitHistorySignature: response.signature,
            }
          : cache,
      );
    } catch (error) {
      updateSessionCache(requestSessionId, (cache) =>
        cache.commitHistoryRequestSequence === requestSequence
          ? {
              ...cache,
              isCommitHistoryLoading: false,
              commitHistoryErrorMessage: getCommandErrorMessage(error, t),
            }
          : cache,
      );
    } finally {
      // 任何一次结算（成功 / 失败 / 过期）都收口它自己那次加载态。
      inFlightRequests.settle(requestKey);
      updateSessionCache(requestSessionId, (cache) =>
        reconcileResourceLoading(
          cache,
          "isCommitHistoryLoading",
          cache.hasCommitHistoryDisplay,
          inFlightRequests,
          requestKey,
        ),
      );
    }
  }, [projectId, sessionId, updateSessionCache, t]);

  const loadMoreCommitHistory = useCallback(async () => {
    if (sessionId == null) {
      return;
    }

    const requestSessionId = sessionId;
    const requestKey = sessionWorkspaceRequestKey(
      COMMIT_HISTORY_REQUEST_RESOURCE,
      projectId,
      requestSessionId,
    );
    const inFlightRequests = inFlightRequestsForSession(requestSessionId);
    // 与整窗刷新共用同一资源登记：后台刷新在途时 load-more 跳过（由在途请求的结算收口），
    // 在途 load-more 也同样挡住后台刷新，二者不会互相作废。
    if (!inFlightRequests.tryBegin(requestKey)) {
      return;
    }

    let requestSequence = 0;
    let loadedCount = 0;
    let shouldRequest = false;
    updateSessionCache(requestSessionId, (cache) => {
      if (!cache.hasMoreCommitHistory) {
        return cache;
      }
      shouldRequest = true;
      requestSequence = cache.commitHistoryRequestSequence + 1;
      loadedCount = cache.commitHistory.length;
      return {
        ...cache,
        commitHistoryRequestSequence: requestSequence,
        isLoadingMoreCommitHistory: true,
        loadMoreCommitHistoryErrorMessage: null,
      };
    });
    if (!shouldRequest) {
      inFlightRequests.settle(requestKey);
      return;
    }

    try {
      const response = await getProjectWorktreeCommitHistory({
        projectId,
        sessionId: requestSessionId,
        limit: COMMIT_HISTORY_PAGE_SIZE,
        offset: loadedCount,
      });

      updateSessionCache(requestSessionId, (cache) =>
        cache.commitHistoryRequestSequence === requestSequence
          ? {
              ...cache,
              commitHistory: appendUniqueCommitsByHash(
                cache.commitHistory,
                response.commits,
              ),
              isCommitFromWorktree: response.isWorktree,
              baseBranch: response.baseBranch ?? null,
              hasMoreCommitHistory: response.hasMore,
              // 分页 signature 仅代表一页，清空以便下次整窗刷新必应用。
              lastCommitHistorySignature: null,
              hasCommitHistoryDisplay: true,
              isLoadingMoreCommitHistory: false,
              loadMoreCommitHistoryErrorMessage: null,
            }
          : cache,
      );
    } catch (error) {
      updateSessionCache(requestSessionId, (cache) =>
        cache.commitHistoryRequestSequence === requestSequence
          ? {
              ...cache,
              isLoadingMoreCommitHistory: false,
              loadMoreCommitHistoryErrorMessage: getCommandErrorMessage(
                error,
                t,
              ),
            }
          : cache,
      );
    } finally {
      inFlightRequests.settle(requestKey);
    }
  }, [projectId, sessionId, updateSessionCache, t]);

  const setSidePanelTab = useCallback(
    (tab: SessionSidePanelTab) => {
      updateCurrentCache((cache) => ({ ...cache, sidePanelTab: tab }));
    },
    [updateCurrentCache],
  );

  const setSidePanelTabForSession = useCallback(
    (targetSessionId: number, tab: SessionSidePanelTab) => {
      updateSessionCache(targetSessionId, (cache) => ({
        ...cache,
        sidePanelTab: tab,
      }));
    },
    [updateSessionCache],
  );

  // 切换任意 sessionId 的 activeWorkspaceTab。供实例池中非当前 session 的
  // `SessionWorkspacePane` 操作自己 tab 选中态（虽然 hidden 时无法交互，但保持
  // 回调身份稳定，避免触发 memo 化的 pane 不必要重渲染）。
  const selectWorkspaceTabForSession = useCallback(
    (targetSessionId: number, tab: SessionWorkspaceTabKind) => {
      updateSessionCache(targetSessionId, (cache) => ({
        ...cache,
        activeWorkspaceTab: tab,
      }));
    },
    [updateSessionCache],
  );

  const selectWorkspaceTab = useCallback(
    (tab: SessionWorkspaceTabKind) => {
      if (sessionId == null) {
        return;
      }
      selectWorkspaceTabForSession(sessionId, tab);
    },
    [sessionId, selectWorkspaceTabForSession],
  );

  // 关闭任意 sessionId 的指定 workspace tab（file / changes）。terminal / browser
  // tab 的关闭由 `AgentsActivity` 通过 `terminalPanelStateBySessionId` /
  // `browserTabsBySessionId` 自行管理，不走此路径。
  const closeWorkspaceTabForSession = useCallback(
    (
      targetSessionId: number,
      tab: Exclude<SessionWorkspaceTabKind, "session">,
    ) => {
      updateSessionCache(targetSessionId, (cache) => {
        const nextCache = {
          ...cache,
          changeTab: tab === "changes" ? null : cache.changeTab,
          fileTab: tab === "file" ? null : cache.fileTab,
        };

        return {
          ...nextCache,
          activeWorkspaceTab:
            cache.activeWorkspaceTab === tab
              ? "session"
              : cache.activeWorkspaceTab,
        };
      });
    },
    [updateSessionCache],
  );

  const closeWorkspaceTab = useCallback(
    (tab: Exclude<SessionWorkspaceTabKind, "session">) => {
      if (sessionId == null) {
        return;
      }
      closeWorkspaceTabForSession(sessionId, tab);
    },
    [sessionId, closeWorkspaceTabForSession],
  );

  const openChange = useCallback(
    async (change: WorkspaceChangedFile) => {
      if (sessionId == null) {
        return;
      }

      updateCurrentCache((cache) => ({
        ...cache,
        activeWorkspaceTab: "changes",
        changeTab: {
          mode: "file",
          fileName: change.fileName,
          filePath: change.filePath,
          change,
          commitHash: null,
          diff:
            isSingleFileChangeTab(cache.changeTab) &&
            cache.changeTab.filePath === change.filePath &&
            cache.changeTab.commitHash == null
              ? cache.changeTab.diff
              : null,
          errorMessage: null,
          isLoading: true,
        },
      }));

      try {
        const diff = await readProjectWorktreeDiff({
          projectId,
          sessionId,
          filePath: change.filePath,
        });

        updateCurrentCache((cache) => ({
          ...cache,
          changeTab:
            isSingleFileChangeTab(cache.changeTab) &&
            cache.changeTab.filePath === change.filePath &&
            cache.changeTab.commitHash == null
              ? {
                  ...cache.changeTab,
                  diff,
                  errorMessage: null,
                  isLoading: false,
                }
              : cache.changeTab,
        }));
      } catch (error) {
        updateCurrentCache((cache) => ({
          ...cache,
          changeTab:
            isSingleFileChangeTab(cache.changeTab) &&
            cache.changeTab.filePath === change.filePath &&
            cache.changeTab.commitHash == null
              ? {
                  ...cache.changeTab,
                  errorMessage: getCommandErrorMessage(error, t),
                  isLoading: false,
                }
              : cache.changeTab,
        }));
      }
    },
    [projectId, sessionId, updateCurrentCache, t],
  );

  const openCommittedChange = useCallback(
    async (commitHash: string, change: WorkspaceCommitChangedFile) => {
      if (sessionId == null) {
        return;
      }

      updateCurrentCache((cache) => ({
        ...cache,
        activeWorkspaceTab: "changes",
        changeTab: {
          mode: "file",
          fileName: change.fileName,
          filePath: change.filePath,
          change,
          commitHash,
          diff:
            isSingleFileChangeTab(cache.changeTab) &&
            cache.changeTab.filePath === change.filePath &&
            cache.changeTab.commitHash === commitHash
              ? cache.changeTab.diff
              : null,
          errorMessage: null,
          isLoading: true,
        },
      }));

      try {
        const diff = await readProjectWorktreeDiff({
          projectId,
          sessionId,
          filePath: change.filePath,
          commitHash,
        });

        updateCurrentCache((cache) => ({
          ...cache,
          changeTab:
            isSingleFileChangeTab(cache.changeTab) &&
            cache.changeTab.filePath === change.filePath &&
            cache.changeTab.commitHash === commitHash
              ? {
                  ...cache.changeTab,
                  diff,
                  errorMessage: null,
                  isLoading: false,
                }
              : cache.changeTab,
        }));
      } catch (error) {
        updateCurrentCache((cache) => ({
          ...cache,
          changeTab:
            isSingleFileChangeTab(cache.changeTab) &&
            cache.changeTab.filePath === change.filePath &&
            cache.changeTab.commitHash === commitHash
              ? {
                  ...cache.changeTab,
                  errorMessage: getCommandErrorMessage(error, t),
                  isLoading: false,
                }
              : cache.changeTab,
        }));
      }
    },
    [projectId, sessionId, updateCurrentCache, t],
  );

  const openCommitChanges = useCallback(
    (commit: WorkspaceCommitRecord, mode: MultiDiffViewMode) => {
      if (sessionId == null) {
        return;
      }

      const requestSessionId = sessionId;
      const initialFiles: MultiDiffFileState[] = commit.files.map((file) => ({
        fileName: file.fileName,
        filePath: file.filePath,
        status: file.status,
        kind: file.kind,
        diff: null,
        isLoading: true,
        errorMessage: null,
      }));

      updateSessionCache(requestSessionId, (cache) => ({
        ...cache,
        activeWorkspaceTab: "changes",
        changeTab: {
          mode: "multi",
          label: formatCommitChangeTabLabel(
            commit.shortHash,
            commit.message,
            mode === "summary"
              ? t("agentsFeature.commitChangeSummaryTabLabel")
              : null,
          ),
          commitHash: commit.hash,
          multiDiff: {
            commitHash: commit.hash,
            mode,
            files: initialFiles,
          },
        },
      }));

      if (commit.files.length === 0) {
        return;
      }

      void mapPool(
        commit.files,
        MULTI_DIFF_CONCURRENCY,
        async (file: WorkspaceCommitChangedFile) => {
          try {
            const diff = await readProjectWorktreeDiff({
              projectId,
              sessionId: requestSessionId,
              filePath: file.filePath,
              commitHash: commit.hash,
            });
            updateSessionCache(requestSessionId, (cache) => {
              if (
                cache.changeTab?.mode !== "multi" ||
                cache.changeTab.commitHash !== commit.hash
              ) {
                return cache;
              }
              return {
                ...cache,
                changeTab: {
                  ...cache.changeTab,
                  multiDiff: {
                    ...cache.changeTab.multiDiff,
                    files: cache.changeTab.multiDiff.files.map((entry) =>
                      entry.filePath === file.filePath
                        ? {
                            ...entry,
                            diff,
                            errorMessage: null,
                            isLoading: false,
                          }
                        : entry,
                    ),
                  },
                },
              };
            });
          } catch (error) {
            updateSessionCache(requestSessionId, (cache) => {
              if (
                cache.changeTab?.mode !== "multi" ||
                cache.changeTab.commitHash !== commit.hash
              ) {
                return cache;
              }
              return {
                ...cache,
                changeTab: {
                  ...cache.changeTab,
                  multiDiff: {
                    ...cache.changeTab.multiDiff,
                    files: cache.changeTab.multiDiff.files.map((entry) =>
                      entry.filePath === file.filePath
                        ? {
                            ...entry,
                            errorMessage: getCommandErrorMessage(error, t),
                            isLoading: false,
                          }
                        : entry,
                    ),
                  },
                },
              };
            });
          }
        },
      );
    },
    [projectId, sessionId, updateSessionCache, t],
  );

  const openFile = useCallback(
    async (file: WorkspaceFileTreeNode) => {
      if (sessionId == null || file.kind !== "file") {
        return;
      }

      // 与 CodeWorkspace 对齐：已打开且仍在加载 / 已有内容时不重复读盘，
      // 避免连点同一文件触发二次 IO 与全量 cache 刷新。
      let shouldFetch = true;
      updateCurrentCache((cache) => {
        const existing =
          cache.fileTab?.filePath === file.path ? cache.fileTab : null;
        if (existing != null) {
          shouldFetch = false;
          if (
            cache.activeWorkspaceTab === "file" &&
            (existing.content != null ||
              existing.isLoading ||
              existing.errorMessage != null)
          ) {
            return cache;
          }
          return {
            ...cache,
            activeWorkspaceTab: "file",
            fileTab: existing,
          };
        }
        return {
          ...cache,
          activeWorkspaceTab: "file",
          fileTab: {
            fileName: file.name,
            filePath: file.path,
            content: null,
            errorMessage: null,
            isLoading: true,
          },
        };
      });

      if (!shouldFetch) {
        return;
      }

      try {
        const content = await readProjectWorktreeFile({
          projectId,
          sessionId,
          filePath: file.path,
        });

        updateCurrentCache((cache) => ({
          ...cache,
          fileTab:
            cache.fileTab?.filePath === file.path
              ? {
                  ...cache.fileTab,
                  content,
                  errorMessage: null,
                  isLoading: false,
                }
              : cache.fileTab,
        }));
      } catch (error) {
        updateCurrentCache((cache) => ({
          ...cache,
          fileTab:
            cache.fileTab?.filePath === file.path
              ? {
                  ...cache.fileTab,
                  errorMessage: getCommandErrorMessage(error, t),
                  isLoading: false,
                }
              : cache.fileTab,
        }));
      }
    },
    [projectId, sessionId, updateCurrentCache, t],
  );

  // 仓库路径不可访问属于不可恢复错误：worktree 目录已被删除或移动，继续轮询只会
  // 反复失败并让错误提示闪烁。此时停止自动刷新，交由用户手动操作；手动刷新成功
  // 后 isChangesUnavailable 会被重置为 false，本 hook 随即恢复轮询。
  // files tab 也需要未提交变更，用于文件树 Git 装饰；与 changes tab 共用同一轮询族。
  // 三个轮询都额外要求窗口聚焦：后台窗口不轮询，重新聚焦时 refreshOnActivate 立即补拉。
  // 未提交变更 / 已提交历史的刷新门控：定时轮询与失效事件共用同一份判定（事件只在
  // 用户正在看的面板上刷新，与轮询不会出现「一个拉、一个不拉」的漂移）。
  const isChangesRefreshActive =
    isWindowFocused &&
    isSidePanelOpen &&
    (currentCache.sidePanelTab === "changes" ||
      currentCache.sidePanelTab === "files") &&
    !currentCache.isChangesUnavailable;
  const isCommitHistoryRefreshActive =
    isWindowFocused &&
    isSidePanelOpen &&
    currentCache.sidePanelTab === "changes" &&
    currentCache.committedChangesExpanded &&
    !currentCache.isChangesUnavailable;

  useConditionalPolling({
    refresh: refreshChanges,
    intervalMs: CHANGES_POLL_INTERVAL_MS,
    isActive: isChangesRefreshActive,
  });

  // 已提交历史门控轮询：仅在「侧栏打开 + changes tab + 已提交面板展开 + 仓库可访问」
  // 时运行。进入即补拉一次并按 5s 间隔轮询；收起面板 / 切换 tab / 关闭侧栏立即停止。
  // 比未提交的 2s 慢一档：已提交历史变化频率低，且展开才意味着用户关心。仓库不可访问
  // 同样视为不可恢复错误，停止轮询（与 changes 轮询语义一致）。
  useConditionalPolling({
    refresh: refreshCommitHistory,
    intervalMs: COMMIT_HISTORY_POLL_INTERVAL_MS,
    isActive: isCommitHistoryRefreshActive,
  });

  useConditionalPolling({
    refresh: refreshFileTree,
    intervalMs: FILE_TREE_POLL_INTERVAL_MS,
    isActive:
      isWindowFocused &&
      isSidePanelOpen &&
      currentCache.sidePanelTab === "files",
  });

  // 失效信号：会话列表变更（回合开始 / 结束，Agent 可能在回合内真的 `git commit`）
  // → 去抖后即时刷新未提交变更与已提交历史，让数量与列表立刻收敛，不再等 2s / 5s tick。
  // 门控 fold 进 key：只在「用户正在看且在用」的面板上刷新，与同资源的轮询门控同源。
  useSessionWorkspaceChangesInvalidation({
    projectId,
    sessionId,
    inFlightRequests:
      sessionId == null ? null : inFlightRequestsForSession(sessionId),
    changesRequestKey:
      sessionId != null && isChangesRefreshActive
        ? sessionWorkspaceRequestKey(
            CHANGES_REQUEST_RESOURCE,
            projectId,
            sessionId,
          )
        : null,
    commitHistoryRequestKey:
      sessionId != null && isCommitHistoryRefreshActive
        ? sessionWorkspaceRequestKey(
            COMMIT_HISTORY_REQUEST_RESOURCE,
            projectId,
            sessionId,
          )
        : null,
    refreshChanges,
    refreshCommitHistory,
  });

  const toggleUncommittedChangesExpanded = useCallback(() => {
    updateCurrentCache((cache) => ({
      ...cache,
      uncommittedChangesExpanded: !cache.uncommittedChangesExpanded,
    }));
  }, [updateCurrentCache]);

  const toggleCommittedChangesExpanded = useCallback(() => {
    updateCurrentCache((cache) => ({
      ...cache,
      committedChangesExpanded: !cache.committedChangesExpanded,
    }));
  }, [updateCurrentCache]);

  const fileTreeDecorations = useMemo(
    () => buildFileTreeDecorations(currentCache.changes),
    [currentCache.changes],
  );

  return {
    activeWorkspaceTab: currentCache.activeWorkspaceTab,
    changeTab: currentCache.changeTab,
    changes: currentCache.changes,
    changedFileKinds: fileTreeDecorations.fileKinds,
    directoryKinds: fileTreeDecorations.directoryKinds,
    changesErrorMessage: currentCache.changesErrorMessage,
    closeWorkspaceTab,
    closeWorkspaceTabForSession,
    committedChangesExpanded: currentCache.committedChangesExpanded,
    commitHistory: currentCache.commitHistory,
    isCommitFromWorktree: currentCache.isCommitFromWorktree,
    baseBranch: currentCache.baseBranch,
    hasMoreCommitHistory: currentCache.hasMoreCommitHistory,
    isLoadingMoreCommitHistory: currentCache.isLoadingMoreCommitHistory,
    loadMoreCommitHistoryErrorMessage:
      currentCache.loadMoreCommitHistoryErrorMessage,
    commitHistoryErrorMessage: currentCache.commitHistoryErrorMessage,
    fileTab: currentCache.fileTab,
    fileTree: currentCache.fileTree,
    fileTreeErrorMessage: currentCache.fileTreeErrorMessage,
    loadDirectory,
    getWorkspaceTabState,
    isChangesLoading: currentCache.isChangesLoading,
    isCommitHistoryLoading: currentCache.isCommitHistoryLoading,
    isFileTreeLoading: currentCache.isFileTreeLoading,
    openChange,
    openCommittedChange,
    openCommitChanges,
    openFile,
    refreshCommitHistory,
    loadMoreCommitHistory,
    refreshChanges,
    selectWorkspaceTab,
    selectWorkspaceTabForSession,
    setSidePanelTab,
    setSidePanelTabForSession,
    sidePanelTab: currentCache.sidePanelTab,
    toggleCommittedChangesExpanded,
    toggleUncommittedChangesExpanded,
    uncommittedChangesExpanded: currentCache.uncommittedChangesExpanded,
  };
}

function getSessionCache(
  cacheBySession: Map<number, SessionWorkspaceCache>,
  sessionId: number,
): SessionWorkspaceCache {
  const existingCache = cacheBySession.get(sessionId);
  if (existingCache) {
    return existingCache;
  }

  const nextCache = defaultWorkspaceCache();
  cacheBySession.set(sessionId, nextCache);
  return nextCache;
}

// 仓库路径不可访问（worktree 目录被删除/移动等）时，后端返回带 WorkspaceRoot
// detail 的 AGENT_SESSION_VALIDATION_FAILED 错误。此类错误无法通过轮询自愈，需停止
// 自动刷新；其他可恢复错误（如临时 git 锁）仍允许继续轮询。
function isWorkspaceRootInaccessibleError(error: CommandError): boolean {
  return (error.details ?? []).some(
    (detail) => detail["@type"] === "WorkspaceRoot",
  );
}
