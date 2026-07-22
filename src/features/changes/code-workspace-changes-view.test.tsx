import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { CodeWorkspaceChangesView } from "./code-workspace-changes-view";

vi.mock("../../shared/workspace/workspace-changes-panels", () => ({
  WorkspaceChangesPanels: () => <div>Changes View</div>,
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
    refreshChanges: () => {},
    refreshCommitHistory: () => {},
  }),
}));

vi.mock("./use-changes-auto-refresh", () => ({
  useWorktreeRunningSession: () => false,
  useChangesAutoRefresh: () => {},
}));

describe("CodeWorkspaceChangesView", () => {
  it("renders the changes panels for the sidebar slot", () => {
    render(
      <I18nProvider initialLocale="en">
        <CodeWorkspaceChangesView
          projectId={1}
          selectedRootWorkspacePath="/tmp/redwhisk"
          uncommittedExpanded={true}
          committedExpanded={true}
          onToggleUncommitted={() => {}}
          onToggleCommitted={() => {}}
          onOpenChangedFile={() => {}}
          onOpenCommittedChangedFile={() => {}}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Changes View")).toBeInTheDocument();
  });
});
