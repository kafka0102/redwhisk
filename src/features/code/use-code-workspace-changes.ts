import { useCallback, useEffect, useRef, useState } from "react";

import {
  getCommandErrorMessage,
  toCommandError,
  type CommandError,
} from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import {
  getProjectWorktreeChanges,
  type WorkspaceChangedFile,
} from "../../shared/workspace/workspace-commands";

export interface UseCodeWorkspaceChangesResult {
  changes: WorkspaceChangedFile[];
  isChangesLoading: boolean;
  changesErrorMessage: string | null;
  isChangesUnavailable: boolean;
  refreshChanges: () => void;
}

/**
 * 代码工作区左侧栏「变更」视图的数据源。按当前选中根的 workspacePath 拉取未提交
 * 变更：进入变更视图（enabled）或切换工作区时拉取一次，手动刷新可再触发；不做轮询。
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
  const requestSequenceRef = useRef(0);
  const lastSignatureRef = useRef<string | null>(null);
  const translateRef = useRef(t);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  const runChangesRequest = useCallback(
    (options: { clearStale: boolean }) => {
      if (!workspacePath) return;
      const requestSequence = (requestSequenceRef.current += 1);

      void Promise.resolve()
        .then(() => {
          setIsChangesLoading(true);
          setChangesErrorMessage(null);
          // 切换工作区时丢弃旧根数据与 signature，避免短暂展示他根变更 / 误命中去重。
          if (options.clearStale) {
            setChanges([]);
            setIsChangesUnavailable(false);
            lastSignatureRef.current = null;
          }
          return getProjectWorktreeChanges({ projectId, workspacePath });
        })
        .then((response) => {
          if (!response || requestSequenceRef.current !== requestSequence) {
            return;
          }
          const unchanged = lastSignatureRef.current === response.signature;
          lastSignatureRef.current = response.signature;
          if (!unchanged) {
            setChanges(response.files);
          }
          setIsChangesLoading(false);
          setChangesErrorMessage(null);
          setIsChangesUnavailable(false);
        })
        .catch((error) => {
          if (requestSequenceRef.current !== requestSequence) return;
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

  // 进入变更视图（enabled）或切换工作区时拉取一次（切换工作区先丢弃旧根数据）；不轮询。
  useEffect(() => {
    if (!enabled || !workspacePath) return;
    runChangesRequest({ clearStale: true });
  }, [enabled, workspacePath, runChangesRequest]);

  const refreshChanges = useCallback(
    () => runChangesRequest({ clearStale: false }),
    [runChangesRequest],
  );

  return {
    changes,
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
