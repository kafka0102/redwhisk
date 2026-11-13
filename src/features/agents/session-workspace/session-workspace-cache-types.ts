import type { FileTreeDirectoryListing } from "../../../shared/workspace/file-tree-listings";
import type {
  WorkspaceChangedFile,
  WorkspaceCommitRecord,
  WorkspaceFileTreeNode,
} from "./session-workspace-commands";
import type {
  SessionSidePanelTab,
  SessionWorkspaceChangeTab,
  SessionWorkspaceFileTab,
  SessionWorkspaceTabKind,
} from "./session-workspace-types";

/** 单个 session 的 workspace 缓存；module-level 单例，跨 hook 实例 / Activity 卸载复用。 */
export interface SessionWorkspaceCache {
  activeWorkspaceTab: SessionWorkspaceTabKind;
  changeTab: SessionWorkspaceChangeTab | null;
  changes: WorkspaceChangedFile[];
  changesErrorMessage: string | null;
  changesRequestSequence: number;
  committedChangesExpanded: boolean;
  uncommittedChangesExpanded: boolean;
  commitHistory: WorkspaceCommitRecord[];
  isCommitFromWorktree: boolean;
  // worktree 场景下解析出的分叉基分支名；非 worktree / 主分支 / 解析失败时为 null。
  // 透传到 SessionSidePanel -> SessionChangesPanel 渲染首条黄色提交右侧的黄色 base Tag。
  baseBranch: string | null;
  /** 是否还有更早的已提交历史。 */
  hasMoreCommitHistory: boolean;
  isLoadingMoreCommitHistory: boolean;
  loadMoreCommitHistoryErrorMessage: string | null;
  commitHistoryErrorMessage: string | null;
  commitHistoryRequestSequence: number;
  fileTab: SessionWorkspaceFileTab | null;
  fileTree: WorkspaceFileTreeNode[];
  fileTreeListings: Record<string, FileTreeDirectoryListing>;
  fileTreeErrorMessage: string | null;
  /** 未提交变更是否已有可展示数据（含空列表的成功响应）：加载态 = 无展示数据 && 在途。 */
  hasChangesDisplay: boolean;
  /** 已提交历史是否已有可展示数据（含空列表的成功响应）。 */
  hasCommitHistoryDisplay: boolean;
  isChangesLoading: boolean;
  isChangesUnavailable: boolean;
  isCommitHistoryLoading: boolean;
  isFileTreeLoading: boolean;
  lastCommitHistorySignature: string | null;
  lastChangesSignature: string | null;
  lastFileTreeSignature: string | null;
  sidePanelTab: SessionSidePanelTab;
}

/** 按指定 sessionId 更新 workspace cache 的写入函数（hook 内的 `updateSessionCache`）。 */
export type SessionCacheUpdater = (
  targetSessionId: number,
  updater: (cache: SessionWorkspaceCache) => SessionWorkspaceCache,
) => void;
