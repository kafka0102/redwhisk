import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../shared/i18n/i18n";
import type { MultiDiffViewMode } from "../../../shared/workspace/multi-diff-types";
import { SessionChangesPanel } from "./session-changes-panel";
import type { WorkspaceCommitRecord } from "./session-workspace-commands";

const commit: WorkspaceCommitRecord = {
  hash: "abcdef1234567890",
  shortHash: "abcdef1",
  message: "fix: session summary entry",
  authorName: "Alice",
  committedAt: 1,
  files: [],
  isPushed: false,
  isCreatedInWorktree: false,
};

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="en">{children}</I18nProvider>;
}

function renderPanel(
  onOpenCommitChanges: (
    commit: WorkspaceCommitRecord,
    mode: MultiDiffViewMode,
  ) => void,
) {
  return render(
    <SessionChangesPanel
      changes={[]}
      commitHistory={[commit]}
      commitHistoryErrorMessage={null}
      errorMessage={null}
      isCommitHistoryLoading={false}
      isCommittedExpanded={true}
      isLoading={false}
      isUncommittedExpanded={true}
      isWorktree={false}
      onOpenChangedFile={vi.fn()}
      onOpenCommittedChangedFile={vi.fn()}
      onOpenCommitChanges={onOpenCommitChanges}
      onToggleCommittedExpanded={vi.fn()}
      onToggleUncommittedExpanded={vi.fn()}
    />,
    { wrapper },
  );
}

function openCommitMenu() {
  fireEvent.contextMenu(screen.getByText("fix: session summary entry"));
}

describe("SessionChangesPanel commit context menu", () => {
  it("offers both entries and reports the details mode", async () => {
    const onOpenCommitChanges = vi.fn();
    renderPanel(onOpenCommitChanges);

    openCommitMenu();
    const detailsItem = await screen.findByRole("menuitem", {
      name: "Open Change Details",
    });
    expect(
      screen.getByRole("menuitem", { name: "Open Change Summary" }),
    ).toBeInTheDocument();

    fireEvent.click(detailsItem);

    expect(onOpenCommitChanges).toHaveBeenCalledTimes(1);
    expect(onOpenCommitChanges.mock.calls[0][0]).toMatchObject({
      hash: "abcdef1234567890",
    });
    expect(onOpenCommitChanges.mock.calls[0][1]).toBe("details");
  });

  it("reports the summary mode from the summary entry", async () => {
    const onOpenCommitChanges = vi.fn();
    renderPanel(onOpenCommitChanges);

    openCommitMenu();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Open Change Summary" }),
    );

    expect(onOpenCommitChanges).toHaveBeenCalledTimes(1);
    expect(onOpenCommitChanges.mock.calls[0][1]).toBe("summary");
  });
});
