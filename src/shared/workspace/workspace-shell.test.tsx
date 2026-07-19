import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceShell } from "./workspace-shell";

// radix DropdownMenu 在 jsdom 下无法靠点击真正展开（pointer capture 等缺失），
// 这里把它扁平化为「内容常驻」的占位结构，聚焦测 WorkspaceShell 自身的 props 接线
// （选中分支文案、sidebar/main slot、splitter、onSelectRoot 回调）。
vi.mock("../../components/ui", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({
    children,
    ...props
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick: () => void;
  }) => (
    <button type="button" role="menuitem" onClick={onClick}>
      {children}
    </button>
  ),
}));

const projectRoot = { branch: "main", path: "/tmp/repo", isProjectRoot: true };
const featureRoot = {
  branch: "issue-1",
  path: "/tmp/repo.wt/issue-1",
  isProjectRoot: false,
};

describe("WorkspaceShell", () => {
  it("renders the selected branch, sidebar slot, main slot and splitter", () => {
    render(
      <WorkspaceShell
        ariaLabel="Code"
        loadingBranchText="Loading"
        roots={[projectRoot]}
        selectedRoot={projectRoot}
        onSelectRoot={() => {}}
        sidebarWidth={400}
        onBeginResize={() => {}}
        sidebar={<div>sidebar content</div>}
        main={<div>main content</div>}
      />,
    );

    // 选中分支同时出现在 trigger 与菜单项中。
    expect(screen.getAllByText("main").length).toBeGreaterThan(0);
    expect(screen.getByText("sidebar content")).toBeInTheDocument();
    expect(screen.getByText("main content")).toBeInTheDocument();
    expect(screen.getByRole("separator")).toHaveAttribute(
      "aria-valuenow",
      "400",
    );
  });

  it("shows the loading text when no root is selected", () => {
    render(
      <WorkspaceShell
        ariaLabel="Code"
        loadingBranchText="Loading branches"
        roots={[]}
        selectedRoot={null}
        onSelectRoot={() => {}}
        sidebarWidth={400}
        onBeginResize={() => {}}
        sidebar={null}
        main={null}
      />,
    );

    expect(screen.getByText("Loading branches")).toBeInTheDocument();
  });

  it("lists all roots and fires onSelectRoot on pick", async () => {
    const user = userEvent.setup();
    const onSelectRoot = vi.fn();
    render(
      <WorkspaceShell
        ariaLabel="Code"
        loadingBranchText="Loading"
        roots={[projectRoot, featureRoot]}
        selectedRoot={projectRoot}
        onSelectRoot={onSelectRoot}
        sidebarWidth={400}
        onBeginResize={() => {}}
        sidebar={null}
        main={null}
      />,
    );

    await user.click(screen.getByRole("menuitem", { name: "issue-1" }));

    expect(onSelectRoot).toHaveBeenCalledWith(featureRoot);
  });

  it("renders an optional branch-bar trailing slot without requiring it", () => {
    const { rerender } = render(
      <WorkspaceShell
        ariaLabel="Code"
        loadingBranchText="Loading"
        roots={[projectRoot]}
        selectedRoot={projectRoot}
        onSelectRoot={() => {}}
        sidebarWidth={400}
        onBeginResize={() => {}}
        sidebar={<div>sidebar content</div>}
        main={<div>main content</div>}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Search in files" }),
    ).not.toBeInTheDocument();

    rerender(
      <WorkspaceShell
        ariaLabel="Code"
        loadingBranchText="Loading"
        roots={[projectRoot]}
        selectedRoot={projectRoot}
        onSelectRoot={() => {}}
        sidebarWidth={400}
        onBeginResize={() => {}}
        branchBarTrailing={
          <button type="button" aria-label="Search in files">
            Search
          </button>
        }
        sidebar={<div>sidebar content</div>}
        main={<div>main content</div>}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Search in files" }),
    ).toBeInTheDocument();
  });
});
