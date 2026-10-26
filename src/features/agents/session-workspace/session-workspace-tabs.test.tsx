const { openPath, statProjectWorktreeFile } = vi.hoisted(() => ({
  openPath: vi.fn(),
  statProjectWorktreeFile: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: (...args: unknown[]) => openPath(...args),
}));

vi.mock(
  "../../../shared/workspace/workspace-commands",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../shared/workspace/workspace-commands")
      >();
    return {
      ...actual,
      statProjectWorktreeFile: (...args: unknown[]) =>
        statProjectWorktreeFile(...args),
    };
  },
);

vi.mock("../../../shared/use-monaco-editor-ready", () => ({
  useMonacoEditorReady: () => true,
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({
    original,
    modified,
  }: {
    original?: string;
    modified?: string;
  }) => (
    <div data-testid="monaco-diff-editor">
      <span>{original}</span>
      <span>{modified}</span>
    </div>
  ),
}));

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({
    svg: '<svg data-testid="mermaid-svg"><text>diagram</text></svg>',
  })),
}));

vi.mock("mermaid", () => ({
  default: mermaidMock,
}));

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../shared/i18n/i18n";
import { DiffViewer } from "../../../shared/workspace/diff-viewer";
import type {
  WorkspaceChangeKind,
  WorkspaceDiffContent,
} from "../../../shared/workspace/workspace-commands";
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
  switchAgentSessionDisplayMode: vi.fn(() =>
    Promise.resolve({ displayMode: "tui" }),
  ),
}));

const completedOnSession = vi.fn();

function renderSwitchTabs(options: {
  agentType:
    | "codex"
    | "claude"
    | "claude_code"
    | "opencode"
    | "grok"
    | "deepseek";
  issueStatus: "running" | "review" | "completed" | "backlog" | null;
  sessionStatus: "running" | "stopped" | "closed" | "crashed";
  completedReview?: "archive" | "session" | null;
}) {
  return render(
    <SessionWorkspaceTabs
      activeTab="session"
      changeTab={null}
      completedReview={options.completedReview ?? null}
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
      onCompletedReviewArchive={vi.fn()}
      onCompletedReviewSession={completedOnSession}
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
    for (const agentType of [
      "codex",
      "claude",
      "claude_code",
      "opencode",
      "grok",
    ] as const) {
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
      expect(addButton.compareDocumentPosition(switchButton)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(switchButton.className).toContain(
        "session-workspace-tabs__switch",
      );
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

    const completed = renderSwitchTabs({
      agentType: "codex",
      issueStatus: "completed",
      sessionStatus: "stopped",
      completedReview: "archive",
    });
    expect(
      within(screen.getByRole("tablist")).getByRole("button", {
        name: "Switch to messages",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch to messages" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "set the status to running on the Issue detail page",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(switchAgentSessionDisplayMode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Switch to messages" }));
    fireEvent.click(screen.getByRole("button", { name: "View session" }));
    expect(completedOnSession).toHaveBeenCalledTimes(1);
    expect(switchAgentSessionDisplayMode).not.toHaveBeenCalled();
    completed.unmount();
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

describe("Session single-file diff preview and browser actions", () => {
  beforeEach(() => {
    openPath.mockReset();
    statProjectWorktreeFile.mockReset();
    statProjectWorktreeFile.mockResolvedValue({});
    mermaidMock.initialize.mockClear();
    mermaidMock.render.mockReset();
    mermaidMock.render.mockImplementation(async () => ({
      svg: '<svg data-testid="mermaid-svg"><text>diagram</text></svg>',
    }));
  });

  it.each([
    ["uncommitted", undefined],
    ["committed", "abcdef123456"],
  ] as const)(
    "toggles markdown preview for a %s single-file diff",
    async (_label, commitHash) => {
      const user = userEvent.setup();
      render(
        fileDiffTabs({
          commitHash,
          fileName: "readme.md",
          filePath: "docs/readme.md",
          language: "markdown",
        }),
      );

      const toggle = screen.getByRole("button", { name: "Markdown preview" });
      expect(toggle).toHaveAttribute("aria-label", "Markdown preview");
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      expect(rightmostPathControl("Modified docs/readme.md")).toBe(toggle);
      expect(screen.getByTestId("monaco-diff-editor")).toBeInTheDocument();
      expect(screen.getByText("before-marker")).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "after-marker" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Open in browser" }),
      ).not.toBeInTheDocument();

      await user.click(toggle);

      expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.getByRole("heading", { name: "after-marker" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("before-marker")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("monaco-diff-editor"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Open in browser" }),
      ).not.toBeInTheDocument();

      await user.click(toggle);

      expect(toggle).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByTestId("monaco-diff-editor")).toBeInTheDocument();
      expect(screen.getByText("before-marker")).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "after-marker" }),
      ).not.toBeInTheDocument();
    },
  );

  it("names the markdown preview toggle in Chinese", () => {
    render(
      fileDiffTabs({
        fileName: "readme.md",
        filePath: "docs/readme.md",
        language: "markdown",
        locale: "zh",
      }),
    );

    expect(
      screen.getByRole("button", { name: "Markdown 预览" }),
    ).toHaveAttribute("aria-label", "Markdown 预览");
  });

  it("hides the markdown preview toggle when the diff cannot be previewed", () => {
    const { rerender } = render(
      fileDiffTabs({
        fileName: "readme.md",
        filePath: "docs/readme.md",
        kind: "deleted",
        language: "markdown",
      }),
    );
    expect(screen.getByText("before-marker")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();

    rerender(
      fileDiffTabs({
        fileName: "readme.md",
        filePath: "docs/readme.md",
        isBinary: true,
        language: "markdown",
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();

    rerender(
      fileDiffTabs({
        fileName: "readme.md",
        filePath: "docs/readme.md",
        isTooLarge: true,
        language: "markdown",
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();

    rerender(
      fileDiffTabs({
        fileName: "readme.md",
        filePath: "docs/readme.md",
        isLoading: true,
        language: "markdown",
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();

    rerender(
      fileDiffTabs({
        fileName: "notes.mdx",
        filePath: "docs/notes.mdx",
        language: "mdx",
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();
  });

  it("previews an empty modified markdown document", async () => {
    const user = userEvent.setup();
    render(
      fileDiffTabs({
        fileName: "readme.md",
        filePath: "docs/readme.md",
        language: "markdown",
        modifiedContent: "",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Markdown preview" }));

    const preview = document.querySelector(".agents-message__markdown");
    expect(preview).not.toBeNull();
    expect(preview).toHaveTextContent("");
    expect(screen.queryByText("before-marker")).not.toBeInTheDocument();
    expect(screen.queryByTestId("monaco-diff-editor")).not.toBeInTheDocument();
  });

  it("renders mermaid in the modified markdown preview", async () => {
    const user = userEvent.setup();
    render(
      fileDiffTabs({
        fileName: "readme.md",
        filePath: "docs/readme.md",
        language: "markdown",
        modifiedContent: "```mermaid\nflowchart TD\n  A --> B\n```\n",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Markdown preview" }));

    expect(
      await screen.findByTestId("code-mermaid-diagram"),
    ).toBeInTheDocument();
    expect(screen.queryByText("before-marker")).not.toBeInTheDocument();
  });

  it("returns to the diff when the change changes or the tab is closed and reopened", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      fileDiffTabs({
        fileName: "readme.md",
        filePath: "docs/readme.md",
        language: "markdown",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Markdown preview" }));
    expect(
      screen.getByRole("heading", { name: "after-marker" }),
    ).toBeInTheDocument();

    rerender(
      fileDiffTabs({
        fileName: "other.md",
        filePath: "docs/other.md",
        language: "markdown",
        modifiedContent: "# other-marker\n",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Markdown preview" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByRole("heading", { name: "after-marker" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "other-marker" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("monaco-diff-editor")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Markdown preview" }));
    rerender(closedChangeTabs());
    rerender(
      fileDiffTabs({
        fileName: "other.md",
        filePath: "docs/other.md",
        language: "markdown",
        modifiedContent: "# other-marker\n",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Markdown preview" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByRole("heading", { name: "other-marker" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("monaco-diff-editor")).toBeInTheDocument();
  });

  it.each([
    ["uncommitted html", "docs/index.html", "index.html", undefined],
    ["committed html", "docs/index.html", "index.html", "abcdef123456"],
    ["uppercase html", "docs/Index.HTML", "Index.HTML", undefined],
    ["htm", "page.HTM", "page.HTM", "abc123"],
  ] as const)(
    "opens the worktree html file from a %s diff",
    async (_label, filePath, fileName, commitHash) => {
      const user = userEvent.setup();
      render(
        fileDiffTabs({
          commitHash,
          fileName,
          filePath,
          language: "html",
          modifiedContent: "<html>after-html</html>",
          originalContent: "<html>before-html</html>",
        }),
      );

      expect(
        screen.queryByRole("button", { name: "Open in browser" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Markdown preview" }),
      ).not.toBeInTheDocument();

      const openButton = await screen.findByRole("button", {
        name: "Open in browser",
      });
      expect(openButton).toHaveAttribute("aria-label", "Open in browser");
      expect(statProjectWorktreeFile).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 7,
        filePath,
      });
      expect(rightmostPathControl(`Modified ${filePath}`)).toBe(openButton);

      await user.click(openButton);

      expect(openPath).toHaveBeenCalledTimes(1);
      expect(openPath).toHaveBeenCalledWith(`/repo/${filePath}`);
      expect(openPath.mock.calls.flat()).not.toContain(
        "<html>after-html</html>",
      );
      expect(screen.getByTestId("monaco-diff-editor")).toBeInTheDocument();
    },
  );

  it("shows the existing browser failure message when openPath fails", async () => {
    const user = userEvent.setup();
    openPath.mockRejectedValue(new Error("open failed"));
    render(
      fileDiffTabs({
        fileName: "index.html",
        filePath: "docs/index.html",
        language: "html",
        modifiedContent: "<html>after-html</html>",
      }),
    );

    await user.click(
      await screen.findByRole("button", { name: "Open in browser" }),
    );

    expect(openPath).toHaveBeenCalledWith("/repo/docs/index.html");
    expect(
      await screen.findByText("Could not open this file in the browser."),
    ).toBeInTheDocument();
  });

  it("keeps the browser action hidden until the worktree stat succeeds", async () => {
    let resolveStat: (value: unknown) => void = () => {};
    statProjectWorktreeFile.mockReturnValue(
      new Promise((resolve) => {
        resolveStat = resolve;
      }),
    );
    render(
      fileDiffTabs({
        fileName: "index.html",
        filePath: "docs/index.html",
        language: "html",
        modifiedContent: "<html>after-html</html>",
      }),
    );

    await waitFor(() => {
      expect(statProjectWorktreeFile).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveStat({});
    });

    expect(
      await screen.findByRole("button", { name: "Open in browser" }),
    ).toBeInTheDocument();
  });

  it("hides the browser action when the worktree stat fails or the root is missing", async () => {
    statProjectWorktreeFile.mockRejectedValue(new Error("missing"));
    const { rerender } = render(
      fileDiffTabs({
        fileName: "index.html",
        filePath: "docs/index.html",
        language: "html",
      }),
    );

    await waitFor(() => {
      expect(statProjectWorktreeFile).toHaveBeenCalled();
    });
    await act(async () => {
      await statProjectWorktreeFile.mock.results[0]?.value.catch(
        () => undefined,
      );
    });
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();

    statProjectWorktreeFile.mockClear();
    rerender(
      fileDiffTabs({
        fileName: "index.html",
        filePath: "docs/index.html",
        language: "html",
        workspacePath: null,
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();
  });

  it("does not show preview or browser actions on shared, summary, or commit-all diffs", async () => {
    const { rerender } = render(
      <DiffViewer
        tab={{
          fileName: "readme.md",
          filePath: "docs/readme.md",
          diff: diffContent({
            filePath: "docs/readme.md",
            language: "markdown",
          }),
          isLoading: false,
          errorMessage: null,
        }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();

    rerender(
      <DiffViewer
        tab={{
          fileName: "index.html",
          filePath: "docs/index.html",
          diff: diffContent({
            filePath: "docs/index.html",
            language: "html",
            modifiedContent: "<html>after-html</html>",
            originalContent: "<html>before-html</html>",
          }),
          isLoading: false,
          errorMessage: null,
        }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();

    rerender(
      <SessionWorkspaceTabs
        activeTab="changes"
        changeTab={{
          mode: "multi",
          label: "abcdef1 feat: all",
          commitHash: "abcdef123456",
          multiDiff: {
            commitHash: "abcdef123456",
            mode: "details",
            files: [
              {
                fileName: "readme.md",
                filePath: "docs/readme.md",
                status: "M",
                kind: "modified",
                diff: diffContent({
                  filePath: "docs/readme.md",
                  language: "markdown",
                }),
                isLoading: false,
                errorMessage: null,
              },
              {
                fileName: "index.html",
                filePath: "docs/index.html",
                status: "M",
                kind: "modified",
                diff: diffContent({
                  filePath: "docs/index.html",
                  language: "html",
                }),
                isLoading: false,
                errorMessage: null,
              },
            ],
          },
        }}
        fileTab={null}
        projectId={1}
        sessionId={7}
        workspacePath="/repo"
        sessionAgentType="claude_code"
        sessionContent={<div>Session content</div>}
        toolTabs={[]}
        onCloseTab={vi.fn()}
        onCreateBrowserTab={vi.fn()}
        onCreateTerminalTab={vi.fn()}
        onSelectTab={vi.fn()}
      />,
    );
    expect(screen.getAllByText("before-marker").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();

    rerender(
      <SessionWorkspaceTabs
        activeTab="changes"
        changeTab={{
          mode: "multi",
          label: "abcdef1 Change Summary feat: summary",
          commitHash: "abcdef123456",
          multiDiff: {
            commitHash: "abcdef123456",
            mode: "summary",
            files: [
              {
                fileName: "readme.md",
                filePath: "docs/readme.md",
                status: "M",
                kind: "modified",
                diff: diffContent({
                  filePath: "docs/readme.md",
                  language: "markdown",
                  originalContent: "line1\nline2\nline3",
                  modifiedContent: "line1\nchanged\nline3",
                }),
                isLoading: false,
                errorMessage: null,
              },
            ],
          },
        }}
        fileTab={null}
        projectId={1}
        sessionId={7}
        workspacePath="/repo"
        sessionAgentType="claude_code"
        sessionContent={<div>Session content</div>}
        toolTabs={[]}
        onCloseTab={vi.fn()}
        onCreateBrowserTab={vi.fn()}
        onCreateTerminalTab={vi.fn()}
        onSelectTab={vi.fn()}
      />,
    );
    expect(screen.getByText("changed")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Markdown preview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in browser" }),
    ).not.toBeInTheDocument();
  });
});

function rightmostPathControl(pathText: string): Element | undefined {
  const path = screen.getByText(pathText);
  const pathRow = path.parentElement;
  expect(pathRow).not.toBeNull();
  const controls = [...pathRow!.querySelectorAll("button, a")];
  return controls[controls.length - 1];
}

function diffContent(
  overrides: Partial<WorkspaceDiffContent> &
    Pick<WorkspaceDiffContent, "filePath" | "language">,
): WorkspaceDiffContent {
  return {
    oldPath: null,
    kind: "modified",
    originalContent: "before-marker",
    modifiedContent: "# after-marker\n",
    isBinary: false,
    isTooLarge: false,
    previewKind: null,
    originalPreviewBytesBase64: "",
    modifiedPreviewBytesBase64: "",
    ...overrides,
  };
}

function fileDiffTabs(options: {
  fileName: string;
  filePath: string;
  language: string | null;
  kind?: WorkspaceChangeKind;
  originalContent?: string;
  modifiedContent?: string;
  isBinary?: boolean;
  isTooLarge?: boolean;
  isLoading?: boolean;
  errorMessage?: string | null;
  commitHash?: string | null;
  workspacePath?: string | null;
  locale?: "en" | "zh";
}) {
  const kind = options.kind ?? "modified";
  const changeTab: SessionWorkspaceChangeTab = {
    mode: "file",
    fileName: options.fileName,
    filePath: options.filePath,
    commitHash: options.commitHash,
    change: {
      fileName: options.fileName,
      filePath: options.filePath,
      oldPath: null,
      kind,
      status: "M",
      additions: 1,
      deletions: 1,
      isBinary: options.isBinary ?? false,
      contentHash: "hash",
      metadataSignature: "signature",
    },
    diff: options.isLoading
      ? null
      : diffContent({
          filePath: options.filePath,
          kind,
          language: options.language,
          ...(options.originalContent === undefined
            ? {}
            : { originalContent: options.originalContent }),
          ...(options.modifiedContent === undefined
            ? {}
            : { modifiedContent: options.modifiedContent }),
          ...(options.isBinary === undefined
            ? {}
            : { isBinary: options.isBinary }),
          ...(options.isTooLarge === undefined
            ? {}
            : { isTooLarge: options.isTooLarge }),
        }),
    isLoading: options.isLoading ?? false,
    errorMessage: options.errorMessage ?? null,
  };
  const tabs = (
    <SessionWorkspaceTabs
      activeTab="changes"
      changeTab={changeTab}
      fileTab={null}
      projectId={1}
      sessionId={7}
      workspacePath={
        options.workspacePath === undefined ? "/repo" : options.workspacePath
      }
      sessionAgentType="claude_code"
      sessionContent={<div>Session content</div>}
      toolTabs={[]}
      onCloseTab={vi.fn()}
      onCreateBrowserTab={vi.fn()}
      onCreateTerminalTab={vi.fn()}
      onSelectTab={vi.fn()}
    />
  );
  if (!options.locale) {
    return tabs;
  }
  return <I18nProvider initialLocale={options.locale}>{tabs}</I18nProvider>;
}

function closedChangeTabs() {
  return (
    <SessionWorkspaceTabs
      activeTab="session"
      changeTab={null}
      fileTab={null}
      projectId={1}
      sessionId={7}
      workspacePath="/repo"
      sessionAgentType="claude_code"
      sessionContent={<div>Session content</div>}
      toolTabs={[]}
      onCloseTab={vi.fn()}
      onCreateBrowserTab={vi.fn()}
      onCreateTerminalTab={vi.fn()}
      onSelectTab={vi.fn()}
    />
  );
}
