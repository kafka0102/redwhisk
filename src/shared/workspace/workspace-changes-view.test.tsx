import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n/i18n";
import { CommittedChangesTimeline } from "./workspace-changes-view";
import type { WorkspaceCommitRecord } from "./workspace-commands";

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="en">{children}</I18nProvider>;
}

function makeCommit(
  overrides: Partial<WorkspaceCommitRecord>,
): WorkspaceCommitRecord {
  return {
    hash: overrides.hash ?? "h",
    shortHash: overrides.shortHash ?? "h",
    message: overrides.message ?? "msg",
    authorName: overrides.authorName ?? "Alice",
    committedAt: overrides.committedAt ?? 0,
    files: overrides.files ?? [],
    isPushed: overrides.isPushed ?? false,
    pushedTo: overrides.pushedTo ?? null,
    isCreatedInWorktree: overrides.isCreatedInWorktree ?? false,
  };
}

const noop = () => {};
const baseProps = {
  errorMessage: null,
  expandedCommitHashes: new Set<string>(),
  isLoading: false,
  onOpenCommittedChangedFile: noop,
  onToggleCommit: noop,
};

describe("CommittedChangesTimeline base branch tag", () => {
  it("renders base tag on the first yellow commit when baseBranch is provided in worktree mode", () => {
    // newest-first：idx0 黄色（fork point）、idx1 新增（蓝）。
    const commits = [
      makeCommit({
        hash: "base",
        message: "base commit",
        isCreatedInWorktree: false,
      }),
      makeCommit({
        hash: "new",
        message: "new commit",
        isCreatedInWorktree: true,
      }),
    ];

    render(
      <CommittedChangesTimeline
        {...baseProps}
        commits={commits}
        isWorktree={true}
        baseBranch="main"
      />,
      { wrapper },
    );

    const baseRow = screen.getByText("base commit").closest("button");
    expect(baseRow).not.toBeNull();
    expect(
      baseRow?.querySelector(".session-commit-row__base-tag"),
    ).not.toBeNull();
    expect(
      baseRow?.querySelector(".session-commit-row__base-tag"),
    ).toHaveTextContent("main");

    // 新增 commit 不渲染 base tag。
    const newRow = screen.getByText("new commit").closest("button");
    expect(newRow?.querySelector(".session-commit-row__base-tag")).toBeNull();
  });

  it("defers pushed tag to the next pushed commit when base and pushed land on the same commit", () => {
    // idx0：同时是首条黄色 + 首条已 push（fork point 已 push）-> base 占位，pushed 顺延。
    // idx1：新增 + 已 push -> pushed Tag 落此。
    const commits = [
      makeCommit({
        hash: "base",
        isCreatedInWorktree: false,
        isPushed: true,
        pushedTo: "origin/main",
      }),
      makeCommit({
        hash: "new",
        isCreatedInWorktree: true,
        isPushed: true,
        pushedTo: "origin/main",
      }),
    ];

    render(
      <CommittedChangesTimeline
        {...baseProps}
        commits={commits}
        isWorktree={true}
        baseBranch="main"
      />,
      { wrapper },
    );

    const rows = screen.getAllByRole("button");
    const baseRow = rows[0];
    const pushedRow = rows[1];

    // 首条 commit：显示 base tag，不显示 pushed tag。
    expect(
      baseRow.querySelector(".session-commit-row__base-tag"),
    ).not.toBeNull();
    expect(baseRow.querySelector(".session-commit-row__remote-tag")).toBeNull();

    // 顺延后：第二条 commit 显示 pushed tag，不显示 base tag。
    expect(
      pushedRow.querySelector(".session-commit-row__remote-tag"),
    ).not.toBeNull();
    expect(pushedRow.querySelector(".session-commit-row__base-tag")).toBeNull();
  });

  it("renders base and pushed tags on their respective commits when they differ", () => {
    // idx0：首条黄色、未 push -> base Tag。
    // idx1：新增、已 push -> pushed Tag。
    const commits = [
      makeCommit({
        hash: "base",
        isCreatedInWorktree: false,
        isPushed: false,
        pushedTo: null,
      }),
      makeCommit({
        hash: "new",
        isCreatedInWorktree: true,
        isPushed: true,
        pushedTo: "origin/main",
      }),
    ];

    render(
      <CommittedChangesTimeline
        {...baseProps}
        commits={commits}
        isWorktree={true}
        baseBranch="main"
      />,
      { wrapper },
    );

    const rows = screen.getAllByRole("button");
    expect(
      rows[0].querySelector(".session-commit-row__base-tag"),
    ).not.toBeNull();
    expect(rows[0].querySelector(".session-commit-row__remote-tag")).toBeNull();
    expect(
      rows[1].querySelector(".session-commit-row__remote-tag"),
    ).not.toBeNull();
    expect(rows[1].querySelector(".session-commit-row__base-tag")).toBeNull();
  });

  it("does not render base tag and keeps pushed tag behavior when baseBranch is absent", () => {
    // 非 worktree（baseBranch 缺省）：不渲染 base Tag；首条已 push commit 显示 pushed Tag。
    const commits = [
      makeCommit({
        hash: "p",
        isPushed: true,
        pushedTo: "origin/main",
      }),
      makeCommit({ hash: "n", isPushed: false, pushedTo: null }),
    ];

    const { container } = render(
      <CommittedChangesTimeline
        {...baseProps}
        commits={commits}
        isWorktree={false}
      />,
      { wrapper },
    );

    expect(container.querySelector(".session-commit-row__base-tag")).toBeNull();

    const rows = screen.getAllByRole("button");
    expect(
      rows[0].querySelector(".session-commit-row__remote-tag"),
    ).not.toBeNull();
    expect(rows[1].querySelector(".session-commit-row__remote-tag")).toBeNull();
  });
});
