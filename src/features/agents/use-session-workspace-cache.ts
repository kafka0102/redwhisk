import { useCallback, useEffect, useRef, useState } from "react";

import {
  toCommandError,
  type CommandError,
} from "../../shared/commands/command-error";
import {
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

const CHANGES_POLL_INTERVAL_MS = 2_000;
const FILE_TREE_POLL_INTERVAL_MS = 5_000;

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
  commitHistory: WorkspaceCommitRecord[];
  commitHistoryErrorMessage: string | null;
  commitHistoryRequestSequence: number;
  fileTab: SessionWorkspaceFileTab | null;
  fileTree: WorkspaceFileTreeNode[];
  fileTreeErrorMessage: string | null;
  fileTreeRequestSequence: number;
  isChangesLoading: boolean;
  isChangesUnavailable: boolean;
  isCommitHistoryLoading: boolean;
  isFileTreeLoading: boolean;
  lastCommitHistorySignature: string | null;
  lastChangesSignature: string | null;
  lastFileTreeSignature: string | null;
  sidePanelTab: SessionSidePanelTab;
}

const defaultWorkspaceCache = (): SessionWorkspaceCache => ({
  activeWorkspaceTab: "session",
  changeTab: null,
  changes: [],
  changesErrorMessage: null,
  changesRequestSequence: 0,
  commitHistory: [],
  commitHistoryErrorMessage: null,
  commitHistoryRequestSequence: 0,
  fileTab: null,
  fileTree: [],
  fileTreeErrorMessage: null,
  fileTreeRequestSequence: 0,
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
  const cacheBySessionRef = useRef<Map<number, SessionWorkspaceCache>>(
    new Map(),
  );
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
      cacheBySessionRef.current.set(targetSessionId, updater(cache));
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

    let requestSequence = 0;
    updateCurrentCache((cache) => ({
      ...cache,
      changesRequestSequence: (requestSequence =
        cache.changesRequestSequence + 1),
      isChangesLoading: true,
      changesErrorMessage: null,
    }));

    try {
      const response = await getProjectWorktreeChanges({
        projectId,
        sessionId,
      });

      updateCurrentCache((cache) =>
        cache.changesRequestSequence === requestSequence
          ? {
              ...cache,
              changes:
                cache.lastChangesSignature === response.signature
                  ? cache.changes
                  : response.files,
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
      updateCurrentCache((cache) =>
        cache.changesRequestSequence === requestSequence
          ? {
              ...cache,
              isChangesLoading: false,
              changesErrorMessage: commandError.message,
              isChangesUnavailable: isUnavailable,
            }
          : cache,
      );
    }
  }, [projectId, sessionId, updateCurrentCache]);

  const refreshFileTree = useCallback(async () => {
    if (sessionId == null) {
      return;
    }

    let requestSequence = 0;
    updateCurrentCache((cache) => ({
      ...cache,
      fileTreeRequestSequence: (requestSequence =
        cache.fileTreeRequestSequence + 1),
      isFileTreeLoading: true,
      fileTreeErrorMessage: null,
    }));

    try {
      const response = await getProjectWorktreeFileTree({
        projectId,
        sessionId,
      });

      updateCurrentCache((cache) =>
        cache.fileTreeRequestSequence === requestSequence
          ? {
              ...cache,
              fileTree:
                cache.lastFileTreeSignature === response.signature
                  ? cache.fileTree
                  : response.nodes,
              isFileTreeLoading: false,
              fileTreeErrorMessage: null,
              lastFileTreeSignature: response.signature,
            }
          : cache,
      );
    } catch (error) {
      updateCurrentCache((cache) =>
        cache.fileTreeRequestSequence === requestSequence
          ? {
              ...cache,
              isFileTreeLoading: false,
              fileTreeErrorMessage: toCommandError(error).message,
            }
          : cache,
      );
    }
  }, [projectId, sessionId, updateCurrentCache]);

  const refreshCommitHistory = useCallback(async () => {
    if (sessionId == null) {
      return;
    }

    let requestSequence = 0;
    updateCurrentCache((cache) => ({
      ...cache,
      commitHistoryRequestSequence: (requestSequence =
        cache.commitHistoryRequestSequence + 1),
      isCommitHistoryLoading: true,
      commitHistoryErrorMessage: null,
    }));

    try {
      const response = await getProjectWorktreeCommitHistory({
        projectId,
        sessionId,
      });

      updateCurrentCache((cache) =>
        cache.commitHistoryRequestSequence === requestSequence
          ? {
              ...cache,
              commitHistory:
                cache.lastCommitHistorySignature === response.signature
                  ? cache.commitHistory
                  : response.commits,
              isCommitHistoryLoading: false,
              commitHistoryErrorMessage: null,
              lastCommitHistorySignature: response.signature,
            }
          : cache,
      );
    } catch (error) {
      updateCurrentCache((cache) =>
        cache.commitHistoryRequestSequence === requestSequence
          ? {
              ...cache,
              isCommitHistoryLoading: false,
              commitHistoryErrorMessage: toCommandError(error).message,
            }
          : cache,
      );
    }
  }, [projectId, sessionId, updateCurrentCache]);

  const setSidePanelTab = useCallback(
    (tab: SessionSidePanelTab) => {
      updateCurrentCache((cache) => ({ ...cache, sidePanelTab: tab }));
    },
    [updateCurrentCache],
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
          fileName: change.fileName,
          filePath: change.filePath,
          change,
          commitHash: null,
          diff:
            cache.changeTab?.filePath === change.filePath &&
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
            cache.changeTab?.filePath === change.filePath &&
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
            cache.changeTab?.filePath === change.filePath &&
            cache.changeTab.commitHash == null
              ? {
                  ...cache.changeTab,
                  errorMessage: toCommandError(error).message,
                  isLoading: false,
                }
              : cache.changeTab,
        }));
      }
    },
    [projectId, sessionId, updateCurrentCache],
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
          fileName: change.fileName,
          filePath: change.filePath,
          change,
          commitHash,
          diff:
            cache.changeTab?.filePath === change.filePath &&
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
            cache.changeTab?.filePath === change.filePath &&
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
            cache.changeTab?.filePath === change.filePath &&
            cache.changeTab.commitHash === commitHash
              ? {
                  ...cache.changeTab,
                  errorMessage: toCommandError(error).message,
                  isLoading: false,
                }
              : cache.changeTab,
        }));
      }
    },
    [projectId, sessionId, updateCurrentCache],
  );

  const openFile = useCallback(
    async (file: WorkspaceFileTreeNode) => {
      if (sessionId == null || file.kind !== "file") {
        return;
      }

      updateCurrentCache((cache) => ({
        ...cache,
        activeWorkspaceTab: "file",
        fileTab: {
          fileName: file.name,
          filePath: file.path,
          content:
            cache.fileTab?.filePath === file.path
              ? cache.fileTab.content
              : null,
          errorMessage: null,
          isLoading: true,
        },
      }));

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
                  errorMessage: toCommandError(error).message,
                  isLoading: false,
                }
              : cache.fileTab,
        }));
      }
    },
    [projectId, sessionId, updateCurrentCache],
  );

  useEffect(() => {
    if (!isSidePanelOpen || currentCache.sidePanelTab !== "changes") {
      return;
    }

    // 仓库路径不可访问属于不可恢复错误：worktree 目录已被删除或移动，继续轮询只会
    // 反复失败并让错误提示闪烁。此时停止自动刷新，交由用户手动操作；手动刷新成功
    // 后 isChangesUnavailable 会被重置为 false，本 effect 随即恢复轮询。
    if (currentCache.isChangesUnavailable) {
      return;
    }

    void refreshChanges();
    const intervalId = window.setInterval(
      () => void refreshChanges(),
      CHANGES_POLL_INTERVAL_MS,
    );

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    currentCache.sidePanelTab,
    currentCache.isChangesUnavailable,
    isSidePanelOpen,
    refreshChanges,
  ]);

  useEffect(() => {
    if (!isSidePanelOpen || currentCache.sidePanelTab !== "files") {
      return;
    }

    void refreshFileTree();
    const intervalId = window.setInterval(
      () => void refreshFileTree(),
      FILE_TREE_POLL_INTERVAL_MS,
    );

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentCache.sidePanelTab, isSidePanelOpen, refreshFileTree]);

  return {
    activeWorkspaceTab: currentCache.activeWorkspaceTab,
    changeTab: currentCache.changeTab,
    changes: currentCache.changes,
    changesErrorMessage: currentCache.changesErrorMessage,
    closeWorkspaceTab,
    closeWorkspaceTabForSession,
    commitHistory: currentCache.commitHistory,
    commitHistoryErrorMessage: currentCache.commitHistoryErrorMessage,
    fileTab: currentCache.fileTab,
    fileTree: currentCache.fileTree,
    fileTreeErrorMessage: currentCache.fileTreeErrorMessage,
    getWorkspaceTabState,
    isChangesLoading: currentCache.isChangesLoading,
    isCommitHistoryLoading: currentCache.isCommitHistoryLoading,
    isFileTreeLoading: currentCache.isFileTreeLoading,
    openChange,
    openCommittedChange,
    openFile,
    refreshCommitHistory,
    refreshChanges,
    selectWorkspaceTab,
    selectWorkspaceTabForSession,
    setSidePanelTab,
    sidePanelTab: currentCache.sidePanelTab,
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
