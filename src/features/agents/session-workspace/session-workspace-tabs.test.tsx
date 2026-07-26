import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  SessionWorkspaceTabs,
  type SessionWorkspaceToolTab,
} from "./session-workspace-tabs";
import type {
  SessionWorkspaceChangeTab,
  SessionWorkspaceFileTab,
} from "./session-workspace-types";

vi.mock("../agent-visuals", () => ({
  getAgentLogoSrc: vi.fn((agentType: string) => `/logos/${agentType}.svg`),
}));

describe("SessionWorkspaceTabs", () => {
  it("renders the add button after the last workspace tab", () => {
    const fileTab: SessionWorkspaceFileTab = {
      fileName: "app.tsx",
      filePath: "src/app.tsx",
      content: null,
      isLoading: false,
      errorMessage: null,
    };
    const changeTab: SessionWorkspaceChangeTab = {
      mode: "file",
      fileName: "changes.ts",
      filePath: "src/changes.ts",
      change: {
        fileName: "changes.ts",
        filePath: "src/changes.ts",
        oldPath: null,
        kind: "modified",
        status: "M",
        additions: 3,
        deletions: 1,
        isBinary: false,
        contentHash: "hash",
        metadataSignature: "signature",
      },
      diff: null,
      isLoading: false,
      errorMessage: null,
    };
    const toolTabs: SessionWorkspaceToolTab[] = [
      {
        id: "terminal:1",
        kind: "terminal",
        label: "Terminal 1",
        content: <div>Terminal content</div>,
      },
      {
        id: "browser:1",
        kind: "browser",
        label: "Browser 1",
        content: <div>Browser content</div>,
      },
    ];

    render(
      <SessionWorkspaceTabs
        activeTab="browser:1"
        changeTab={changeTab}
        fileTab={fileTab}
        sessionAgentType="claude_code"
        sessionContent={<div>Session content</div>}
        toolTabs={toolTabs}
        onCloseTab={vi.fn()}
        onCreateBrowserTab={vi.fn()}
        onCreateTerminalTab={vi.fn()}
        onSelectTab={vi.fn()}
      />,
    );

    const tablist = screen.getByRole("tablist");
    expect(
      within(tablist)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Session", "Terminal 1", "Browser 1", "app.tsx", "changes.ts"]);
    const tabs = within(tablist).getAllByRole("tab");
    const addButton = within(tablist).getByRole("button", {
      name: "Add session tool",
    });
    const lastTab = tabs[tabs.length - 1];

    expect(lastTab).toBeDefined();
    expect(
      lastTab?.compareDocumentPosition(addButton) ??
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      tablist
        .querySelector(".session-workspace-tabs__agent-icon")
        ?.getAttribute("src"),
    ).toBe("/logos/claude_code.svg");
  });

  it("renders multi-diff change tab label as short hash plus subject", () => {
    const changeTab: SessionWorkspaceChangeTab = {
      mode: "multi",
      label: "abcdef1 feat: open all changes",
      commitHash: "abcdef123456",
      multiDiff: {
        commitHash: "abcdef123456",
        files: [
          {
            fileName: "a.ts",
            filePath: "src/a.ts",
            status: "M",
            kind: "modified",
            diff: null,
            isLoading: true,
            errorMessage: null,
          },
        ],
      },
    };

    render(
      <SessionWorkspaceTabs
        activeTab="changes"
        changeTab={changeTab}
        fileTab={null}
        sessionAgentType="claude_code"
        sessionContent={<div>Session content</div>}
        toolTabs={[]}
        onCloseTab={vi.fn()}
        onCreateBrowserTab={vi.fn()}
        onCreateTerminalTab={vi.fn()}
        onSelectTab={vi.fn()}
      />,
    );

    const tablist = screen.getByRole("tablist");
    expect(
      within(tablist)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Session", "abcdef1 feat: open all changes"]);
    expect(
      screen.getByRole("button", {
        name: "Close abcdef1 feat: open all changes",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Commit all changes")).toBeInTheDocument();
  });

  it("shows only one change tab for multi-diff (slot exclusive with single file)", () => {
    const changeTab: SessionWorkspaceChangeTab = {
      mode: "multi",
      label: "deadbee chore: exclusivity",
      commitHash: "deadbeef",
      multiDiff: { commitHash: "deadbeef", files: [] },
    };

    render(
      <SessionWorkspaceTabs
        activeTab="changes"
        changeTab={changeTab}
        fileTab={null}
        sessionAgentType="claude_code"
        sessionContent={<div>Session content</div>}
        toolTabs={[]}
        onCloseTab={vi.fn()}
        onCreateBrowserTab={vi.fn()}
        onCreateTerminalTab={vi.fn()}
        onSelectTab={vi.fn()}
      />,
    );

    const changeTabs = within(screen.getByRole("tablist"))
      .getAllByRole("tab")
      .filter((tab) => tab.textContent !== "Session");
    expect(changeTabs).toHaveLength(1);
    expect(changeTabs[0]?.textContent).toBe("deadbee chore: exclusivity");
    // multi empty state, not single-file DiffViewer empty prompt
    expect(
      screen.getByText("This commit has no file changes."),
    ).toBeInTheDocument();
  });
});
