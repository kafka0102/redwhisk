import { useCallback, useEffect, useRef, useState } from "react";

import {
  getCommandErrorMessage,
  toCommandError,
  type CommandError,
} from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import {
  getProjectWorktreeChanges,
  getProjectWorktreeCommitHistory,
  type WorkspaceChangedFile,
  type WorkspaceCommitRecord,
} from "../../shared/workspace/workspace-commands";

export interface UseCodeWorkspaceChangesResult {
  changes: WorkspaceChangedFile[];
  isChangesLoading: boolean;
  changesErrorMessage: string | null;
  isChangesUnavailable: boolean;
  commitHistory: WorkspaceCommitRecord[];
  isCommitHistoryLoading: boolean;
  commitHistoryErrorMessage: string | null;
  isWorktree: boolean;
  refreshChanges: () => void;
  refreshCommitHistory: () => void;
}

/**
 * 代码工作区左侧栏「变更」视图的数据源。按当前选中根的 workspacePath 拉取未提交
 * 变更与已提交历史：进入变更视图（enabled）或切换工作区时各拉取一次，手动刷新可
 * 再触发；不做轮询。
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
  const [changes, setChanges] = useState<WorkspaceChangedFile[]>([]);
  const [isChangesLoading, setIsChangesLoading] = useState(false);
  const [changesErrorMessage, setChangesErrorMessage] = useState<string | null>(
    null,
  );
  const [isChangesUnavailable, setIsChangesUnavailable] = useState(false);
  const [commitHistory, setCommitHistory] = useState<WorkspaceCommitRecord[]>(
    [],
  );
  const [isCommitHistoryLoading, setIsCommitHistoryLoading] = useState(false);
  const [commitHistoryErrorMessage, setCommitHistoryErrorMessage] = useState<
    string | null
  >(null);
  const [isWorktree, setIsWorktree] = useState(false);
  const changesRequestSequenceRef = useRef(0);
  const lastChangesSignatureRef = useRef<string | null>(null);
  const commitHistoryRequestSequenceRef = useRef(0);
  const lastCommitHistorySignatureRef = useRef<string | null>(null);
  const translateRef = useRef(t);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  const runChangesRequest = useCallback(
    (options: { clearStale: boolean }) => {
      if (!workspacePath) return;
      const requestSequence = (changesRequestSequenceRef.current += 1);

      void Promise.resolve()
        .then(() => {
          setIsChangesLoading(true);
          setChangesErrorMessage(null);
          // 切换工作区时丢弃旧根数据与 signature，避免短暂展示他根变更 / 误命中去重。
          if (options.clearStale) {
            setChanges([]);
            setIsChangesUnavailable(false);
            lastChangesSignatureRef.current = null;
          }
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
          lastChangesSignatureRef.current = response.signature;
          if (!unchanged) {
            setChanges(response.files);
          }
          setIsChangesLoading(false);
          setChangesErrorMessage(null);
          setIsChangesUnavailable(false);
        })
        .catch((error) => {
          if (changesRequestSequenceRef.current !== requestSequence) return;
          const commandError = toCommandError(error);
          setIsChangesUnavailable(
            isWorkspaceRootInaccessibleError(commandError),
          );
          setChangesErrorMessage(
            getCommandErrorMessage(error, translateRef.current),
          );
          setIsChangesLoading(false);
        });
    },
    [projectId, workspacePath],
  );

  const runCommitHistoryRequest = useCallback(
    (options: { clearStale: boolean }) => {
      if (!workspacePath) return;
      const requestSequence = (commitHistoryRequestSequenceRef.current += 1);

      void Promise.resolve()
        .then(() => {
          setIsCommitHistoryLoading(true);
          setCommitHistoryErrorMessage(null);
          if (options.clearStale) {
            setCommitHistory([]);
            lastCommitHistorySignatureRef.current = null;
          }
          return getProjectWorktreeCommitHistory({ projectId, workspacePath });
        })
        .then((response) => {
          if (
            !response ||
            commitHistoryRequestSequenceRef.current !== requestSequence
          ) {
            return;
          }
          const unchanged =
            lastCommitHistorySignatureRef.current === response.signature;
          lastCommitHistorySignatureRef.current = response.signature;
          if (!unchanged) {
            setCommitHistory(response.commits);
            setIsWorktree(response.isWorktree);
          }
          setIsCommitHistoryLoading(false);
          setCommitHistoryErrorMessage(null);
        })
        .catch((error) => {
          if (commitHistoryRequestSequenceRef.current !== requestSequence) {
            return;
          }
          setCommitHistoryErrorMessage(
            getCommandErrorMessage(error, translateRef.current),
          );
          setIsCommitHistoryLoading(false);
        });
    },
    [projectId, workspacePath],
  );

  // 进入变更视图（enabled）或切换工作区时各拉取一次（切换工作区先丢弃旧根数据）；不轮询。
  useEffect(() => {
    if (!enabled || !workspacePath) return;
    runChangesRequest({ clearStale: true });
    runCommitHistoryRequest({ clearStale: true });
  }, [enabled, workspacePath, runChangesRequest, runCommitHistoryRequest]);

  const refreshChanges = useCallback(
    () => runChangesRequest({ clearStale: false }),
    [runChangesRequest],
  );

  const refreshCommitHistory = useCallback(
    () => runCommitHistoryRequest({ clearStale: false }),
    [runCommitHistoryRequest],
  );

  return {
    changes,
    isChangesLoading,
    changesErrorMessage,
    isChangesUnavailable,
    commitHistory,
    isCommitHistoryLoading,
    commitHistoryErrorMessage,
    isWorktree,
    refreshChanges,
    refreshCommitHistory,
  };
}

// worktree 目录被删除/移动等不可恢复错误：停止自动行为，交用户手动处理。
function isWorkspaceRootInaccessibleError(error: CommandError): boolean {
  return (error.details ?? []).some(
    (detail) => detail["@type"] === "WorkspaceRoot",
  );
}
