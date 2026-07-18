import { useCallback, useEffect, useRef, useState } from "react";

import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import {
  getProjectWorktreeChanges,
  getProjectWorktreeFileTree,
  type WorkspaceChangeKind,
  type WorkspaceFileTreeNode,
} from "../../shared/workspace/workspace-commands";

const FILE_TREE_REFRESH_INTERVAL_MS = 5_000;
const EMPTY_CHANGE_KINDS: ReadonlyMap<string, WorkspaceChangeKind> = new Map();

export interface UseCodeWorkspaceFileTreeResult {
  tree: WorkspaceFileTreeNode[];
  treeError: string | null;
  isTreeLoading: boolean;
  /** 文件路径 → 变更类型（git status），驱动文件树 A/M/D 徽标。无变更时为稳定空 Map。 */
  changedFileKinds: ReadonlyMap<string, WorkspaceChangeKind>;
}

/**
 * 「代码」视图左侧文件树的数据源：VS Code 式自动检测文件变化。
 *
 * - 进入 files 视图 / 切换 workspacePath：丢弃旧数据，强制拉取文件树 + 未提交变更。
 * - 可见时按 5s 定时轮询；文件树与变更各自按 signature 去重，未变化则跳过 setState，
 *   兼顾「实时」与避免无谓 IPC / 重渲染。
 * - 由隐藏恢复可见 → 立即补拉一次。
 * - 离开 files 视图 / 无选中根：清空树与徽标，避免展示他根残留。
 *
 * 变更数据同时供文件树绘制 A/M/D 徽标（复用变更视图字样与配色）。signature 去重 +
 * 请求序号防竞态的写法与 useCodeWorkspaceChanges / useSessionWorkspaceCache 一致。
 * setState 全部放进 Promise 微任务，避免 react-hooks/set-state-in-effect。
 */
export function useCodeWorkspaceFileTree(
  projectId: number,
  workspacePath: string | null,
  enabled: boolean,
): UseCodeWorkspaceFileTreeResult {
  const { t } = useI18n();
  const [tree, setTree] = useState<WorkspaceFileTreeNode[]>([]);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [isTreeLoading, setIsTreeLoading] = useState(false);
  const [changedFileKinds, setChangedFileKinds] =
    useState<ReadonlyMap<string, WorkspaceChangeKind>>(EMPTY_CHANGE_KINDS);
  const [isVisible, setIsVisible] = useState(
    typeof document === "undefined" || document.visibilityState === "visible",
  );
  const wasVisibleRef = useRef(isVisible);
  const treeSeqRef = useRef(0);
  const changesSeqRef = useRef(0);
  const lastTreeSignatureRef = useRef<string | null>(null);
  const lastChangesSignatureRef = useRef<string | null>(null);
  const translateRef = useRef(t);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  const loadTree = useCallback(
    (options: { force: boolean }) => {
      if (!workspacePath) return;
      const seq = (treeSeqRef.current += 1);
      void Promise.resolve()
        .then(() => {
          // 强制拉取（进入视图 / 切根 / 恢复可见）：丢弃旧树与 signature，避免短暂展示他根。
          if (options.force) {
            setTree([]);
            lastTreeSignatureRef.current = null;
          }
          setIsTreeLoading(true);
          setTreeError(null);
          return getProjectWorktreeFileTree({ projectId, workspacePath });
        })
        .then((response) => {
          if (!response || treeSeqRef.current !== seq) return;
          const unchanged =
            !options.force &&
            lastTreeSignatureRef.current === response.signature;
          lastTreeSignatureRef.current = response.signature;
          if (!unchanged) setTree(response.nodes);
          setTreeError(null);
          setIsTreeLoading(false);
        })
        .catch((error) => {
          if (treeSeqRef.current !== seq) return;
          setTreeError(getCommandErrorMessage(error, translateRef.current));
          setIsTreeLoading(false);
        });
    },
    [projectId, workspacePath],
  );

  const loadChanges = useCallback(
    (options: { force: boolean }) => {
      if (!workspacePath) return;
      const seq = (changesSeqRef.current += 1);
      void Promise.resolve()
        .then(() => {
          if (options.force) {
            lastChangesSignatureRef.current = null;
          }
          return getProjectWorktreeChanges({ projectId, workspacePath });
        })
        .then((response) => {
          if (!response || changesSeqRef.current !== seq) return;
          const unchanged =
            !options.force &&
            lastChangesSignatureRef.current === response.signature;
          lastChangesSignatureRef.current = response.signature;
          if (!unchanged) {
            setChangedFileKinds(buildChangeKindMap(response.files));
          }
        })
        .catch(() => {
          // 变更拉取失败保留既有徽标，下次轮询重试；不阻断文件树展示。
        });
    },
    [projectId, workspacePath],
  );

  const refresh = useCallback(() => {
    loadTree({ force: false });
    loadChanges({ force: false });
  }, [loadChanges, loadTree]);

  // 进入 files 视图 / 切换 workspacePath：强制各拉一次；离开 / 无根：清空残留。
  useEffect(() => {
    if (!enabled || !workspacePath) {
      void Promise.resolve().then(() => {
        setTree([]);
        setTreeError(null);
        setIsTreeLoading(false);
        setChangedFileKinds(EMPTY_CHANGE_KINDS);
        lastTreeSignatureRef.current = null;
        lastChangesSignatureRef.current = null;
      });
      return;
    }
    loadTree({ force: true });
    loadChanges({ force: true });
  }, [enabled, workspacePath, loadTree, loadChanges]);

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

  // 由隐藏恢复可见 → 立即补拉一次（挂载时 wasVisibleRef 已为初始可见，跳过）。
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

  // 可见 + enabled + 有 workspacePath 时按间隔轮询（signature 去重）。
  useEffect(() => {
    if (!enabled || !isVisible || !workspacePath) return;
    const timerId = window.setInterval(refresh, FILE_TREE_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(timerId);
    };
  }, [enabled, isVisible, workspacePath, refresh]);

  return { tree, treeError, isTreeLoading, changedFileKinds };
}

function buildChangeKindMap(
  files: { filePath: string; kind: WorkspaceChangeKind }[],
): ReadonlyMap<string, WorkspaceChangeKind> {
  if (files.length === 0) return EMPTY_CHANGE_KINDS;
  const map = new Map<string, WorkspaceChangeKind>();
  for (const file of files) {
    map.set(file.filePath, file.kind);
  }
  return map;
}
