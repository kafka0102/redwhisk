import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import {
  changesWorkspaceCache,
  resetChangesWorkspaceCacheForTests,
} from "./changes-workspace-cache";
import { ChangesActivity } from "./changes-activity";

vi.mock("../../shared/workspace/workspace-changes-panels", () => ({
  WorkspaceChangesPanels: () => <div>Changes View</div>,
}));
vi.mock("../../shared/workspace/diff-viewer", () => ({
  DiffViewer: ({ tab }: { tab: unknown }) => (
    <div>{tab ? "diff content" : "Select a changed file."}</div>
  ),
}));
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
    hasMoreCommitHistory: false,
    isLoadingMoreCommitHistory: false,
    loadMoreCommitHistoryErrorMessage: null,
    refreshChanges: () => {},
    refreshCommitHistory: () => {},
    loadMoreCommitHistory: () => {},
  }),
}));
vi.mock("./use-changes-auto-refresh", () => ({
  useWorktreeRunningSession: () => false,
  useChangesAutoRefresh: () => {},
}));
vi.mock("../../shared/workspace/use-code-workspace-roots", () => ({
  useCodeWorkspaceRoots: (_projectId: number, initialRoots: unknown) => ({
    roots: initialRoots,
  }),
}));

const projectRoot = { branch: "main", path: "/tmp/repo", isProjectRoot: true };
const featureRoot = {
  branch: "issue-1",
  path: "/tmp/repo.wt/issue-1",
  isProjectRoot: false,
};

describe("ChangesActivity", () => {
  beforeEach(() => {
    resetChangesWorkspaceCacheForTests();
  });

  it("renders the branch dropdown, changes panels and diff empty state without a file tree", () => {
    render(
      <I18nProvider initialLocale="en">
        <ChangesActivity projectId={1} roots={[projectRoot]} />
      </I18nProvider>,
    );

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("Changes View")).toBeInTheDocument();
    expect(screen.getByText("Select a changed file.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open file" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Search in files" }),
    ).not.toBeInTheDocument();
  });

  it("persists its own selected root independent of code cache", () => {
    changesWorkspaceCache.set(1, {
      selectedRootPath: featureRoot.path,
      sidebarWidth: 320,
      uncommittedChangesExpanded: false,
      committedChangesExpanded: true,
    });

    render(
      <I18nProvider initialLocale="en">
        <ChangesActivity projectId={1} roots={[projectRoot, featureRoot]} />
      </I18nProvider>,
    );

    expect(changesWorkspaceCache.get(1)?.selectedRootPath).toBe(
      featureRoot.path,
    );
  });
});
