import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AgentSessionListItem } from "../agent-session-commands";
import {
  AgentsSessionPane,
  type SessionWorkspaceEntry,
} from "./agents-session-pane";

vi.mock("./agent-session-view", () => ({
  AgentSessionView: ({ sessionId }: { sessionId: number }) =>
    createElement("div", {
      "data-testid": `agent-session-view:${sessionId}`,
      "aria-label": "structured",
    }),
}));

vi.mock("./agent-tui-session-view", () => ({
  AgentTuiSessionView: ({ sessionId }: { sessionId: number }) =>
    createElement("div", {
      "data-testid": `agent-tui-session-view:${sessionId}`,
      "aria-label": "tui",
    }),
}));

vi.mock("./agent-tui-archive-markdown-view", () => ({
  AgentTuiArchiveMarkdownView: ({ sessionId }: { sessionId: number }) =>
    createElement("div", {
      "data-testid": `agent-archive-view:${sessionId}`,
    }),
}));

vi.mock("../agent-session-commands", () => ({
  switchAgentSessionDisplayMode: vi.fn(),
  resumeAgentSession: vi.fn(),
  openCompletedReview: vi.fn(),
}));

vi.mock("./completed-review-terminal", () => ({
  CompletedReviewTerminal: ({ sessionId }: { sessionId: number }) =>
    createElement("div", {
      "data-testid": `completed-review-terminal:${sessionId}`,
      "aria-label": "completed review",
    }),
}));

function buildSession(
  overrides: Partial<AgentSessionListItem> = {},
): AgentSessionListItem {
  return {
    sessionId: 10,
    number: 1,
    projectId: 1,
    issueId: null,
    issueNumber: null,
    issueTitle: null,
    issueStatus: null,
    agentProfileId: 1,
    agentProfileName: "Codex",
    workflowSkillName: null,
    canCompleteClean: false,
    canCompleteAgentCommit: false,
    title: "demo",
    agentType: "codex",
    displayMode: "json",
    status: "running",
    attention: "none",
    isTurnRunning: false,
    workspaceMode: "current_branch",
    workingDir: "/tmp",
    workspacePath: null,
    originBranch: null,
    workspaceBranch: null,
    worktreeOwner: "redwhisk",
    logPath: "/tmp/log",
    runtimeLogPath: null,
    latestOutput: null,
    lastActiveAt: 0,
    startedAt: 0,
    closedAt: null,
    processingMs: 0,
    lastOutputAt: null,
    startupModel: null,
    tokenInput: null,
    tokenOutput: null,
    tokenCache: null,
    ...overrides,
  };
}

function buildWorkspace(
  overrides: Partial<SessionWorkspaceEntry> = {},
): SessionWorkspaceEntry {
  return {
    sessionId: 10,
    agentType: "codex",
    sessionStatus: "running",
    issueStatus: null,
    isTurnRunning: false,
    displayMode: "json",
    logPath: "/tmp/log",
    runtimeLogPath: null,
    activeWorkspaceTab: "session",
    changeTab: null,
    fileTab: null,
    toolTabs: [],
    ...overrides,
  };
}

function renderPane(options: {
  displayMode: "json" | "tui";
  sessionId?: number;
}) {
  const sessionId = options.sessionId ?? 10;
  const selectedSession = buildSession({
    sessionId,
    displayMode: options.displayMode,
  });
  const workspace = buildWorkspace({
    sessionId,
    displayMode: options.displayMode,
  });

  return render(
    <AgentsSessionPane
      canRenderTransitionButton={false}
      canRenderTransitionMenu={false}
      isTransitionMenuOpen={false}
      isTransitionPending={false}
      linkedIssue={null}
      isDeletingSession={false}
      isRenamingSessionTitle={false}
      isSidePanelOpen={false}
      onAcknowledgeSessionAttention={vi.fn()}
      onCloseWorkspaceTab={vi.fn()}
      onCreateBrowserTab={vi.fn()}
      onCreateTerminalTab={vi.fn()}
      onDeleteSession={vi.fn()}
      onRenameSessionTitle={vi.fn()}
      onSelectWorkspaceTab={vi.fn()}
      onToggleSidePanel={vi.fn()}
      onToggleTransitionMenu={vi.fn()}
      onTransitionAction={vi.fn()}
      onTransitionMainAction={vi.fn()}
      projectId={1}
      selectedSession={selectedSession}
      cachedSessionIds={[sessionId]}
      sessionWorkspaces={[workspace]}
      transitionButtonLabel={null}
      transitionMenuOptions={[]}
      transitionPhase={null}
    />,
  );
}

describe("AgentsSessionPane displayMode 视图分流", () => {
  it("displayMode=json 时渲染结构化 AgentSessionView，不挂载 TUI 视图", () => {
    renderPane({ displayMode: "json", sessionId: 11 });

    expect(screen.getByTestId("agent-session-view:11")).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-tui-session-view:11"),
    ).not.toBeInTheDocument();
  });

  it("displayMode=tui 时渲染 AgentTuiSessionView，不挂载结构化消息流/composer 主路径", () => {
    renderPane({ displayMode: "tui", sessionId: 12 });

    expect(screen.getByTestId("agent-tui-session-view:12")).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-session-view:12"),
    ).not.toBeInTheDocument();
  });

  it("多会话缓存时各自按 displayMode 挂载对应视图", () => {
    const tuiSession = buildSession({ sessionId: 22, displayMode: "tui" });
    const workspaces: SessionWorkspaceEntry[] = [
      buildWorkspace({ sessionId: 21, displayMode: "json" }),
      buildWorkspace({ sessionId: 22, displayMode: "tui" }),
    ];

    render(
      <AgentsSessionPane
        canRenderTransitionButton={false}
        canRenderTransitionMenu={false}
        isTransitionMenuOpen={false}
        isTransitionPending={false}
        linkedIssue={null}
        isDeletingSession={false}
        isRenamingSessionTitle={false}
        isSidePanelOpen={false}
        onAcknowledgeSessionAttention={vi.fn()}
        onCloseWorkspaceTab={vi.fn()}
        onCreateBrowserTab={vi.fn()}
        onCreateTerminalTab={vi.fn()}
        onDeleteSession={vi.fn()}
        onRenameSessionTitle={vi.fn()}
        onSelectWorkspaceTab={vi.fn()}
        onToggleSidePanel={vi.fn()}
        onToggleTransitionMenu={vi.fn()}
        onTransitionAction={vi.fn()}
        onTransitionMainAction={vi.fn()}
        projectId={1}
        selectedSession={tuiSession}
        cachedSessionIds={[21, 22]}
        sessionWorkspaces={workspaces}
        transitionButtonLabel={null}
        transitionMenuOptions={[]}
        transitionPhase={null}
      />,
    );

    // 实例池常驻挂载：两个 session 的视图同时存在（hidden 切换）。
    expect(screen.getByTestId("agent-session-view:21")).toBeInTheDocument();
    expect(screen.getByTestId("agent-tui-session-view:22")).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-tui-session-view:21"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-session-view:22"),
    ).not.toBeInTheDocument();
  });

  it("同一缓存会话切换 displayMode 时卸掉原来的主区", () => {
    const { rerender } = renderPane({ displayMode: "tui", sessionId: 11 });
    expect(screen.getByTestId("agent-tui-session-view:11")).toBeInTheDocument();

    const selectedSession = buildSession({
      sessionId: 11,
      displayMode: "json",
    });
    rerender(
      <AgentsSessionPane
        canRenderTransitionButton={false}
        canRenderTransitionMenu={false}
        isTransitionMenuOpen={false}
        isTransitionPending={false}
        linkedIssue={null}
        isDeletingSession={false}
        isRenamingSessionTitle={false}
        isSidePanelOpen={false}
        onAcknowledgeSessionAttention={vi.fn()}
        onCloseWorkspaceTab={vi.fn()}
        onCreateBrowserTab={vi.fn()}
        onCreateTerminalTab={vi.fn()}
        onDeleteSession={vi.fn()}
        onRenameSessionTitle={vi.fn()}
        onSelectWorkspaceTab={vi.fn()}
        onToggleSidePanel={vi.fn()}
        onToggleTransitionMenu={vi.fn()}
        onTransitionAction={vi.fn()}
        onTransitionMainAction={vi.fn()}
        projectId={1}
        selectedSession={selectedSession}
        cachedSessionIds={[11]}
        sessionWorkspaces={[
          buildWorkspace({ sessionId: 11, displayMode: "json" }),
        ]}
        transitionButtonLabel={null}
        transitionMenuOptions={[]}
        transitionPhase={null}
      />,
    );

    expect(screen.getByTestId("agent-session-view:11")).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-tui-session-view:11"),
    ).not.toBeInTheDocument();
  });
});

describe("AgentsSessionPane display mode switch button", () => {
  function renderSwitch(options: {
    agentType: AgentSessionListItem["agentType"];
    displayMode?: "json" | "tui";
    issueStatus: "running" | "completed";
  }) {
    const sessionId = 31;
    const selectedSession = buildSession({
      sessionId,
      agentType: options.agentType,
      issueStatus: options.issueStatus,
      displayMode: options.displayMode ?? "json",
      status: "stopped",
    });
    const workspace = buildWorkspace({
      sessionId,
      agentType: options.agentType,
      issueStatus: options.issueStatus,
      sessionStatus: "stopped",
      displayMode: options.displayMode ?? "json",
    });
    return render(
      <AgentsSessionPane
        canRenderTransitionButton={false}
        canRenderTransitionMenu={false}
        isTransitionMenuOpen={false}
        isTransitionPending={false}
        linkedIssue={null}
        isDeletingSession={false}
        isRenamingSessionTitle={false}
        isSidePanelOpen={false}
        onAcknowledgeSessionAttention={vi.fn()}
        onCloseWorkspaceTab={vi.fn()}
        onCreateBrowserTab={vi.fn()}
        onCreateTerminalTab={vi.fn()}
        onDeleteSession={vi.fn()}
        onRenameSessionTitle={vi.fn()}
        onSelectWorkspaceTab={vi.fn()}
        onToggleSidePanel={vi.fn()}
        onToggleTransitionMenu={vi.fn()}
        onTransitionAction={vi.fn()}
        onTransitionMainAction={vi.fn()}
        projectId={1}
        selectedSession={selectedSession}
        cachedSessionIds={[sessionId]}
        sessionWorkspaces={[workspace]}
        transitionButtonLabel={null}
        transitionMenuOptions={[]}
        transitionPhase={null}
      />,
    );
  }

  it("shows the switch for an unfinished Codex session", () => {
    renderSwitch({ agentType: "codex", issueStatus: "running" });
    expect(
      screen.getByRole("button", { name: "Switch to terminal" }),
    ).toBeInTheDocument();
  });

  it("hides the display-mode switch for DeepSeek while an issue is unfinished", () => {
    renderSwitch({
      agentType: "deepseek",
      issueStatus: "running",
    });
    expect(
      screen.queryByRole("button", { name: "Switch to terminal" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Switch to messages" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a stopped unfinished issue on the session view", () => {
    renderSwitch({ agentType: "codex", issueStatus: "running" });
    expect(screen.getByTestId("agent-session-view:31")).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-archive-view:31"),
    ).not.toBeInTheDocument();
  });

  it("defaults a completed issue to the archive, then an interactive review", async () => {
    const { switchAgentSessionDisplayMode, resumeAgentSession } =
      await import("../agent-session-commands");
    renderSwitch({ agentType: "codex", issueStatus: "completed" });

    expect(
      screen.getByLabelText("Completed issue archive"),
    ).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("agent-archive-view:31")).toBeInTheDocument();
    expect(screen.getByLabelText("Read-only session")).toHaveAttribute(
      "hidden",
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch to messages" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "set the status to running on the Issue detail page",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByLabelText("Completed issue archive"),
    ).not.toHaveAttribute("hidden");
    expect(switchAgentSessionDisplayMode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Switch to messages" }));
    fireEvent.click(screen.getByRole("button", { name: "View session" }));
    expect(screen.getByLabelText("Read-only session")).not.toHaveAttribute(
      "hidden",
    );
    expect(
      screen.getByTestId("completed-review-terminal:31"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-session-view:31"),
    ).not.toBeInTheDocument();
    expect(resumeAgentSession).not.toHaveBeenCalled();
    expect(switchAgentSessionDisplayMode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Back to archive" }));
    expect(
      screen.getByLabelText("Completed issue archive"),
    ).not.toHaveAttribute("hidden");
  });

  it("opens the same interactive review for a completed tui session", () => {
    renderSwitch({
      agentType: "codex",
      displayMode: "tui",
      issueStatus: "completed",
    });

    fireEvent.click(screen.getByRole("button", { name: "Switch to terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "View session" }));

    expect(
      screen.getByTestId("completed-review-terminal:31"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-tui-session-view:31"),
    ).not.toBeInTheDocument();
  });
});
