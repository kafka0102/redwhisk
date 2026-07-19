import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { CodeWorkspaceChangesView } from "./code-workspace-changes-view";

// 变更视图渲染件以哨兵文本取代，聚焦「视图接线」断言。
vi.mock("../../shared/workspace/workspace-changes-panels", () => ({
  WorkspaceChangesPanels: () => <div>Changes View</div>,
}));

// 视图内部调用的变更数据 hook 返回稳定空态，避免触发未 mock 的 command。
vi.mock("./use-code-workspace-changes", () => ({
  useCodeWorkspaceChanges: () => ({
    changes: [],
    isChangesLoading: false,
    changesErrorMessage: null,
    isChangesUnavailable: false,
    commitHistory: [],
    isCommitHistoryLoading: false,
    commitHistoryErrorMessage: null,
    isWorktree: false,
    refreshChanges: () => {},
    refreshCommitHistory: () => {},
  }),
}));

// 条件轮询 hook 单独在 use-changes-auto-refresh.test.ts 覆盖；组件级测试以 no-op mock 隔离，
// 避免触发真实 listAgentSessions / 事件订阅。
vi.mock("./use-changes-auto-refresh", () => ({
  useWorktreeRunningSession: () => false,
  useChangesAutoRefresh: () => {},
}));

const defaultProps = {
  projectId: 1,
  selectedRootWorkspacePath: "/tmp/redwhisk",
  branchBar: <div>main</div>,
  sidebarWidth: 400,
  onBeginResize: () => {},
  uncommittedChangesExpanded: true,
  committedChangesExpanded: true,
  onToggleUncommittedExpanded: () => {},
  onToggleCommittedExpanded: () => {},
  diffTab: null,
  openDiffChange: () => {},
  openCommittedDiff: () => {},
};

describe("CodeWorkspaceChangesView", () => {
  it("renders the changes panels and diff viewer empty state without a file tree", () => {
    render(
      <I18nProvider initialLocale="en">
        <CodeWorkspaceChangesView {...defaultProps} />
      </I18nProvider>,
    );

    // WorkspaceChangesPanels 哨兵渲染（aside 内变更面板接线）。
    expect(screen.getByText("Changes View")).toBeInTheDocument();
    // DiffViewer 空态（未选中变更文件，diffTab=null）。
    expect(screen.getByText("Select a changed file.")).toBeInTheDocument();
    // 分支下拉占位由外壳传入并渲染。
    expect(screen.getByText("main")).toBeInTheDocument();
    // 文件树与刷新按钮在变更视图下不渲染。
    expect(
      screen.queryByRole("button", { name: "Open file" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Refresh file tree" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Refresh changes" }),
    ).not.toBeInTheDocument();
  });
});
