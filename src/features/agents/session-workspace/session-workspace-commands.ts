// 共享的工作区（文件树 / 文件读取 / 变更 / 提交历史 / diff）API 与类型，事实源在
// shared/workspace/workspace-commands。agents 内部继续从本模块 re-export，避免 session
// 侧大规模改 import；CodeWorkspace 等其它 feature 应直接从 shared/workspace 引用。
export type {
  CodeWorkspaceRoot,
  CodeWorkspaceRootsResponse,
  CodeWorkspaceRootsUpdatedEvent,
  ProjectWorktreeChangesResponse,
  ProjectWorktreeCommitHistoryResponse,
  ProjectWorktreeFileTreeResponse,
  ProjectWorkspaceInput,
  ProjectWorkspacePathInput,
  WorkspaceChangedFile,
  WorkspaceChangeKind,
  WorkspaceCommitChangedFile,
  WorkspaceCommitRecord,
  WorkspaceCommitStatus,
  WorkspaceDiffContent,
  WorkspaceFileContent,
  WorkspaceFileTreeNode,
} from "../../../shared/workspace/workspace-commands";
export {
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT,
  COMMIT_HISTORY_PAGE_SIZE,
  getProjectWorktreeChanges,
  getProjectWorktreeCommitHistory,
  getProjectWorktreeFileTree,
  listCodeWorkspaceRoots,
  readProjectWorktreeDiff,
  readProjectWorktreeFile,
} from "../../../shared/workspace/workspace-commands";
