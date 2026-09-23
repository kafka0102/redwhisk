import { useCallback, useEffect, useRef, useState } from "react";

import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { useWindowFocus } from "../../shared/window/use-window-focus";
import { buildFileTreeDecorations } from "../../shared/workspace/file-tree-git-decorations";
import {
  clearFileTreeDirectoryLoadFailure,
  dueFileTreeDirectoryRetryPaths,
  markFileTreeDirectoryLoadFailed,
  type FileTreeDirectoryRetryQueue,
} from "../../shared/workspace/file-tree-directory-retry";
import {
  ROOT_FILE_TREE_DIRECTORY,
  assembleFileTree,
  fileTreeDirectoryPathsToLoad,
  isFileTreeDirectoryLoaded,
  normalizeFileTreeDirectoryPath,
  upsertFileTreeListing,
  type FileTreeDirectoryListing,
} from "../../shared/workspace/file-tree-listings";
import {
  getProjectWorktreeChanges,
  getProjectWorktreeFileTree,
  type WorkspaceChangeKind,
  type WorkspaceFileTreeNode,
} from "../../shared/workspace/workspace-commands";

/** 目录 listing 轮询间隔：只重拉已加载目录，展开新目录仍即时拉取。 */
const FILE_TREE_LISTING_REFRESH_INTERVAL_MS = 10_000;
/**
 * 变更徽标轮询间隔。git status + branch sync 是子进程级成本，与目录 listing 解耦后
 * 各自决定节奏：徽标晚 15s 刷新，远优于每 5s 与目录一起各起一次 git。
 */
const FILE_TREE_CHANGES_REFRESH_INTERVAL_MS = 15_000;
const EMPTY_DECORATIONS = buildFileTreeDecorations([]);
const EMPTY_CHANGE_KINDS = EMPTY_DECORATIONS.fileKinds;
const EMPTY_DIRECTORY_KINDS = EMPTY_DECORATIONS.directoryKinds;

/** 按 projectId + workspacePath 键控的文件树 SWR 缓存条目。 */
interface CodeFileTreeCacheEntry {
  listings: Record<string, FileTreeDirectoryListing>;
  tree: WorkspaceFileTreeNode[];
  treeLoaded: boolean;
  changedFileKinds: ReadonlyMap<string, WorkspaceChangeKind>;
  directoryKinds: ReadonlyMap<string, WorkspaceChangeKind>;
  changesSignature: string | null;
  changesLoaded: boolean;
}

const codeFileTreeCache = new Map<string, CodeFileTreeCacheEntry>();

function buildCodeFileTreeCacheKey(
  projectId: number,
  workspacePath: string,
): string {
  return `${projectId}::${workspacePath}`;
}

function emptyCacheEntry(): CodeFileTreeCacheEntry {
  return {
    listings: {},
    tree: [],
    treeLoaded: false,
    changedFileKinds: EMPTY_CHANGE_KINDS,
    directoryKinds: EMPTY_DIRECTORY_KINDS,
    changesSignature: null,
    changesLoaded: false,
  };
}

function ensureCacheEntry(key: string): CodeFileTreeCacheEntry {
  const existing = codeFileTreeCache.get(key);
  if (existing) return existing;
  const created = emptyCacheEntry();
  codeFileTreeCache.set(key, created);
  return created;
}

function readHydratableCache(
  projectId: number,
  workspacePath: string | null,
): CodeFileTreeCacheEntry | undefined {
  if (workspacePath == null) return undefined;
  const entry = codeFileTreeCache.get(
    buildCodeFileTreeCacheKey(projectId, workspacePath),
  );
  if (!entry?.treeLoaded) return undefined;
  return entry;
}

function writeListingCache(
  projectId: number,
  workspacePath: string,
  listings: Record<string, FileTreeDirectoryListing>,
  tree: WorkspaceFileTreeNode[],
): void {
  const key = buildCodeFileTreeCacheKey(projectId, workspacePath);
  const previous = ensureCacheEntry(key);
  codeFileTreeCache.set(key, {
    ...previous,
    listings,
    tree,
    treeLoaded: true,
  });
}

function writeChangesCache(
  projectId: number,
  workspacePath: string,
  changedFileKinds: ReadonlyMap<string, WorkspaceChangeKind>,
  directoryKinds: ReadonlyMap<string, WorkspaceChangeKind>,
  changesSignature: string,
): void {
  const key = buildCodeFileTreeCacheKey(projectId, workspacePath);
  const previous = ensureCacheEntry(key);
  codeFileTreeCache.set(key, {
    ...previous,
    changedFileKinds,
    directoryKinds,
    changesSignature,
    changesLoaded: true,
  });
}

/** 测试隔离：清空模块级文件树 SWR 缓存。 */
export function resetCodeWorkspaceFileTreeCacheForTests(): void {
  codeFileTreeCache.clear();
}

export interface UseCodeWorkspaceFileTreeResult {
  tree: WorkspaceFileTreeNode[];
  treeError: string | null;
  isTreeLoading: boolean;
  /** 文件路径 → 变更类型（git status），驱动文件树徽标与文件名着色。无变更时为稳定空 Map。 */
  changedFileKinds: ReadonlyMap<string, WorkspaceChangeKind>;
  /** 目录路径 → 聚合变更类型，驱动目录名着色。无变更时为稳定空 Map。 */
  directoryKinds: ReadonlyMap<string, WorkspaceChangeKind>;
  loadDirectory: (directoryPath: string) => void;
  /** 立即强刷单个目录的 listing 与变更徽标（新建/删除后不等 5s 轮询）。 */
  refreshDirectory: (directoryPath: string) => void;
}

interface LiveFileTreeState {
  tree: WorkspaceFileTreeNode[];
  listings: Record<string, FileTreeDirectoryListing>;
  treeError: string | null;
  isTreeLoading: boolean;
  changedFileKinds: ReadonlyMap<string, WorkspaceChangeKind>;
  directoryKinds: ReadonlyMap<string, WorkspaceChangeKind>;
  changesSignature: string | null;
  hasTreeData: boolean;
  cacheKey: string | null;
}

function buildLiveStateFromCache(
  projectId: number,
  workspacePath: string | null,
  enabled: boolean,
): LiveFileTreeState {
  if (!enabled || workspacePath == null) {
    return {
      tree: [],
      listings: {},
      treeError: null,
      isTreeLoading: false,
      changedFileKinds: EMPTY_CHANGE_KINDS,
      directoryKinds: EMPTY_DIRECTORY_KINDS,
      changesSignature: null,
      hasTreeData: false,
      cacheKey: null,
    };
  }
  const cacheKey = buildCodeFileTreeCacheKey(projectId, workspacePath);
  const cached = readHydratableCache(projectId, workspacePath);
  if (cached) {
    return {
      tree: cached.tree,
      listings: cached.listings,
      treeError: null,
      isTreeLoading: false,
      changedFileKinds: cached.changedFileKinds,
      directoryKinds: cached.directoryKinds,
      changesSignature: cached.changesSignature,
      hasTreeData: true,
      cacheKey,
    };
  }
  return {
    tree: [],
    listings: {},
    treeError: null,
    isTreeLoading: true,
    changedFileKinds: EMPTY_CHANGE_KINDS,
    directoryKinds: EMPTY_DIRECTORY_KINDS,
    changesSignature: null,
    hasTreeData: false,
    cacheKey,
  };
}

/**
 * setState 全部放进 Promise 微任务，避免 react-hooks/set-state-in-effect。
 */
export function useCodeWorkspaceFileTree(
  projectId: number,
  workspacePath: string | null,
  enabled: boolean,
): UseCodeWorkspaceFileTreeResult {
  const { t } = useI18n();
  const [live, setLive] = useState<LiveFileTreeState>(() =>
    buildLiveStateFromCache(projectId, workspacePath, enabled),
  );

  const nextKey =
    enabled && workspacePath != null
      ? buildCodeFileTreeCacheKey(projectId, workspacePath)
      : null;
  if (live.cacheKey !== nextKey || (!enabled && live.hasTreeData)) {
    const hydrated = buildLiveStateFromCache(projectId, workspacePath, enabled);
    if (
      live.cacheKey !== hydrated.cacheKey ||
      live.hasTreeData !== hydrated.hasTreeData ||
      live.isTreeLoading !== hydrated.isTreeLoading
    ) {
      setLive(hydrated);
    }
  }

  const listingSeqRef = useRef(new Map<string, number>());
  // 同一目录同一时刻只允许一个在途请求：5s 轮询、展开点击、新建后强刷会同时打同一
  // 个路径，重复请求只会互相顶掉 seq 并放大后端并发。
  const inFlightDirectoriesRef = useRef(new Set<string>());
  // 失败目录的重试表：请求键 → { pathKey, attempts, nextAttemptAt }。
  const directoryRetryRef = useRef<FileTreeDirectoryRetryQueue>(new Map());
  const changesSeqRef = useRef(0);
  const [isVisible, setIsVisible] = useState(
    () => document.visibilityState === "visible",
  );
  // 失焦窗口（多窗口场景下的后台窗口）不起定时器：git 与 IPC 会按窗口数线性叠加，
  // 重新聚焦时由下方 recovery effect 立即补拉一次，不丢新鲜度。
  const isWindowFocused = useWindowFocus();
  const isPollingActive = isVisible && isWindowFocused;
  const wasPollingActiveRef = useRef(isPollingActive);
  const translateRef = useRef(t);
  const liveRef = useRef(live);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  const fetchDirectory = useCallback(
    (directoryPath: string, force: boolean) => {
      if (!workspacePath || !enabled) return;
      const pathKey = normalizeFileTreeDirectoryPath(directoryPath);
      const requestKey = buildCodeFileTreeCacheKey(projectId, workspacePath);
      if (
        !force &&
        isFileTreeDirectoryLoaded(
          liveRef.current.listings,
          liveRef.current.tree,
          pathKey,
        )
      ) {
        return;
      }
      const seqKey = `${requestKey}::${pathKey}`;
      // 在途请求回来前，同一目录的重复触发（含 5s 轮询的强刷）直接放弃：结果落地后
      // 最多再等一个轮询周期，避免请求堆叠放大后端并发。
      if (inFlightDirectoriesRef.current.has(seqKey)) {
        return;
      }
      inFlightDirectoriesRef.current.add(seqKey);
      const settle = () => {
        inFlightDirectoriesRef.current.delete(seqKey);
      };
      const seq = (listingSeqRef.current.get(seqKey) ?? 0) + 1;
      listingSeqRef.current.set(seqKey, seq);
      const input =
        pathKey === ROOT_FILE_TREE_DIRECTORY
          ? { projectId, workspacePath }
          : { projectId, workspacePath, directoryPath: pathKey };
      void Promise.resolve()
        .then(() => getProjectWorktreeFileTree(input))
        .then((response) => {
          if (!response || listingSeqRef.current.get(seqKey) !== seq) return;
          if (liveRef.current.cacheKey !== requestKey) return;
          clearFileTreeDirectoryLoadFailure(directoryRetryRef.current, seqKey);
          const nextListings = upsertFileTreeListing(
            liveRef.current.listings,
            pathKey,
            { nodes: response.nodes, signature: response.signature },
          );
          if (
            nextListings === liveRef.current.listings &&
            liveRef.current.hasTreeData &&
            !liveRef.current.isTreeLoading
          ) {
            return;
          }
          const nextTree = assembleFileTree(nextListings);
          writeListingCache(projectId, workspacePath, nextListings, nextTree);
          setLive((current) => {
            if (current.cacheKey !== requestKey) return current;
            const listings = upsertFileTreeListing(current.listings, pathKey, {
              nodes: response.nodes,
              signature: response.signature,
            });
            if (
              listings === current.listings &&
              current.hasTreeData &&
              !current.isTreeLoading &&
              current.treeError == null
            ) {
              return current;
            }
            return {
              ...current,
              listings,
              tree: assembleFileTree(listings),
              hasTreeData: true,
              treeError: null,
              isTreeLoading: false,
            };
          });
        })
        .catch((error) => {
          if (listingSeqRef.current.get(seqKey) !== seq) return;
          if (liveRef.current.cacheKey !== requestKey) return;
          markFileTreeDirectoryLoadFailed(
            directoryRetryRef.current,
            seqKey,
            pathKey,
            Date.now(),
          );
          setLive((current) => {
            if (current.cacheKey !== requestKey) return current;
            if (pathKey !== ROOT_FILE_TREE_DIRECTORY || current.hasTreeData) {
              return { ...current, isTreeLoading: false };
            }
            return {
              ...current,
              isTreeLoading: false,
              treeError: getCommandErrorMessage(error, translateRef.current),
            };
          });
        })
        .finally(settle);
    },
    [enabled, projectId, workspacePath],
  );

  const loadTree = useCallback(() => {
    if (!workspacePath || !enabled) return;
    const requestKey = buildCodeFileTreeCacheKey(projectId, workspacePath);
    const listingKeys = fileTreeDirectoryPathsToLoad(
      ensureCacheEntry(requestKey).listings,
    );
    for (const directoryPath of listingKeys) {
      fetchDirectory(directoryPath, true);
    }
    // 失败目录不在 listings 里，必须按重试表单独补拉，否则展开后一直空。
    for (const directoryPath of dueFileTreeDirectoryRetryPaths(
      directoryRetryRef.current,
      requestKey,
      Date.now(),
    )) {
      fetchDirectory(directoryPath, false);
    }
  }, [enabled, fetchDirectory, projectId, workspacePath]);

  const loadDirectory = useCallback(
    (directoryPath: string) => {
      fetchDirectory(directoryPath, false);
    },
    [fetchDirectory],
  );

  const loadChanges = useCallback(() => {
    if (!workspacePath || !enabled) return;
    const seq = (changesSeqRef.current += 1);
    const requestKey = buildCodeFileTreeCacheKey(projectId, workspacePath);
    void Promise.resolve()
      .then(() => getProjectWorktreeChanges({ projectId, workspacePath }))
      .then((response) => {
        if (!response || changesSeqRef.current !== seq) return;
        if (liveRef.current.cacheKey !== requestKey) return;
        const unchanged =
          liveRef.current.changesSignature === response.signature;
        if (unchanged) return;
        const decorations = buildFileTreeDecorations(response.files);
        writeChangesCache(
          projectId,
          workspacePath,
          decorations.fileKinds,
          decorations.directoryKinds,
          response.signature,
        );
        setLive((current) => {
          if (current.cacheKey !== requestKey) return current;
          return {
            ...current,
            changedFileKinds: decorations.fileKinds,
            directoryKinds: decorations.directoryKinds,
            changesSignature: response.signature,
          };
        });
      })
      .catch(() => {
        // 变更拉取失败保留既有徽标，下次轮询重试；不阻断文件树展示。
      });
  }, [enabled, projectId, workspacePath]);

  const refreshDirectory = useCallback(
    (directoryPath: string) => {
      fetchDirectory(directoryPath, true);
      loadChanges();
    },
    [fetchDirectory, loadChanges],
  );

  const refresh = useCallback(() => {
    loadTree();
    loadChanges();
  }, [loadChanges, loadTree]);

  useEffect(() => {
    if (!enabled || !workspacePath) {
      return;
    }
    loadTree();
    loadChanges();
  }, [enabled, workspacePath, projectId, loadTree, loadChanges]);

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

  useEffect(() => {
    if (!enabled || !workspacePath) {
      wasPollingActiveRef.current = isPollingActive;
      return;
    }
    if (!wasPollingActiveRef.current && isPollingActive) {
      refresh();
    }
    wasPollingActiveRef.current = isPollingActive;
  }, [isPollingActive, enabled, workspacePath, refresh]);

  // 目录 listing 与变更徽标各自独立计时：listing 便宜、要跟得上外部增删；变更徽标
  // 每次都要起 git，节奏放慢一档。
  useEffect(() => {
    if (!enabled || !isPollingActive || !workspacePath) return;
    const timerId = window.setInterval(
      loadTree,
      FILE_TREE_LISTING_REFRESH_INTERVAL_MS,
    );
    return () => {
      window.clearInterval(timerId);
    };
  }, [enabled, isPollingActive, loadTree, workspacePath]);

  useEffect(() => {
    if (!enabled || !isPollingActive || !workspacePath) return;
    const timerId = window.setInterval(
      loadChanges,
      FILE_TREE_CHANGES_REFRESH_INTERVAL_MS,
    );
    return () => {
      window.clearInterval(timerId);
    };
  }, [enabled, isPollingActive, loadChanges, workspacePath]);

  return {
    tree: live.tree,
    treeError: live.treeError,
    isTreeLoading: live.isTreeLoading,
    changedFileKinds: live.changedFileKinds,
    directoryKinds: live.directoryKinds,
    loadDirectory,
    refreshDirectory,
  };
}
