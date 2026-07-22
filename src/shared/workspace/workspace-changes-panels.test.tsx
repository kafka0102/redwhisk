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
