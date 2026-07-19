import { useCallback, useState } from "react";

import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import type { WorkspaceDiffTab } from "../../shared/workspace/diff-viewer";
import {
  type WorkspaceChangedFile,
  type WorkspaceCommitChangedFile,
  readProjectWorktreeDiff,
} from "../../shared/workspace/workspace-commands";

/**
 * 变更页右侧单 diff 面板的取数状态。在公共 WorkspaceDiffTab 契约之上额外记录
 * commitHash，用于「同文件 + 同 commitHash 命中缓存」判断，避免未提交 / 已提交
 * 同路径文件互相串用对方 diff。
 */
interface CodeDiffTabState extends WorkspaceDiffTab {
  commitHash: string | null;
}

export interface UseCodeWorkspaceDiffResult {
  diffTab: WorkspaceDiffTab | null;
  openChange: (file: WorkspaceChangedFile) => void;
  openCommittedChange: (
    commitHash: string,
    file: WorkspaceCommitChangedFile,
  ) => void;
  clear: () => void;
}

/**
 * 变更页单 diff 面板取数。管理 loading / diff / error 三态，复用同一 filePath +
 * commitHash 的已加载 diff，避免来回切换同一文件时重复 IPC。
 */
export function useCodeWorkspaceDiff(
  projectId: number,
  workspacePath: string | null,
): UseCodeWorkspaceDiffResult {
  const { t } = useI18n();
  const [diffTab, setDiffTab] = useState<CodeDiffTabState | null>(null);

  const openChange = useCallback(
    (file: WorkspaceChangedFile) => {
      if (!workspacePath) {
        return;
      }

      setDiffTab((current) => ({
        commitHash: null,
        diff:
          current?.filePath === file.filePath && current.commitHash == null
            ? current.diff
            : null,
        errorMessage: null,
        fileName: file.fileName,
        filePath: file.filePath,
        isLoading: true,
      }));

      void readProjectWorktreeDiff({
        projectId,
        workspacePath,
        filePath: file.filePath,
      })
        .then((diff) => {
          setDiffTab((current) =>
            current?.filePath === file.filePath && current.commitHash == null
              ? { ...current, diff, errorMessage: null, isLoading: false }
              : current,
          );
        })
        .catch((error) => {
          setDiffTab((current) =>
            current?.filePath === file.filePath && current.commitHash == null
              ? {
                  ...current,
                  errorMessage: getCommandErrorMessage(error, t),
                  isLoading: false,
                }
              : current,
          );
        });
    },
    [projectId, t, workspacePath],
  );

  const openCommittedChange = useCallback(
    (commitHash: string, file: WorkspaceCommitChangedFile) => {
      if (!workspacePath) {
        return;
      }

      setDiffTab((current) => ({
        commitHash,
        diff:
          current?.filePath === file.filePath &&
          current.commitHash === commitHash
            ? current.diff
            : null,
        errorMessage: null,
        fileName: file.fileName,
        filePath: file.filePath,
        isLoading: true,
      }));

      void readProjectWorktreeDiff({
        commitHash,
        filePath: file.filePath,
        projectId,
        workspacePath,
      })
        .then((diff) => {
          setDiffTab((current) =>
            current?.filePath === file.filePath &&
            current.commitHash === commitHash
              ? { ...current, diff, errorMessage: null, isLoading: false }
              : current,
          );
        })
        .catch((error) => {
          setDiffTab((current) =>
            current?.filePath === file.filePath &&
            current.commitHash === commitHash
              ? {
                  ...current,
                  errorMessage: getCommandErrorMessage(error, t),
                  isLoading: false,
                }
              : current,
          );
        });
    },
    [projectId, t, workspacePath],
  );

  const clear = useCallback(() => {
    setDiffTab(null);
  }, []);

  return {
    diffTab,
    openChange,
    openCommittedChange,
    clear,
  };
}
