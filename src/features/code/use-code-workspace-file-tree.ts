import { useCallback, useEffect, useRef, useState } from "react";

import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { buildFileTreeDecorations } from "../../shared/workspace/file-tree-git-decorations";
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
  tree: WorkspaceFileTreeNode[];
  treeSignature: string;
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
    tree: [],
    treeSignature: "",
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

function writeTreeCache(
  projectId: number,
  workspacePath: string,
  tree: WorkspaceFileTreeNode[],
  treeSignature: string,
): void {
  const key = buildCodeFileTreeCacheKey(projectId, workspacePath);
  const previous = ensureCacheEntry(key);
  codeFileTreeCache.set(key, {
    ...previous,
    tree,
    treeSignature,
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
}

interface LiveFileTreeState {
  tree: WorkspaceFileTreeNode[];
  treeError: string | null;
  isTreeLoading: boolean;
  changedFileKinds: ReadonlyMap<string, WorkspaceChangeKind>;
  directoryKinds: ReadonlyMap<string, WorkspaceChangeKind>;
  treeSignature: string | null;
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
      treeError: null,
      isTreeLoading: false,
      changedFileKinds: EMPTY_CHANGE_KINDS,
      directoryKinds: EMPTY_DIRECTORY_KINDS,
      treeSignature: null,
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
      treeError: null,
      isTreeLoading: false,
      changedFileKinds: cached.changedFileKinds,
      directoryKinds: cached.directoryKinds,
      treeSignature: cached.treeSignature,
      changesSignature: cached.changesSignature,
      hasTreeData: true,
      cacheKey,
    };
  }
  return {
    tree: [],
    treeError: null,
    isTreeLoading: true,
    changedFileKinds: EMPTY_CHANGE_KINDS,
    directoryKinds: EMPTY_DIRECTORY_KINDS,
    treeSignature: null,
    changesSignature: null,
    hasTreeData: false,
    cacheKey,
  };
}

/**
 * 「代码」视图左侧文件树的数据源：SWR 缓存 + 静默重校验。
 *
 * - 按 projectId + workspacePath 模块级内存缓存树节点、变更徽标与 signature。
 * - 缓存命中：立即展示且 isTreeLoading=false，后台 soft revalidate（不清空树）。
 * - signature 相同不更新展示；不同则静默替换并写回缓存。
 * - 无缓存才显示加载态；切根按根独立缓存，无缓存不展示他根。
 * - 进入 / 切根 / 恢复可见立即 soft revalidate；可见时 5s 轮询。
 * - 重校验失败且已有展示数据时保留旧树。
 *
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

  // 切根 / 切换 enabled：渲染期同步水合，避免短暂展示他根树。
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

  const [isVisible, setIsVisible] = useState(
    typeof document === "undefined" || document.visibilityState === "visible",
  );
  const wasVisibleRef = useRef(isVisible);
  const treeSeqRef = useRef(0);
  const changesSeqRef = useRef(0);
  const translateRef = useRef(t);
  const liveRef = useRef(live);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  const loadTree = useCallback(() => {
    if (!workspacePath || !enabled) return;
    const seq = (treeSeqRef.current += 1);
    const requestKey = buildCodeFileTreeCacheKey(projectId, workspacePath);
    void Promise.resolve()
      .then(() => {
        if (liveRef.current.cacheKey !== requestKey) return null;
        // soft revalidate：有展示数据时不进 loading。
        if (!liveRef.current.hasTreeData) {
          setLive((current) =>
            current.cacheKey === requestKey
              ? { ...current, isTreeLoading: true, treeError: null }
              : current,
          );
        }
        return getProjectWorktreeFileTree({ projectId, workspacePath });
      })
      .then((response) => {
        if (!response || treeSeqRef.current !== seq) return;
        if (liveRef.current.cacheKey !== requestKey) return;
        const unchanged = liveRef.current.treeSignature === response.signature;
        const nextTree = unchanged ? liveRef.current.tree : response.nodes;
        writeTreeCache(projectId, workspacePath, nextTree, response.signature);
        if (
          unchanged &&
          liveRef.current.hasTreeData &&
          !liveRef.current.isTreeLoading
        ) {
          // signature 相同且已有展示：不 setState，避免无意义重渲染。
          return;
        }
        setLive((current) => {
          if (current.cacheKey !== requestKey) return current;
          if (
            unchanged &&
            current.hasTreeData &&
            !current.isTreeLoading &&
            current.treeError == null
          ) {
            return current;
          }
          return {
            ...current,
            tree: nextTree,
            treeSignature: response.signature,
            hasTreeData: true,
            treeError: null,
            isTreeLoading: false,
          };
        });
      })
      .catch((error) => {
        if (treeSeqRef.current !== seq) return;
        if (liveRef.current.cacheKey !== requestKey) return;
        setLive((current) => {
          if (current.cacheKey !== requestKey) return current;
          if (current.hasTreeData) {
            return { ...current, isTreeLoading: false };
          }
          return {
            ...current,
            isTreeLoading: false,
            treeError: getCommandErrorMessage(error, translateRef.current),
          };
        });
      });
  }, [enabled, projectId, workspacePath]);

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

  // 进入 / 切根 / enabled：soft revalidate（水合已在渲染期完成）。
  useEffect(() => {
    if (!enabled || !workspacePath) {
      return;
    }
    loadTree();
    loadChanges();
  }, [enabled, workspacePath, projectId, loadTree, loadChanges]);

  // 可见性监听：enabled 期间同步真实可见性，visibilitychange 时更新。
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

  // 由隐藏恢复可见 → 立即 soft revalidate（挂载时 wasVisibleRef 已为初始可见，跳过）。
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

  // 可见 + enabled + 有 workspacePath 时按间隔 soft revalidate。
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
  };
}
