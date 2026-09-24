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

/**
 * 提交级多文件视图模式：
 * - `details`：提交全部更改视图，逐文件整文件原 / 新对比。
 * - `summary`：提交变更摘要视图，逐文件按 hunk 展示改动与上下文。
 */
export type MultiDiffViewMode = "details" | "summary";

/** 提交级多文件视图状态（与单文件 diff 互斥）；两个模式共用同一份取数状态。 */
export interface MultiDiffViewState {
  commitHash: string;
  mode: MultiDiffViewMode;
  files: MultiDiffFileState[];
}
