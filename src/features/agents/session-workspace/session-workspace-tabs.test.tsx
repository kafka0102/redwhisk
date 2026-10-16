import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { switchAgentSessionDisplayMode } from "../agent-session-commands";

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

vi.mock("../agent-session-commands", () => ({
  switchAgentSessionDisplayMode: vi.fn(() => Promise.resolve({ displayMode: "tui" })),
}));

function renderSwitchTabs(options: {
  agentType: "codex" | "claude" | "claude_code" | "opencode" | "grok" | "deepseek";
  issueStatus: "running" | "review" | "completed" | "backlog" | null;
  sessionStatus: "running" | "stopped" | "closed" | "crashed";
}) {
  return render(
    <SessionWorkspaceTabs
      activeTab="session"
      changeTab={null}
      fileTab={null}
      projectId={1}
      sessionId={7}
      sessionAgentType={options.agentType}
      sessionDisplayMode="json"
      sessionIssueStatus={options.issueStatus}
      sessionStatus={options.sessionStatus}
      sessionContent={<div>Session content</div>}
      toolTabs={[]}
      onCloseTab={vi.fn()}
      onCreateBrowserTab={vi.fn()}
      onCreateTerminalTab={vi.fn()}
      onSelectTab={vi.fn()}
    />,
  );
}

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
        projectId={1}
        sessionId={7}
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
        mode: "details",
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
        projectId={1}
        sessionId={7}
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

  it("renders the summary-mode change tab with hunk panels", () => {
    const changeTab: SessionWorkspaceChangeTab = {
      mode: "multi",
      label: "abcdef1 Change Summary feat: open summary",
      commitHash: "abcdef123456",
      multiDiff: {
        commitHash: "abcdef123456",
        mode: "summary",
        files: [
          {
            fileName: "a.ts",
            filePath: "src/a.ts",
            status: "M",
            kind: "modified",
            diff: {
              filePath: "src/a.ts",
              oldPath: null,
              kind: "modified",
              language: "typescript",
              originalContent: "line1\nline2\nline3",
              modifiedContent: "line1\nchanged\nline3",
              isBinary: false,
              isTooLarge: false,
              previewKind: null,
              originalPreviewBytesBase64: "",
              modifiedPreviewBytesBase64: "",
            },
            isLoading: false,
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
        projectId={1}
        sessionId={7}
        sessionAgentType="claude_code"
        sessionContent={<div>Session content</div>}
        toolTabs={[]}
        onCloseTab={vi.fn()}
        onCreateBrowserTab={vi.fn()}
        onCreateTerminalTab={vi.fn()}
        onSelectTab={vi.fn()}
      />,
    );

    expect(
      within(screen.getByRole("tablist"))
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Session", "abcdef1 Change Summary feat: open summary"]);
    // 摘要视图（按 hunk 的折叠面板）而非整文件对比。
    expect(screen.getByLabelText("Commit change summary")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse Lines 1-3" }),
    ).toBeInTheDocument();
    expect(screen.getByText("changed")).toBeInTheDocument();
  });

  it("shows only one change tab for multi-diff (slot exclusive with single file)", () => {
    const changeTab: SessionWorkspaceChangeTab = {
      mode: "multi",
      label: "deadbee chore: exclusivity",
      commitHash: "deadbeef",
      multiDiff: { commitHash: "deadbeef", mode: "details", files: [] },
    };

    render(
      <SessionWorkspaceTabs
        activeTab="changes"
        changeTab={changeTab}
        fileTab={null}
        projectId={1}
        sessionId={7}
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

describe("SessionWorkspaceTabs display mode switch", () => {
  it("shows the switch at the far right while a dual-mode issue is unfinished", () => {
    for (const agentType of ["codex", "claude", "claude_code", "opencode", "grok"] as const) {
      const view = renderSwitchTabs({
        agentType,
        issueStatus: "running",
        sessionStatus: "stopped",
      });
      const tablist = screen.getByRole("tablist");
      const addButton = within(tablist).getByRole("button", {
        name: "Add session tool",
      });
      const switchButton = within(tablist).getByRole("button", {
        name: "Switch to terminal",
      });
      expect(
        addButton.compareDocumentPosition(switchButton),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      view.unmount();
    }
  });

  it("hides the switch for DeepSeek Harness and completed issues", () => {
    const deepseek = renderSwitchTabs({
      agentType: "deepseek",
      issueStatus: "running",
      sessionStatus: "stopped",
    });
    expect(
      screen.queryByRole("button", { name: "Switch to terminal" }),
    ).not.toBeInTheDocument();
    deepseek.unmount();

    renderSwitchTabs({
      agentType: "codex",
      issueStatus: "completed",
      sessionStatus: "stopped",
    });
    expect(
      screen.queryByRole("button", { name: "Switch to terminal" }),
    ).not.toBeInTheDocument();
  });

  it("asks before stopping a live process and leaves the session unchanged on cancel", () => {
    renderSwitchTabs({
      agentType: "codex",
      issueStatus: "review",
      sessionStatus: "running",
    });

    fireEvent.click(screen.getByRole("button", { name: "Switch to terminal" }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "A session cannot run two tasks at once",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "enter a continue instruction yourself",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(switchAgentSessionDisplayMode).not.toHaveBeenCalled();
  });

  it("stops the live process and switches only after confirmation", () => {
    renderSwitchTabs({
      agentType: "opencode",
      issueStatus: "running",
      sessionStatus: "running",
    });

    fireEvent.click(screen.getByRole("button", { name: "Switch to terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop and switch" }));

    expect(switchAgentSessionDisplayMode).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 7,
    });
  });

  it("switches a stopped process without the termination dialog", () => {
    renderSwitchTabs({
      agentType: "claude",
      issueStatus: "running",
      sessionStatus: "stopped",
    });

    fireEvent.click(screen.getByRole("button", { name: "Switch to terminal" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(switchAgentSessionDisplayMode).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 7,
    });
  });
});
