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

vi.mock("./agent-visuals", () => ({
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
      fileName: "changes.ts",
      filePath: "src/changes.ts",
      change: {
        fileName: "changes.ts",
        filePath: "src/changes.ts",
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
    ).toEqual([
      "Session",
      "Code",
      "Terminal 1",
      "Browser 1",
      "app.tsx",
      "changes.ts",
    ]);
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
});
