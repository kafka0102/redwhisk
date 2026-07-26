import { useCallback, useRef, useState } from "react";

import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import type { WorkspaceDiffTab } from "../../shared/workspace/diff-viewer";
import { mapPool } from "../../shared/workspace/map-pool";
import type {
  MultiDiffFileState,
  MultiDiffViewState,
} from "../../shared/workspace/multi-diff-types";
import {
  type WorkspaceChangedFile,
  type WorkspaceCommitChangedFile,
  type WorkspaceCommitRecord,
  readProjectWorktreeDiff,
} from "../../shared/workspace/workspace-commands";

export type { MultiDiffFileState, MultiDiffViewState };

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
  multiDiff: MultiDiffViewState | null;
  openChange: (file: WorkspaceChangedFile) => void;
  openCommittedChange: (
    commitHash: string,
    file: WorkspaceCommitChangedFile,
  ) => void;
  openCommitChanges: (commit: WorkspaceCommitRecord) => void;
  clear: () => void;
}

/** 多文件 diff 有界并发上限。 */
const MULTI_DIFF_CONCURRENCY = 5;

/**
 * 变更页 diff 取数：单文件与提交全部更改（多 diff）互斥。
 * 管理 loading / diff / error；root 切换时 clear 两侧。
 */
export function useCodeWorkspaceDiff(
  projectId: number,
  workspacePath: string | null,
): UseCodeWorkspaceDiffResult {
  const { t } = useI18n();
  const [diffTab, setDiffTab] = useState<CodeDiffTabState | null>(null);
  const [multiDiff, setMultiDiff] = useState<MultiDiffViewState | null>(null);
  const multiGenerationRef = useRef(0);

  const openChange = useCallback(
    (file: WorkspaceChangedFile) => {
      if (!workspacePath) {
        return;
      }

      multiGenerationRef.current += 1;
      setMultiDiff(null);

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

      multiGenerationRef.current += 1;
      setMultiDiff(null);

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

  const openCommitChanges = useCallback(
    (commit: WorkspaceCommitRecord) => {
      if (!workspacePath) {
        return;
      }

      const generation = multiGenerationRef.current + 1;
      multiGenerationRef.current = generation;
      setDiffTab(null);

      const initialFiles: MultiDiffFileState[] = commit.files.map((file) => ({
        fileName: file.fileName,
        filePath: file.filePath,
        status: file.status,
        kind: file.kind,
        diff: null,
        isLoading: true,
        errorMessage: null,
      }));
      setMultiDiff({
        commitHash: commit.hash,
        files: initialFiles,
      });

      if (commit.files.length === 0) {
        return;
      }

      void mapPool(
        commit.files,
        MULTI_DIFF_CONCURRENCY,
        async (file: WorkspaceCommitChangedFile) => {
          try {
            const diff = await readProjectWorktreeDiff({
              commitHash: commit.hash,
              filePath: file.filePath,
              projectId,
              workspacePath,
            });
            if (multiGenerationRef.current !== generation) {
              return;
            }
            setMultiDiff((current) => {
              if (!current || current.commitHash !== commit.hash) {
                return current;
              }
              return {
                ...current,
                files: current.files.map((entry) =>
                  entry.filePath === file.filePath
                    ? {
                        ...entry,
                        diff,
                        errorMessage: null,
                        isLoading: false,
                      }
                    : entry,
                ),
              };
            });
          } catch (error) {
            if (multiGenerationRef.current !== generation) {
              return;
            }
            setMultiDiff((current) => {
              if (!current || current.commitHash !== commit.hash) {
                return current;
              }
              return {
                ...current,
                files: current.files.map((entry) =>
                  entry.filePath === file.filePath
                    ? {
                        ...entry,
                        errorMessage: getCommandErrorMessage(error, t),
                        isLoading: false,
                      }
                    : entry,
                ),
              };
            });
          }
        },
      );
    },
    [projectId, t, workspacePath],
  );

  const clear = useCallback(() => {
    multiGenerationRef.current += 1;
    setDiffTab(null);
    setMultiDiff(null);
  }, []);

  return {
    diffTab,
    multiDiff,
    openChange,
    openCommittedChange,
    openCommitChanges,
    clear,
  };
}
