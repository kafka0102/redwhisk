import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openPath } from "@tauri-apps/plugin-opener";

import { AgentsActivity } from "./agents-activity";
import {
  listAgentSessions,
  readAgentSessionTerminal,
  resizeAgentSessionTerminal,
  setAgentSessionAttention,
  startStandaloneAgentSession,
  writeAgentSessionTerminal,
} from "./agent-session-commands";
import {
  listIssues,
  markIssueReview,
  updateIssue,
} from "../issues/issue-commands";
import { listAgentProfiles } from "../settings/settings-commands";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(),
}));

vi.mock("./agent-session-commands", () => ({
  listAgentSessions: vi.fn(),
  readAgentSessionTerminal: vi.fn(),
  resizeAgentSessionTerminal: vi.fn(),
  setAgentSessionAttention: vi.fn(),
  startStandaloneAgentSession: vi.fn(),
  writeAgentSessionTerminal: vi.fn(),
}));

vi.mock("../settings/settings-commands", () => ({
  listAgentProfiles: vi.fn(),
}));

vi.mock("../issues/issue-commands", () => ({
  listIssues: vi.fn(),
  markIssueReview: vi.fn(),
  updateIssue: vi.fn(),
}));

const listAgentSessionsMock = vi.mocked(listAgentSessions);
const readAgentSessionTerminalMock = vi.mocked(readAgentSessionTerminal);
const resizeAgentSessionTerminalMock = vi.mocked(resizeAgentSessionTerminal);
const setAgentSessionAttentionMock = vi.mocked(setAgentSessionAttention);
const startStandaloneAgentSessionMock = vi.mocked(startStandaloneAgentSession);
const writeAgentSessionTerminalMock = vi.mocked(writeAgentSessionTerminal);
const listAgentProfilesMock = vi.mocked(listAgentProfiles);
const listIssuesMock = vi.mocked(listIssues);
const markIssueReviewMock = vi.mocked(markIssueReview);
const updateIssueMock = vi.mocked(updateIssue);
const openPathMock = vi.mocked(openPath);

const defaultProfiles = {
  project: [
    {
      id: 101,
      name: "Project Agent",
      agentType: "codex" as const,
      command: "codex",
      scope: "project" as const,
      projectId: 1,
      mode: "full-auto",
      dangerous: true,
      defaultSkill: "",
      promptTemplate: "",
    },
  ],
  global: [
    {
      id: 201,
      name: "Global Agent",
      agentType: "codex" as const,
      command: "codex",
      scope: "global" as const,
      projectId: null,
      mode: "full-auto",
      dangerous: true,
      defaultSkill: "",
      promptTemplate: "",
    },
  ],
};

describe("AgentsActivity", () => {
  beforeEach(() => {
    listAgentSessionsMock.mockReset();
    readAgentSessionTerminalMock.mockReset();
    resizeAgentSessionTerminalMock.mockReset();
    setAgentSessionAttentionMock.mockReset();
    startStandaloneAgentSessionMock.mockReset();
    writeAgentSessionTerminalMock.mockReset();
    listIssuesMock.mockReset();
    markIssueReviewMock.mockReset();
    updateIssueMock.mockReset();
    openPathMock.mockReset();
    readAgentSessionTerminalMock.mockResolvedValue({
      sessionId: 301,
      snapshot: "",
      isActive: true,
    });
    resizeAgentSessionTerminalMock.mockResolvedValue();
    setAgentSessionAttentionMock.mockResolvedValue({
      sessionId: 301,
      attention: "requested",
    });
    startStandaloneAgentSessionMock.mockResolvedValue({
      sessionId: 701,
    });
    writeAgentSessionTerminalMock.mockResolvedValue();
    openPathMock.mockResolvedValue();
    listIssuesMock.mockResolvedValue({
      issues: [
        {
          id: 20,
          projectId: 1,
          title: "Existing issue",
          description: "Existing description",
          status: "running",
          linkedSessionId: 301,
          linkedSessionStatus: "running",
          linkedSessionAttention: "none",
          createdAt: 1_780_637_000_000,
          updatedAt: 1_780_637_000_000,
        },
        {
          id: 21,
          projectId: 1,
          title: "Running issue",
          description: "Running description",
          status: "running",
          linkedSessionId: 302,
          linkedSessionStatus: "running",
          linkedSessionAttention: "none",
          createdAt: 1_780_638_000_000,
          updatedAt: 1_780_638_000_000,
        },
      ],
    });
    markIssueReviewMock.mockResolvedValue({
      id: 20,
      projectId: 1,
      title: "Existing issue",
      description: "",
      status: "review",
      linkedSessionId: 301,
      linkedSessionStatus: "running",
      linkedSessionAttention: "none",
      createdAt: 1_780_637_000_000,
      updatedAt: 1_780_638_001_000,
    });
    updateIssueMock.mockImplementation(async (input) => ({
      id: input.issueId,
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      status: "running",
      linkedSessionId: 301,
      linkedSessionStatus: "running",
      linkedSessionAttention: "none",
      createdAt: 1_780_637_000_000,
      updatedAt: 1_780_638_002_000,
    }));
    listAgentProfilesMock.mockReset();
    listAgentProfilesMock.mockImplementation(async ({ scope }) => ({
      profiles:
        scope === "project" ? defaultProfiles.project : defaultProfiles.global,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders groups, terminal workspace and info pane for the selected session", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          issueId: 21,
          issueTitle: "Running issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
        },
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
        {
          sessionId: 401,
          issueId: 22,
          issueTitle: "Closed issue",
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          lastActiveAt: 1_780_630_000_000,
          startedAt: 1_780_629_000_000,
          closedAt: 1_780_631_000_000,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Agents" }),
    ).toBeInTheDocument();

    const runningGroup = await screen.findByRole("region", {
      name: "Running sessions",
    });
    const completedGroup = screen.getByRole("region", {
      name: "Completed sessions",
    });

    expect(within(runningGroup).getByText("Running(2)")).toBeInTheDocument();
    expect(
      within(completedGroup).getByText("Completed(1)"),
    ).toBeInTheDocument();
    expect(
      within(runningGroup).getByRole("button", { name: /Existing issue/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Linked Issue")).not.toBeInTheDocument();
    expect(screen.queryByText("Selected Session")).not.toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: "Resize session list" }),
    ).toHaveAttribute("aria-valuenow", "200");
    expect(
      screen.getByRole("separator", { name: "Resize session info" }),
    ).toHaveAttribute("aria-valuenow", "0");
    expect(
      screen.queryByRole("complementary", { name: "Issue Inspector" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /#issue20.*Existing issue/i }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Codex Session terminal")).toBeInTheDocument();
  });

  it("opens the temporary session dialog from the toolbar without changing session state", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    const newSessionButton = await screen.findByRole("button", {
      name: "New session",
    });

    await user.click(newSessionButton);

    const dialog = screen.getByRole("dialog", { name: "Session Dialog" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("Session title")).toHaveValue(
      "Untitled Session",
    );
    expect(screen.getByLabelText("Agent profile")).toBeInTheDocument();
    expect(screen.getByLabelText("Initial prompt")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Start" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText("Working directory"),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Command")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Profile scope")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText("Prompt sources"),
    ).not.toBeInTheDocument();
    expect(listAgentSessionsMock).toHaveBeenCalledTimes(1);
    const runningGroup = await screen.findByRole("region", {
      name: "Running sessions",
    });
    expect(
      within(runningGroup).getByRole("button", { name: /Existing issue/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("closes the temporary session dialog with escape and restores focus to the toolbar trigger", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    const newSessionButton = await screen.findByRole("button", {
      name: "New session",
    });
    await user.click(newSessionButton);

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("dialog", { name: "Session Dialog" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(newSessionButton).toHaveFocus());
  });

  it("closes the temporary session dialog from the cancel action and restores focus", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    const newSessionButton = await screen.findByRole("button", {
      name: "New session",
    });
    await user.click(newSessionButton);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByRole("dialog", { name: "Session Dialog" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(newSessionButton).toHaveFocus());
  });

  it("disables start and shows a factual message when no agent profiles are available", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await user.click(
      await screen.findByRole("button", {
        name: "New session",
      }),
    );

    const dialog = screen.getByRole("dialog", { name: "Session Dialog" });
    expect(
      within(dialog).getByText(
        "No agent profiles available. Configure an agent in Settings first.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Start" }),
    ).toBeDisabled();
  });

  it("starts a temporary session, refreshes the list, and hides the linked issue pane for the new session", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 301,
            issueId: 20,
            issueTitle: "Existing issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 701,
            issueId: null,
            issueTitle: null,
            title: "Scratch Session",
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_500_000,
            startedAt: 1_780_638_500_000,
            closedAt: null,
          },
          {
            sessionId: 301,
            issueId: 20,
            issueTitle: "Existing issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
          },
        ],
      })
      .mockResolvedValue({
        sessions: [
          {
            sessionId: 701,
            issueId: null,
            issueTitle: null,
            title: "Scratch Session",
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_500_000,
            startedAt: 1_780_638_500_000,
            closedAt: null,
          },
          {
            sessionId: 301,
            issueId: 20,
            issueTitle: "Existing issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
          },
        ],
      });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await user.click(
      await screen.findByRole("button", {
        name: "New session",
      }),
    );
    await user.clear(screen.getByLabelText("Session title"));
    await user.type(screen.getByLabelText("Session title"), "Scratch Session");
    await user.clear(screen.getByLabelText("Initial prompt"));
    await user.type(
      screen.getByLabelText("Initial prompt"),
      "Help me inspect the current repo",
    );
    await user.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() =>
      expect(startStandaloneAgentSessionMock).toHaveBeenCalledWith({
        projectId: 1,
        title: "Scratch Session",
        agentProfileId: 101,
        promptSnapshot: "Help me inspect the current repo",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Session Dialog" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole("heading", { level: 3, name: "Scratch Session" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Linked issue" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^Issue$/)).not.toBeInTheDocument();
    expect(screen.queryByText("No linked issue")).not.toBeInTheDocument();
  });

  it("keeps the temporary session dialog open and shows the start failure reason", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
      ],
    });
    startStandaloneAgentSessionMock.mockRejectedValue({
      code: "AGENT_SESSION_START_FAILED",
      message: "Agent 进程启动失败。",
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await user.click(
      await screen.findByRole("button", {
        name: "New session",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Start" }));

    expect(
      await screen.findByRole("dialog", { name: "Session Dialog" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Agent 进程启动失败。")).toBeInTheDocument();
    expect(listAgentSessionsMock).toHaveBeenCalledTimes(1);
  });

  it("shows only closed, crashed and stopped sessions in the completed group", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          issueId: 21,
          issueTitle: "Running issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
        },
        {
          sessionId: 401,
          issueId: 22,
          issueTitle: "Closed issue",
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          lastActiveAt: 1_780_630_000_000,
          startedAt: 1_780_629_000_000,
          closedAt: 1_780_631_000_000,
        },
        {
          sessionId: 402,
          issueId: 23,
          issueTitle: "Crashed issue",
          title: null,
          agentType: "codex",
          status: "crashed",
          attention: "none",
          lastActiveAt: 1_780_632_000_000,
          startedAt: 1_780_631_000_000,
          closedAt: 1_780_633_000_000,
        },
        {
          sessionId: 403,
          issueId: 24,
          issueTitle: "Stopped issue",
          title: null,
          agentType: "codex",
          status: "stopped",
          attention: "none",
          lastActiveAt: 1_780_634_000_000,
          startedAt: 1_780_633_000_000,
          closedAt: 1_780_635_000_000,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    const completedGroup = await screen.findByRole("region", {
      name: "Completed sessions",
    });

    expect(
      within(completedGroup).getByText("Completed(3)"),
    ).toBeInTheDocument();
    expect(
      within(completedGroup).getByRole("button", { name: /Stopped issue/i }),
    ).toBeInTheDocument();
    expect(
      within(completedGroup).getByRole("button", { name: /Crashed issue/i }),
    ).toBeInTheDocument();
    expect(
      within(completedGroup).getByRole("button", { name: /Closed issue/i }),
    ).toBeInTheDocument();
    expect(
      within(completedGroup).queryByRole("button", { name: /Running issue/i }),
    ).not.toBeInTheDocument();
  });

  it("allows manually switching to another session even when an initial active session is provided", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          issueId: 21,
          issueTitle: "Running issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
        },
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    const runningGroup = await screen.findByRole("region", {
      name: "Running sessions",
    });
    const existingIssueRow = within(runningGroup).getByRole("button", {
      name: /Existing issue/i,
    });
    const runningIssueRow = within(runningGroup).getByRole("button", {
      name: /Running issue/i,
    });

    expect(existingIssueRow).toHaveAttribute("aria-pressed", "true");

    await user.click(runningIssueRow);

    expect(runningIssueRow).toHaveAttribute("aria-pressed", "true");
    expect(existingIssueRow).toHaveAttribute("aria-pressed", "false");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /#issue21.*Running issue/i }),
      ).toBeInTheDocument(),
    );
  });

  it("shows an attention status dot on session rows without rendering running text", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          issueId: 21,
          issueTitle: "Needs attention issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "requested",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
        },
        {
          sessionId: 303,
          issueId: 22,
          issueTitle: "Quiet issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    const runningGroup = await screen.findByRole("region", {
      name: "Running sessions",
    });
    const attentionRow = within(runningGroup).getByRole("button", {
      name: /Needs attention issue/i,
    });
    const quietRow = within(runningGroup).getByRole("button", {
      name: /Quiet issue/i,
    });

    expect(
      within(attentionRow).getByLabelText("Session 状态：需要确认"),
    ).toHaveClass("agents-session-row__status-dot--attention");
    expect(within(quietRow).getByLabelText("Session 状态：运行中")).toHaveClass(
      "agents-session-row__status-dot--running",
    );
    expect(attentionRow).not.toHaveTextContent("running");
    expect(quietRow).not.toHaveTextContent("running");
  });

  it("hides the status dot for completed sessions", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 401,
          issueId: 22,
          issueTitle: "Closed issue",
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          logPath: "/tmp/closed.log",
          lastActiveAt: 1_780_630_000_000,
          startedAt: 1_780_629_000_000,
          closedAt: 1_780_631_000_000,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={401} projectId={1} />);

    const completedGroup = await screen.findByRole("region", {
      name: "Completed sessions",
    });
    const completedRow = within(completedGroup).getByRole("button", {
      name: /Closed issue/i,
    });

    expect(
      within(completedRow).queryByLabelText("Session 状态：closed"),
    ).not.toBeInTheDocument();
    expect(completedRow).toHaveTextContent("closed");
  });

  it("shows crashed status and opens the session log from the header", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 402,
          issueId: 23,
          issueTitle: "Crashed issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "crashed",
          attention: "none",
          logPath: "/tmp/crashed.log",
          lastActiveAt: 1_780_632_000_000,
          startedAt: 1_780_631_000_000,
          closedAt: 1_780_633_000_000,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={402} projectId={1} />);

    const completedGroup = await screen.findByRole("region", {
      name: "Completed sessions",
    });
    const crashedRow = within(completedGroup).getByRole("button", {
      name: /Crashed issue/i,
    });

    expect(crashedRow).toHaveTextContent("crashed");
    expect(await screen.findByText("Status: crashed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Log" }));

    expect(openPathMock).toHaveBeenCalledWith("/tmp/crashed.log");
    expect(
      screen.queryByRole("button", { name: "Open Session" }),
    ).not.toBeInTheDocument();
  });

  it("surfaces open log failures for crashed sessions", async () => {
    const user = userEvent.setup();
    openPathMock.mockRejectedValueOnce(new Error("log unavailable"));
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 402,
          issueId: 23,
          issueTitle: "Crashed issue",
          issueStatus: "review",
          title: null,
          agentType: "codex",
          status: "crashed",
          attention: "none",
          logPath: "/tmp/crashed.log",
          lastActiveAt: 1_780_632_000_000,
          startedAt: 1_780_631_000_000,
          closedAt: 1_780_633_000_000,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={402} projectId={1} />);

    await screen.findByText("Status: crashed");
    await user.click(screen.getByRole("button", { name: "Open Log" }));

    expect(await screen.findByText("log unavailable")).toBeInTheDocument();
  });

  it("polls the session list and refreshes the attention dot", async () => {
    vi.useFakeTimers();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            issueId: 21,
            issueTitle: "Polling issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            issueId: 21,
            issueTitle: "Polling issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "requested",
            lastActiveAt: 1_780_638_000_500,
            startedAt: 1_780_638_000_000,
            closedAt: null,
          },
        ],
      });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    await act(async () => {
      await Promise.resolve();
    });
    const runningGroup = screen.getByRole("region", {
      name: "Running sessions",
    });
    const initialRow = within(runningGroup).getByRole("button", {
      name: /Polling issue/i,
    });
    expect(
      within(initialRow).getByLabelText("Session 状态：运行中"),
    ).toHaveClass("agents-session-row__status-dot--running");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    const refreshedRow = within(runningGroup).getByRole("button", {
      name: /Polling issue/i,
    });
    expect(
      within(refreshedRow).getByLabelText("Session 状态：需要确认"),
    ).toHaveClass("agents-session-row__status-dot--attention");
  });

  it("turns a running session gray after the user clicks it", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          issueId: 21,
          issueTitle: "Viewed session issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    const runningGroup = await screen.findByRole("region", {
      name: "Running sessions",
    });
    const sessionRow = await within(runningGroup).findByRole("button", {
      name: /Viewed session issue/i,
    });

    expect(
      within(sessionRow).getByLabelText("Session 状态：运行中"),
    ).toHaveClass("agents-session-row__status-dot--running");

    await user.click(sessionRow);

    expect(
      within(sessionRow).getByLabelText("Session 状态：已查看"),
    ).toHaveClass("agents-session-row__status-dot--viewed");
    expect(setAgentSessionAttentionMock).not.toHaveBeenCalled();
  });

  it("returns a viewed session row to green after new session activity arrives", async () => {
    vi.useFakeTimers();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            issueId: 21,
            issueTitle: "Viewed polling issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            issueId: 21,
            issueTitle: "Viewed polling issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_002_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
          },
        ],
      });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    await act(async () => {
      await Promise.resolve();
    });

    const runningGroup = screen.getByRole("region", {
      name: "Running sessions",
    });
    const sessionRow = within(runningGroup).getByRole("button", {
      name: /Viewed polling issue/i,
    });

    fireEvent.click(sessionRow);
    expect(
      within(sessionRow).getByLabelText("Session 状态：已查看"),
    ).toHaveClass("agents-session-row__status-dot--viewed");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(
      within(sessionRow).getByLabelText("Session 状态：运行中"),
    ).toHaveClass("agents-session-row__status-dot--running");
  });

  it("marks a linked running issue for review from the session header and refreshes sessions", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            issueId: 21,
            issueTitle: "Review candidate",
            issueStatus: "running",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            issueId: 21,
            issueTitle: "Review candidate",
            issueStatus: "review",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_001_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
          },
        ],
      });
    markIssueReviewMock.mockResolvedValue({
      id: 21,
      projectId: 1,
      title: "Review candidate",
      description: "",
      status: "review",
      linkedSessionId: 302,
      linkedSessionStatus: "running",
      linkedSessionAttention: "none",
      createdAt: 1_780_637_000_000,
      updatedAt: 1_780_638_001_000,
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "Review candidate",
      }),
    ).toBeInTheDocument();

    const markReviewButton = screen.getByRole("button", {
      name: "Mark Review",
    });
    await user.click(markReviewButton);

    expect(markIssueReviewMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 21,
    });
    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Mark Review" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Codex Session terminal")).toBeInTheDocument();
  });

  it("hides mark review after command success when refreshing sessions fails", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            issueId: 21,
            issueTitle: "Review candidate",
            issueStatus: "running",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
          },
        ],
      })
      .mockRejectedValueOnce(new Error("refresh failed"));
    markIssueReviewMock.mockResolvedValue({
      id: 21,
      projectId: 1,
      title: "Review candidate",
      description: "",
      status: "review",
      linkedSessionId: 302,
      linkedSessionStatus: "running",
      linkedSessionAttention: "none",
      createdAt: 1_780_637_000_000,
      updatedAt: 1_780_638_001_000,
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    await user.click(
      await screen.findByRole("button", {
        name: "Mark Review",
      }),
    );

    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Mark Review" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
    expect(screen.getByLabelText("Codex Session terminal")).toBeInTheDocument();
  });

  it("keeps mark review hidden when an older polling response returns running after command success", async () => {
    vi.useFakeTimers();
    let resolvePollingResponse:
      | ((response: Awaited<ReturnType<typeof listAgentSessions>>) => void)
      | null = null;
    const pollingResponse = new Promise<
      Awaited<ReturnType<typeof listAgentSessions>>
    >((resolve) => {
      resolvePollingResponse = resolve;
    });
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            issueId: 21,
            issueTitle: "Review candidate",
            issueStatus: "running",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
          },
        ],
      })
      .mockReturnValueOnce(pollingResponse)
      .mockRejectedValueOnce(new Error("refresh failed"));
    markIssueReviewMock.mockResolvedValue({
      id: 21,
      projectId: 1,
      title: "Review candidate",
      description: "",
      status: "review",
      linkedSessionId: 302,
      linkedSessionStatus: "running",
      linkedSessionAttention: "none",
      createdAt: 1_780_637_000_000,
      updatedAt: 1_780_638_001_000,
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByRole("button", { name: "Mark Review" }),
    ).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    expect(listAgentSessionsMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Mark Review" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(listAgentSessionsMock).toHaveBeenCalledTimes(3);
    expect(
      screen.queryByRole("button", { name: "Mark Review" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolvePollingResponse?.({
        sessions: [
          {
            sessionId: 302,
            issueId: 21,
            issueTitle: "Review candidate",
            issueStatus: "running",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_999_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
          },
        ],
      });
    });

    expect(
      screen.queryByRole("button", { name: "Mark Review" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
    expect(screen.getByLabelText("Codex Session terminal")).toBeInTheDocument();
  });

  it("refreshes sessions after mark review command fails without unmounting terminal", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            issueId: 21,
            issueTitle: "Review candidate",
            issueStatus: "running",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            issueId: 21,
            issueTitle: "Review candidate",
            issueStatus: "review",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_001_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
          },
        ],
      });
    markIssueReviewMock.mockRejectedValue(new Error("already review"));

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    await user.click(
      await screen.findByRole("button", {
        name: "Mark Review",
      }),
    );

    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("already review")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark Review" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Codex Session terminal")).toBeInTheDocument();
  });

  it("hides mark review when the selected session has no linked running issue", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 501,
          issueId: null,
          issueTitle: null,
          issueStatus: null,
          title: "Temporary session",
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
        },
        {
          sessionId: 502,
          issueId: 22,
          issueTitle: "Review issue",
          issueStatus: "review",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
        {
          sessionId: 503,
          issueId: 23,
          issueTitle: "Completed issue",
          issueStatus: "completed",
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          lastActiveAt: 1_780_636_000_000,
          startedAt: 1_780_635_000_000,
          closedAt: 1_780_636_500_000,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={501} projectId={1} />);

    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "Temporary session",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark Review" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Codex Session terminal")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Review issue/i }));
    expect(
      await screen.findByRole("heading", { level: 3, name: "Review issue" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark Review" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Completed issue/i }));
    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "Completed issue",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark Review" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the same review session selected with terminal mounted", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 502,
          issueId: 22,
          issueTitle: "Review issue",
          issueStatus: "review",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
        {
          sessionId: 503,
          issueId: 23,
          issueTitle: "Another running issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_636_000_000,
          startedAt: 1_780_636_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={502} projectId={1} />);

    const runningGroup = await screen.findByRole("region", {
      name: "Running sessions",
    });
    expect(
      await screen.findByRole("heading", { level: 3, name: "Review issue" }),
    ).toBeInTheDocument();
    expect(
      within(runningGroup).getByRole("button", { name: /Review issue/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /#issue22.*Review issue/i }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "Mark Review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Complete Manually" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Complete with Agent Commit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Complete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View Summary" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Log" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Codex Session terminal")).toBeInTheDocument();
  });

  it("keeps review header limited to the issue title trigger without placeholder completion actions", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 502,
          issueId: 22,
          issueTitle: "Review issue",
          issueStatus: "review",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={502} projectId={1} />);

    expect(
      await screen.findByRole("heading", { level: 3, name: "Review issue" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /#issue22.*Review issue/i }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "Mark Review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Complete Manually" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Complete with Agent Commit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Complete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View Summary" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Log" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Codex Session terminal")).toBeInTheDocument();
  });

  it("clears requested attention from the selected running session", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            issueId: 21,
            issueTitle: "Manual attention issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "requested",
            lastActiveAt: 1_780_638_000_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 302,
            issueId: 21,
            issueTitle: "Manual attention issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_638_001_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
          },
        ],
      });
    setAgentSessionAttentionMock.mockResolvedValue({
      sessionId: 302,
      attention: "none",
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    const runningGroup = await screen.findByRole("region", {
      name: "Running sessions",
    });
    const attentionRow = within(runningGroup).getByRole("button", {
      name: /Manual attention issue/i,
    });

    expect(
      within(attentionRow).getByLabelText("Session 状态：需要确认"),
    ).toHaveClass("agents-session-row__status-dot--attention");

    await user.click(attentionRow);

    expect(setAgentSessionAttentionMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 302,
      attention: "none",
    });

    await waitFor(() =>
      expect(
        within(attentionRow).getByLabelText("Session 状态：已查看"),
      ).toHaveClass("agents-session-row__status-dot--viewed"),
    );
  });

  it("resizes the session list with the keyboard separator control", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          issueId: 21,
          issueTitle: "Running issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    const separator = await screen.findByRole("separator", {
      name: "Resize session list",
    });

    separator.focus();
    await user.keyboard("{ArrowRight}");
    expect(separator).toHaveAttribute("aria-valuenow", "216");

    await user.keyboard("{ArrowLeft}");
    expect(separator).toHaveAttribute("aria-valuenow", "200");
  });

  it("resizes the session list when dragging the separator", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          issueId: 21,
          issueTitle: "Running issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    const separator = await screen.findByRole("separator", {
      name: "Resize session list",
    });

    fireEvent.mouseDown(separator, { clientX: 200 });
    fireEvent.mouseMove(window, { clientX: 296 });

    expect(separator).toHaveAttribute("aria-valuenow", "296");

    fireEvent.mouseUp(window);
  });

  it("falls back to the first running session when no session is explicitly selected", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          issueId: 21,
          issueTitle: "Newest running issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
        },
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Older running issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={null} projectId={1} />);

    const runningGroup = await screen.findByRole("region", {
      name: "Running sessions",
    });
    expect(
      within(runningGroup).getByRole("button", {
        name: /Newest running issue/i,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /#issue21.*Newest running issue/i }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("falls back to the first completed session when no running session exists", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 402,
          issueId: 23,
          issueTitle: "Newest completed issue",
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          lastActiveAt: 1_780_632_000_000,
          startedAt: 1_780_631_000_000,
          closedAt: 1_780_633_000_000,
        },
        {
          sessionId: 401,
          issueId: 22,
          issueTitle: "Older completed issue",
          title: null,
          agentType: "codex",
          status: "stopped",
          attention: "none",
          lastActiveAt: 1_780_630_000_000,
          startedAt: 1_780_629_000_000,
          closedAt: 1_780_631_000_000,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={null} projectId={1} />);

    const completedGroup = await screen.findByRole("region", {
      name: "Completed sessions",
    });
    expect(
      within(completedGroup).getByRole("button", {
        name: /Newest completed issue/i,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Codex Session terminal")).toBeInTheDocument();
  });

  it("hides the info pane when the selected session has no linked issue", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 501,
          issueId: null,
          issueTitle: null,
          title: "Temporary session",
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={501} projectId={1} />);

    expect(
      await screen.findByRole("button", { name: /Temporary session/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "Resize session info" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Linked issue" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^Issue$/)).not.toBeInTheDocument();
    expect(screen.queryByText("No linked issue")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /#issue/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps completed standalone sessions isolated from linked issue UI", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 601,
          issueId: null,
          issueTitle: null,
          title: "Finished scratch session",
          agentType: "codex",
          status: "closed",
          attention: "none",
          lastActiveAt: 1_780_639_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: 1_780_640_000_000,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={601} projectId={1} />);

    expect(
      await screen.findByRole("button", { name: /Finished scratch session/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "Resize session info" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Linked issue" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^Issue$/)).not.toBeInTheDocument();
    expect(screen.queryByText("No linked issue")).not.toBeInTheDocument();
  });

  it("opens the issue inspector from the session header and can route to issues from inspector actions", async () => {
    const user = userEvent.setup();
    const onOpenIssuesActivity = vi.fn();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
      ],
    });

    render(
      <AgentsActivity
        activeSessionId={301}
        onOpenIssuesActivity={onOpenIssuesActivity}
        projectId={1}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: /#issue20.*Existing issue/i }),
    );

    expect(
      await screen.findByRole("complementary", { name: "Issue Inspector" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Codex Session terminal")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open in Issues" }));

    expect(onOpenIssuesActivity).toHaveBeenCalledTimes(1);
    expect(onOpenIssuesActivity).toHaveBeenNthCalledWith(1, 20);
  });

  it("opens and closes the issue inspector from the splitter toggle", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    const toggle = await screen.findByRole("button", {
      name: "Expand issue inspector",
    });
    const separator = screen.getByRole("separator", {
      name: "Resize session info",
    });

    await user.click(toggle);

    expect(
      await screen.findByRole("complementary", { name: "Issue Inspector" }),
    ).toBeInTheDocument();
    expect(separator).toHaveAttribute("aria-valuenow", "200");
    expect(
      screen.getByRole("button", { name: "Collapse issue inspector" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Collapse issue inspector" }),
    );

    expect(
      screen.queryByRole("complementary", { name: "Issue Inspector" }),
    ).not.toBeInTheDocument();
    expect(separator).toHaveAttribute("aria-valuenow", "0");
  });

  it("resizes the info pane with keyboard and dragging interactions", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    const separator = await screen.findByRole("separator", {
      name: "Resize session info",
    });

    separator.focus();
    await user.keyboard("{ArrowLeft}");
    expect(
      await screen.findByRole("complementary", { name: "Issue Inspector" }),
    ).toBeInTheDocument();
    expect(separator).toHaveAttribute("aria-valuenow", "216");

    await user.keyboard("{ArrowRight}");
    expect(separator).toHaveAttribute("aria-valuenow", "200");

    await user.keyboard("{ArrowRight}");
    expect(separator).toHaveAttribute("aria-valuenow", "0");
    expect(
      screen.queryByRole("complementary", { name: "Issue Inspector" }),
    ).not.toBeInTheDocument();

    fireEvent.mouseDown(separator, { clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 220 });
    expect(separator).toHaveAttribute("aria-valuenow", "200");
    expect(
      screen.getByRole("complementary", { name: "Issue Inspector" }),
    ).toBeInTheDocument();

    fireEvent.mouseUp(window);
  });

  it("saves linked issue edits inside the inspector without unmounting terminal", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await user.click(
      await screen.findByRole("button", { name: /#issue20.*Existing issue/i }),
    );

    const titleInput = await screen.findByLabelText("Issue title");
    await user.clear(titleInput);
    await user.type(titleInput, "Updated issue");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateIssueMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: 20,
        title: "Updated issue",
        description: "Existing description",
      }),
    );
    expect(
      screen.getByRole("button", { name: /#issue20.*Updated issue/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Codex Session terminal")).toBeInTheDocument();
  });

  it("closes the issue inspector with escape and restores focus to the title trigger", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    const trigger = await screen.findByRole("button", {
      name: /#issue20.*Existing issue/i,
    });
    await user.click(trigger);
    await screen.findByRole("complementary", { name: "Issue Inspector" });

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("complementary", { name: "Issue Inspector" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByLabelText("Codex Session terminal")).toBeInTheDocument();
  });

  it("closes the issue inspector when the user clicks the title trigger again", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    const trigger = await screen.findByRole("button", {
      name: /#issue20.*Existing issue/i,
    });
    await user.click(trigger);
    await screen.findByRole("complementary", { name: "Issue Inspector" });

    await user.click(trigger);

    expect(
      screen.queryByRole("complementary", { name: "Issue Inspector" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Codex Session terminal")).toBeInTheDocument();
  });

  it("closes the issue inspector from the close button and outside click without switching session", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    const trigger = await screen.findByRole("button", {
      name: /#issue20.*Existing issue/i,
    });
    await user.click(trigger);
    await screen.findByRole("complementary", { name: "Issue Inspector" });

    await user.click(
      screen.getByRole("button", { name: "Close issue inspector" }),
    );
    expect(
      screen.queryByRole("complementary", { name: "Issue Inspector" }),
    ).not.toBeInTheDocument();

    await user.click(trigger);
    await screen.findByRole("complementary", { name: "Issue Inspector" });
    fireEvent.mouseDown(screen.getByLabelText("Codex Session terminal"));

    expect(
      screen.queryByRole("complementary", { name: "Issue Inspector" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const runningGroup = screen.getByRole("region", {
      name: "Running sessions",
    });
    expect(
      within(runningGroup).getByRole("button", { name: /Existing issue/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Codex Session terminal")).toBeInTheDocument();
  });

  it("shows a factual empty state when no sessions exist", async () => {
    listAgentSessionsMock.mockResolvedValue({ sessions: [] });

    render(<AgentsActivity activeSessionId={null} projectId={1} />);

    await waitFor(() =>
      expect(
        screen.getByText(
          "Agent sessions will appear here after a session has been started for this project.",
        ),
      ).toBeInTheDocument(),
    );
  });
});
