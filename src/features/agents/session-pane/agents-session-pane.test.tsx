import { createElement, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
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

vi.mock("../session-workspace/session-workspace-tabs", () => ({
  SessionWorkspaceTabs: ({ sessionContent }: { sessionContent: ReactNode }) =>
    createElement(
      "div",
      { "data-testid": "session-workspace-tabs" },
      sessionContent,
    ),
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
    latestOutput: null,
    lastActiveAt: 0,
    startedAt: 0,
    closedAt: null,
    processingMs: 0,
    lastOutputAt: null,
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
});
