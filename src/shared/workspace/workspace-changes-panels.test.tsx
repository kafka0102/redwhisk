import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/i18n";
import { WorkspaceChangesPanels } from "./workspace-changes-panels";
import type { WorkspaceCommitRecord } from "./workspace-commands";

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="en">{children}</I18nProvider>;
}

function makeCommit(hash: string): WorkspaceCommitRecord {
  return {
    hash,
    shortHash: hash.slice(0, 6),
    message: `msg ${hash}`,
    authorName: "Alice",
    committedAt: 0,
    files: [],
    isPushed: false,
    pushedTo: null,
    isCreatedInWorktree: false,
  };
}

const baseProps = {
  changes: [],
  isChangesLoading: false,
  changesErrorMessage: null,
  isUncommittedExpanded: false,
  onToggleUncommittedExpanded: () => {},
  onOpenChangedFile: () => {},
  onOpenCommittedChangedFile: () => {},
  commitHistory: [makeCommit("a"), makeCommit("b")],
  isCommitHistoryLoading: false,
  commitHistoryErrorMessage: null,
  isWorktree: false,
  isCommittedExpanded: true,
  onToggleCommittedExpanded: () => {},
};

describe("WorkspaceChangesPanels commit history infinite scroll", () => {
  it("calls onLoadMoreCommitHistory when scrolled near the bottom while expanded", () => {
    const onLoadMoreCommitHistory = vi.fn();
    const { container } = render(
      <WorkspaceChangesPanels
        {...baseProps}
        hasMoreCommitHistory={true}
        isLoadingMoreCommitHistory={false}
        onLoadMoreCommitHistory={onLoadMoreCommitHistory}
      />,
      { wrapper },
    );

    const scroller = container.querySelector(
      ".code-workspace__changes-view",
    ) as HTMLDivElement;
    expect(scroller).not.toBeNull();

    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      get: () => 500,
    });
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      get: () => 200,
    });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => 250,
    });

    fireEvent.scroll(scroller);
    expect(onLoadMoreCommitHistory).toHaveBeenCalledTimes(1);
  });

  it("does not load more when the committed panel is collapsed", () => {
    const onLoadMoreCommitHistory = vi.fn();
    const { container } = render(
      <WorkspaceChangesPanels
        {...baseProps}
        isCommittedExpanded={false}
        hasMoreCommitHistory={true}
        onLoadMoreCommitHistory={onLoadMoreCommitHistory}
      />,
      { wrapper },
    );

    const scroller = container.querySelector(
      ".code-workspace__changes-view",
    ) as HTMLDivElement;
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      get: () => 500,
    });
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      get: () => 200,
    });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => 250,
    });
    fireEvent.scroll(scroller);
    expect(onLoadMoreCommitHistory).not.toHaveBeenCalled();
  });

  it("renders the load-more status text while loading more commits", () => {
    render(
      <WorkspaceChangesPanels
        {...baseProps}
        hasMoreCommitHistory={true}
        isLoadingMoreCommitHistory={true}
      />,
      { wrapper },
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading more commits...",
    );
  });
});

describe("WorkspaceChangesPanels uncommitted empty sync button", () => {
  it("replaces empty copy with sync button for project root when branch is ahead or behind", () => {
    render(
      <WorkspaceChangesPanels
        {...baseProps}
        isUncommittedExpanded={true}
        isProjectRoot={true}
        branchSync={{ upstream: "origin/main", ahead: 0, behind: 2 }}
        onSyncChanges={() => {}}
      />,
      { wrapper },
    );

    expect(
      screen.queryByText("No uncommitted changes."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sync Changes 2↓" }),
    ).toBeInTheDocument();
  });

  it("renders ahead-only and both label shapes", () => {
    const { rerender } = render(
      <WorkspaceChangesPanels
        {...baseProps}
        isUncommittedExpanded={true}
        isProjectRoot={true}
        branchSync={{ upstream: "origin/main", ahead: 3, behind: 0 }}
        onSyncChanges={() => {}}
      />,
      { wrapper },
    );
    expect(
      screen.getByRole("button", { name: "Sync Changes 3↑" }),
    ).toBeInTheDocument();

    rerender(
      <I18nProvider initialLocale="en">
        <WorkspaceChangesPanels
          {...baseProps}
          isUncommittedExpanded={true}
          isProjectRoot={true}
          branchSync={{ upstream: "origin/main", ahead: 1, behind: 4 }}
          onSyncChanges={() => {}}
        />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("button", { name: "Sync Changes 4↓ 1↑" }),
    ).toBeInTheDocument();
  });

  it("keeps empty copy for worktree, dirty tree, loading, or missing handler", () => {
    const cases = [
      {
        isProjectRoot: false,
        branchSync: { upstream: "origin/main", ahead: 1, behind: 0 },
        onSyncChanges: () => {},
        changes: [] as [],
        isChangesLoading: false,
      },
      {
        isProjectRoot: true,
        branchSync: { upstream: "origin/main", ahead: 1, behind: 0 },
        onSyncChanges: () => {},
        changes: [
          {
            filePath: "a.ts",
            oldPath: null,
            fileName: "a.ts",
            kind: "modified" as const,
            status: "M",
            additions: 1,
            deletions: 0,
            isBinary: false,
            contentHash: "h",
            metadataSignature: "m",
          },
        ],
        isChangesLoading: false,
      },
      {
        isProjectRoot: true,
        branchSync: { upstream: "origin/main", ahead: 1, behind: 0 },
        onSyncChanges: () => {},
        changes: [],
        isChangesLoading: true,
      },
      {
        isProjectRoot: true,
        branchSync: { upstream: "origin/main", ahead: 1, behind: 0 },
        onSyncChanges: undefined,
        changes: [],
        isChangesLoading: false,
      },
    ];

    for (const props of cases) {
      const { unmount } = render(
        <WorkspaceChangesPanels
          {...baseProps}
          isUncommittedExpanded={true}
          isProjectRoot={props.isProjectRoot}
          branchSync={props.branchSync}
          onSyncChanges={props.onSyncChanges}
          changes={props.changes}
          isChangesLoading={props.isChangesLoading}
        />,
        { wrapper },
      );
      expect(
        screen.queryByRole("button", { name: /Sync Changes/ }),
      ).not.toBeInTheDocument();
      if (props.changes.length === 0 && !props.isChangesLoading) {
        expect(screen.getByText("No uncommitted changes.")).toBeInTheDocument();
      }
      unmount();
    }
  });

  it("invokes onSyncChanges when the sync button is clicked", () => {
    const onSyncChanges = vi.fn();
    render(
      <WorkspaceChangesPanels
        {...baseProps}
        isUncommittedExpanded={true}
        isProjectRoot={true}
        branchSync={{ upstream: "origin/main", ahead: 1, behind: 2 }}
        onSyncChanges={onSyncChanges}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "Sync Changes 2↓ 1↑" }));
    expect(onSyncChanges).toHaveBeenCalledTimes(1);
  });

  it("renders sync button without refresh icon, label centered via button class", () => {
    render(
      <WorkspaceChangesPanels
        {...baseProps}
        isUncommittedExpanded={true}
        isProjectRoot={true}
        branchSync={{ upstream: "origin/main", ahead: 0, behind: 2 }}
        onSyncChanges={() => {}}
      />,
      { wrapper },
    );

    const button = screen.getByRole("button", { name: "Sync Changes 2↓" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("Sync Changes 2↓");
    expect(
      button.querySelector(".code-workspace__sync-changes-icon"),
    ).not.toBeInTheDocument();
    expect(button.querySelector("svg")).not.toBeInTheDocument();
    expect(button).toHaveClass("code-workspace__sync-changes");
    // 水平居中由 .code-workspace__sync-changes 的 justify-content: center 承担。
  });
});
