import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import {
  DiffViewer,
  type WorkspaceDiffTab,
} from "../../shared/workspace/diff-viewer";
import { WorkspaceChangesPanels } from "../../shared/workspace/workspace-changes-panels";
import type {
  WorkspaceChangedFile,
  WorkspaceCommitChangedFile,
} from "../../shared/workspace/workspace-commands";
import {
  useChangesAutoRefresh,
  useWorktreeRunningSession,
} from "./use-changes-auto-refresh";
import { useCodeWorkspaceChanges } from "./use-code-workspace-changes";

interface CodeWorkspaceChangesViewProps {
  projectId: number;
  selectedRootWorkspacePath: string | null;
  /** 分支下拉 JSX：由外壳 CodeWorkspace 构造（roots/selectedRoot/selectRoot 在外壳持有），视图仅占位渲染。 */
  branchBar: ReactNode;
  /** 侧栏宽度：splitter 的 aria-valuenow 与 CSS 变量由外壳 <section> 持有；视图仅用本值标注 splitter。 */
  sidebarWidth: number;
  onBeginResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
  /** 两折叠面板展开态：外壳持有并写 codeWorkspaceStateCache，视图受控接收（spec D4'）。 */
  uncommittedChangesExpanded: boolean;
  committedChangesExpanded: boolean;
  onToggleUncommittedExpanded: () => void;
  onToggleCommittedExpanded: () => void;
  /** 单 diff 面板状态：useCodeWorkspaceDiff 留外壳层实例化以保留 diffTab 跨 code↔changes 语义（ticket「实现注意」）。 */
  diffTab: WorkspaceDiffTab | null;
  openDiffChange: (file: WorkspaceChangedFile) => void;
  openCommittedDiff: (
    commitHash: string,
    file: WorkspaceCommitChangedFile,
  ) => void;
}

/**
 * 代码工作区「变更」视图。封装变更数据 hooks 接线（useCodeWorkspaceChanges /
 * useWorktreeRunningSession / useChangesAutoRefresh）与变更 JSX（WorkspaceChangesPanels +
 * DiffViewer）。外壳 CodeWorkspace 在 view === "changes" 时渲染本视图。
 *
 * 分支下拉 / splitter / 侧栏宽度 / root 选择 / useCodeWorkspaceDiff 留外壳持有（ADR-0009、
 * spec D2'/D4'），经 props 传入；本视图随 view === "changes" 条件渲染挂载/卸载，但
 * useCodeWorkspaceDiff 在外壳层实例化，diffTab 跨 code↔changes 保留语义不变。
 */
export function CodeWorkspaceChangesView({
  projectId,
  selectedRootWorkspacePath,
  branchBar,
  sidebarWidth,
  onBeginResize,
  uncommittedChangesExpanded,
  committedChangesExpanded,
  onToggleUncommittedExpanded,
  onToggleCommittedExpanded,
  diffTab,
  openDiffChange,
  openCommittedDiff,
}: CodeWorkspaceChangesViewProps) {
  // 变更视图数据：进入视图或切换工作区时拉取一次；条件轮询由下方
  // useChangesAutoRefresh 按可见性 × running turn 驱动，复用本 hook 的 refresh*。
  const {
    changes: workspaceChanges,
    isChangesLoading,
    changesErrorMessage,
    isChangesUnavailable,
    commitHistory,
    isCommitHistoryLoading,
    commitHistoryErrorMessage,
    isWorktree,
    baseBranch,
    refreshChanges,
    refreshCommitHistory,
  } = useCodeWorkspaceChanges(projectId, selectedRootWorkspacePath, true);

  // 条件轮询：running 标志经 listAgentSessions 全量过滤 + agent-session-list-changed
  // 事件重算得出。本视图仅在 view === "changes" 挂载，enabled 恒为 true。
  const isWorktreeRunning = useWorktreeRunningSession(
    projectId,
    selectedRootWorkspacePath,
    true,
  );
  useChangesAutoRefresh({
    enabled: true,
    running: isWorktreeRunning,
    refreshChanges,
    refreshCommitHistory,
    isUnavailable: isChangesUnavailable,
  });

  return (
    <>
      <aside className="code-workspace__sidebar">
        <div className="code-workspace__branch-bar">{branchBar}</div>
        <WorkspaceChangesPanels
          changes={workspaceChanges}
          changesErrorMessage={changesErrorMessage}
          isChangesLoading={isChangesLoading}
          isUncommittedExpanded={uncommittedChangesExpanded}
          onOpenChangedFile={openDiffChange}
          onOpenCommittedChangedFile={openCommittedDiff}
          onToggleUncommittedExpanded={onToggleUncommittedExpanded}
          commitHistory={commitHistory}
          commitHistoryErrorMessage={commitHistoryErrorMessage}
          isCommitHistoryLoading={isCommitHistoryLoading}
          isWorktree={isWorktree}
          baseBranch={baseBranch}
          isCommittedExpanded={committedChangesExpanded}
          onToggleCommittedExpanded={onToggleCommittedExpanded}
        />
      </aside>
      <div
        className="code-workspace__splitter"
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={230}
        aria-valuemax={640}
        aria-valuenow={sidebarWidth}
        onMouseDown={onBeginResize}
      />
      <main className="code-workspace__main">
        <DiffViewer tab={diffTab} />
      </main>
    </>
  );
}
