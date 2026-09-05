import { useCallback, useEffect, useRef, useState } from "react";

import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { buildFileTreeDecorations } from "../../shared/workspace/file-tree-git-decorations";
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

const FILE_TREE_REFRESH_INTERVAL_MS = 5_000;
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
  const changesSeqRef = useRef(0);
  const [isVisible, setIsVisible] = useState(
    () => document.visibilityState === "visible",
  );
  const wasVisibleRef = useRef(isVisible);
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
        });
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
      wasVisibleRef.current = isVisible;
      return;
    }
    if (!wasVisibleRef.current && isVisible) {
      refresh();
    }
    wasVisibleRef.current = isVisible;
  }, [isVisible, enabled, workspacePath, refresh]);

  useEffect(() => {
    if (!enabled || !isVisible || !workspacePath) return;
    const timerId = window.setInterval(refresh, FILE_TREE_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(timerId);
    };
  }, [enabled, isVisible, workspacePath, refresh]);

  return {
    tree: live.tree,
    treeError: live.treeError,
    isTreeLoading: live.isTreeLoading,
    changedFileKinds: live.changedFileKinds,
    directoryKinds: live.directoryKinds,
    loadDirectory,
  };
}
