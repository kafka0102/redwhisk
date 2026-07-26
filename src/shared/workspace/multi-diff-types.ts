import type {
  WorkspaceChangeKind,
  WorkspaceCommitStatus,
  WorkspaceDiffContent,
} from "./workspace-commands";

/** 提交全部更改视图中单文件 diff 状态。 */
export interface MultiDiffFileState {
  fileName: string;
  filePath: string;
  status: WorkspaceCommitStatus;
  kind: WorkspaceChangeKind;
  diff: WorkspaceDiffContent | null;
  isLoading: boolean;
  errorMessage: string | null;
}

/** 提交全部更改视图状态（与单文件 diff 互斥）。 */
export interface MultiDiffViewState {
  commitHash: string;
  files: MultiDiffFileState[];
}
