import { useCallback, useEffect, useRef, useState } from "react";

import { toCommandError } from "../../shared/commands/command-error";
import {
  getProjectWorktreeChanges,
  getProjectWorktreeFileTree,
  readProjectWorktreeDiff,
  readProjectWorktreeFile,
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

interface SessionWorkspaceCache {
  activeWorkspaceTab: SessionWorkspaceTabKind;
  changeTab: SessionWorkspaceChangeTab | null;
  changes: WorkspaceChangedFile[];
  changesErrorMessage: string | null;
  fileTab: SessionWorkspaceFileTab | null;
  fileTree: WorkspaceFileTreeNode[];
  fileTreeErrorMessage: string | null;
  isChangesLoading: boolean;
  isFileTreeLoading: boolean;
  lastChangesSignature: string | null;
  lastFileTreeSignature: string | null;
  sidePanelTab: SessionSidePanelTab;
}

const defaultWorkspaceCache = (): SessionWorkspaceCache => ({
  activeWorkspaceTab: "session",
  changeTab: null,
  changes: [],
  changesErrorMessage: null,
  fileTab: null,
  fileTree: [],
  fileTreeErrorMessage: null,
  isChangesLoading: false,
  isFileTreeLoading: false,
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

  const updateCurrentCache = useCallback(
    (updater: (cache: SessionWorkspaceCache) => SessionWorkspaceCache) => {
      if (sessionId == null) {
        return;
      }

      const cache = getSessionCache(cacheBySessionRef.current, sessionId);
      cacheBySessionRef.current.set(sessionId, updater(cache));
      setCacheVersion((currentVersion) => currentVersion + 1);
    },
    [sessionId],
  );

  const refreshChanges = useCallback(async () => {
    if (sessionId == null) {
      return;
    }

    updateCurrentCache((cache) => ({
      ...cache,
      isChangesLoading: true,
      changesErrorMessage: null,
    }));

    try {
      const response = await getProjectWorktreeChanges({
        projectId,
        sessionId,
      });

      updateCurrentCache((cache) => ({
        ...cache,
        changes:
          cache.lastChangesSignature === response.signature
            ? cache.changes
            : response.files,
        isChangesLoading: false,
        changesErrorMessage: null,
        lastChangesSignature: response.signature,
      }));
    } catch (error) {
      updateCurrentCache((cache) => ({
        ...cache,
        isChangesLoading: false,
        changesErrorMessage: toCommandError(error).message,
      }));
    }
  }, [projectId, sessionId, updateCurrentCache]);

  const refreshFileTree = useCallback(async () => {
    if (sessionId == null) {
      return;
    }

    updateCurrentCache((cache) => ({
      ...cache,
      isFileTreeLoading: true,
      fileTreeErrorMessage: null,
    }));

    try {
      const response = await getProjectWorktreeFileTree({
        projectId,
        sessionId,
      });

      updateCurrentCache((cache) => ({
        ...cache,
        fileTree:
          cache.lastFileTreeSignature === response.signature
            ? cache.fileTree
            : response.nodes,
        isFileTreeLoading: false,
        fileTreeErrorMessage: null,
        lastFileTreeSignature: response.signature,
      }));
    } catch (error) {
      updateCurrentCache((cache) => ({
        ...cache,
        isFileTreeLoading: false,
        fileTreeErrorMessage: toCommandError(error).message,
      }));
    }
  }, [projectId, sessionId, updateCurrentCache]);

  const setSidePanelTab = useCallback(
    (tab: SessionSidePanelTab) => {
      updateCurrentCache((cache) => ({ ...cache, sidePanelTab: tab }));
    },
    [updateCurrentCache],
  );

  const selectWorkspaceTab = useCallback(
    (tab: SessionWorkspaceTabKind) => {
      updateCurrentCache((cache) => ({ ...cache, activeWorkspaceTab: tab }));
    },
    [updateCurrentCache],
  );

  const closeWorkspaceTab = useCallback(
    (tab: Exclude<SessionWorkspaceTabKind, "session">) => {
      updateCurrentCache((cache) => {
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
    [updateCurrentCache],
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
          diff:
            cache.changeTab?.filePath === change.filePath
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
            cache.changeTab?.filePath === change.filePath
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
            cache.changeTab?.filePath === change.filePath
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

    void refreshChanges();
    const intervalId = window.setInterval(
      () => void refreshChanges(),
      CHANGES_POLL_INTERVAL_MS,
    );

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentCache.sidePanelTab, isSidePanelOpen, refreshChanges]);

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
    fileTab: currentCache.fileTab,
    fileTree: currentCache.fileTree,
    fileTreeErrorMessage: currentCache.fileTreeErrorMessage,
    isChangesLoading: currentCache.isChangesLoading,
    isFileTreeLoading: currentCache.isFileTreeLoading,
    openChange,
    openFile,
    refreshChanges,
    selectWorkspaceTab,
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
