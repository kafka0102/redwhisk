import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import { DiffViewer } from "../../shared/workspace/diff-viewer";
import { MultiDiffViewer } from "../../shared/workspace/multi-diff-viewer";
import {
  DEFAULT_SIDEBAR_WIDTH,
  useWorkspaceShell,
} from "../../shared/workspace/use-workspace-shell";
import { WorkspaceShell } from "../../shared/workspace/workspace-shell";
import type { CodeWorkspaceRoot } from "../../shared/workspace/workspace-commands";
import { ChangesBranchMoreMenu } from "./changes-branch-more-menu";
import { CodeWorkspaceChangesView } from "./code-workspace-changes-view";
import { changesWorkspaceCache } from "./changes-workspace-cache";
import { useCodeWorkspaceDiff } from "./use-code-workspace-diff";

interface ChangesActivityProps {
  projectId: number;
  roots: CodeWorkspaceRoot[];
}

/**
 * 「变更」Activity：变更面板 + diff 查看器。分支选择、侧栏宽度、折叠态持久化在
 * changesWorkspaceCache（仅 changes 侧），与「代码」Activity 完全独立。
 *
 * `useCodeWorkspaceDiff` 在本 Activity 实例化——切换到 code 时本 Activity 卸载，
 * diff 面板随之重置（每个 Activity 独立状态，不再跨 code↔changes 保留 diff；
 * 详见 ADR-0018）。root 切换时经 onRootChange → diff.clear() 清空单/多 diff。
 */
export function ChangesActivity({ projectId, roots }: ChangesActivityProps) {
  const { messages } = useI18n();
  const cached = changesWorkspaceCache.get(projectId);
  const [uncommittedExpanded, setUncommittedExpanded] = useState(
    () => cached?.uncommittedChangesExpanded ?? true,
  );
  const [committedExpanded, setCommittedExpanded] = useState(
    () => cached?.committedChangesExpanded ?? true,
  );
  // 拉取/推送成功后递增，驱动变更面板立即重拉未提交 + 已提交历史。
  const [changesRefreshTick, setChangesRefreshTick] = useState(0);
  const handleRemoteSuccess = useCallback(() => {
    setChangesRefreshTick((current) => current + 1);
  }, []);

  // shell 与 diff 互相依赖（onRootChange 要调 diff.clear，diff 要 shell 的 workspace
  // path）：用 ref 桥接 onRootChange，先建 shell，再建 diff，再在 effect 里回填
  // clear 引用（ref 在渲染期不可写，见 react/refs 规则）。
  const diffClearRef = useRef<(() => void) | null>(null);
  const shell = useWorkspaceShell({
    projectId,
    initialRoots: roots,
    initialSelectedRootPath: cached?.selectedRootPath ?? null,
    initialSidebarWidth: cached?.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH,
    onRootChange: () => diffClearRef.current?.(),
  });
  const diff = useCodeWorkspaceDiff(projectId, shell.selectedRootWorkspacePath);
  useEffect(() => {
    diffClearRef.current = diff.clear;
  }, [diff.clear]);

  useEffect(() => {
    changesWorkspaceCache.set(projectId, {
      selectedRootPath: shell.selectedRootPath,
      sidebarWidth: shell.sidebarWidth,
      uncommittedChangesExpanded: uncommittedExpanded,
      committedChangesExpanded: committedExpanded,
    });
  }, [
    projectId,
    shell.selectedRootPath,
    shell.sidebarWidth,
    uncommittedExpanded,
    committedExpanded,
  ]);

  const main =
    diff.multiDiff != null ? (
      <MultiDiffViewer key={diff.multiDiff.commitHash} state={diff.multiDiff} />
    ) : (
      <DiffViewer tab={diff.diffTab} />
    );

  return (
    <WorkspaceShell
      ariaLabel={messages.app.changes}
      loadingBranchText={messages.agentsFeature.loadingCode}
      roots={shell.roots}
      selectedRoot={shell.selectedRoot}
      onSelectRoot={shell.selectRoot}
      sidebarWidth={shell.sidebarWidth}
      onBeginResize={shell.beginResize}
      branchBarTrailing={
        <ChangesBranchMoreMenu
          projectId={projectId}
          selectedRoot={shell.selectedRoot}
          onSuccess={handleRemoteSuccess}
        />
      }
      sidebar={
        <CodeWorkspaceChangesView
          projectId={projectId}
          selectedRootWorkspacePath={shell.selectedRootWorkspacePath}
          isProjectRoot={shell.selectedRoot?.isProjectRoot === true}
          refreshTick={changesRefreshTick}
          uncommittedExpanded={uncommittedExpanded}
          committedExpanded={committedExpanded}
          onToggleUncommitted={() =>
            setUncommittedExpanded((current) => !current)
          }
          onToggleCommitted={() => setCommittedExpanded((current) => !current)}
          onOpenChangedFile={diff.openChange}
          onOpenCommittedChangedFile={diff.openCommittedChange}
          onOpenCommitChanges={diff.openCommitChanges}
        />
      }
      main={main}
    />
  );
}
