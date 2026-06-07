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

import { AgentsActivity } from "./agents-activity";
import {
  listAgentSessions,
  readAgentSessionTerminal,
  resizeAgentSessionTerminal,
  setAgentSessionAttention,
  startStandaloneAgentSession,
  writeAgentSessionTerminal,
} from "./agent-session-commands";
import { listAgentProfiles } from "../settings/settings-commands";

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

const listAgentSessionsMock = vi.mocked(listAgentSessions);
const readAgentSessionTerminalMock = vi.mocked(readAgentSessionTerminal);
const resizeAgentSessionTerminalMock = vi.mocked(resizeAgentSessionTerminal);
const setAgentSessionAttentionMock = vi.mocked(setAgentSessionAttention);
const startStandaloneAgentSessionMock = vi.mocked(startStandaloneAgentSession);
const writeAgentSessionTerminalMock = vi.mocked(writeAgentSessionTerminal);
const listAgentProfilesMock = vi.mocked(listAgentProfiles);

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
    ).toHaveAttribute("aria-valuenow", "200");
    expect(
      screen.getByRole("complementary", { name: "Linked issue" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /#issue20.*Existing issue/i }),
    ).toBeDisabled();
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
    const runningGroup = screen.getByRole("region", {
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

  it("shows a completed status dot for completed sessions", async () => {
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
      within(completedRow).getByLabelText("Session 状态：已结束"),
    ).toHaveClass("agents-session-row__status-dot--completed");
    expect(completedRow).not.toHaveTextContent("closed");
    expect(
      screen.queryByRole("button", { name: "标记关注" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "清除关注" }),
    ).not.toBeInTheDocument();
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

  it("marks the selected running session as needing attention and refreshes the workspace action", async () => {
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
            issueTitle: "Manual attention issue",
            title: null,
            agentType: "codex",
            status: "running",
            attention: "requested",
            lastActiveAt: 1_780_638_001_000,
            startedAt: 1_780_638_000_000,
            closedAt: null,
          },
        ],
      });
    setAgentSessionAttentionMock.mockResolvedValue({
      sessionId: 302,
      attention: "requested",
    });

    render(<AgentsActivity activeSessionId={302} projectId={1} />);

    const markButton = await screen.findByRole("button", { name: "标记关注" });
    await user.click(markButton);

    expect(setAgentSessionAttentionMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 302,
      attention: "requested",
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "清除关注" }),
      ).toBeInTheDocument(),
    );

    const runningGroup = screen.getByRole("region", {
      name: "Running sessions",
    });
    const refreshedRow = within(runningGroup).getByRole("button", {
      name: /Manual attention issue/i,
    });
    expect(
      within(refreshedRow).getByLabelText("Session 状态：需要确认"),
    ).toHaveClass("agents-session-row__status-dot--attention");
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

    const clearButton = await screen.findByRole("button", { name: "清除关注" });
    await user.click(clearButton);

    expect(setAgentSessionAttentionMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 302,
      attention: "none",
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "标记关注" }),
      ).toBeInTheDocument(),
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
    ).toBeDisabled();
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

  it("opens the linked issue context through the info pane actions", async () => {
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

    expect(onOpenIssuesActivity).toHaveBeenCalledTimes(1);
    expect(onOpenIssuesActivity).toHaveBeenNthCalledWith(1, 20);
  });

  it("collapses and expands the info pane from the splitter toggle", async () => {
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
      name: "Collapse session info",
    });
    const separator = screen.getByRole("separator", {
      name: "Resize session info",
    });

    await user.click(toggle);

    expect(
      screen.queryByRole("complementary", { name: "Linked issue" }),
    ).not.toBeInTheDocument();
    expect(separator).toHaveAttribute("aria-valuenow", "0");
    expect(
      screen.getByRole("button", { name: "Expand session info" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Expand session info" }),
    );

    expect(
      screen.getByRole("complementary", { name: "Linked issue" }),
    ).toBeInTheDocument();
    expect(separator).toHaveAttribute("aria-valuenow", "200");
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
    expect(separator).toHaveAttribute("aria-valuenow", "216");

    await user.keyboard("{ArrowRight}");
    expect(separator).toHaveAttribute("aria-valuenow", "200");

    await user.keyboard("{ArrowRight}");
    expect(separator).toHaveAttribute("aria-valuenow", "0");
    expect(
      screen.queryByRole("complementary", { name: "Linked issue" }),
    ).not.toBeInTheDocument();

    fireEvent.mouseDown(separator, { clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 220 });
    expect(separator).toHaveAttribute("aria-valuenow", "200");
    expect(
      screen.getByRole("complementary", { name: "Linked issue" }),
    ).toBeInTheDocument();

    fireEvent.mouseUp(window);
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
