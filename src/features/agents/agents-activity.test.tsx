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
  completeIssueClean,
  completeIssueManual,
  detectAgentCommitCompletion,
  getIssueSummary,
  listIssues,
  markIssueReview,
  prepareAgentCommitCompletion,
  sendAgentCommitPrompt,
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
  completeIssueManual: vi.fn(),
  completeIssueClean: vi.fn(),
  detectAgentCommitCompletion: vi.fn(),
  getIssueSummary: vi.fn(),
  listIssues: vi.fn(),
  markIssueReview: vi.fn(),
  prepareAgentCommitCompletion: vi.fn(),
  sendAgentCommitPrompt: vi.fn(),
  updateIssue: vi.fn(),
}));

const listAgentSessionsMock = vi.mocked(listAgentSessions);
const readAgentSessionTerminalMock = vi.mocked(readAgentSessionTerminal);
const resizeAgentSessionTerminalMock = vi.mocked(resizeAgentSessionTerminal);
const setAgentSessionAttentionMock = vi.mocked(setAgentSessionAttention);
const startStandaloneAgentSessionMock = vi.mocked(startStandaloneAgentSession);
const writeAgentSessionTerminalMock = vi.mocked(writeAgentSessionTerminal);
const listAgentProfilesMock = vi.mocked(listAgentProfiles);
const completeIssueCleanMock = vi.mocked(completeIssueClean);
const completeIssueManualMock = vi.mocked(completeIssueManual);
const detectAgentCommitCompletionMock = vi.mocked(detectAgentCommitCompletion);
const getIssueSummaryMock = vi.mocked(getIssueSummary);
const listIssuesMock = vi.mocked(listIssues);
const markIssueReviewMock = vi.mocked(markIssueReview);
const prepareAgentCommitCompletionMock = vi.mocked(
  prepareAgentCommitCompletion,
);
const sendAgentCommitPromptMock = vi.mocked(sendAgentCommitPrompt);
const updateIssueMock = vi.mocked(updateIssue);
const openPathMock = vi.mocked(openPath);
const confirmSpy = vi.spyOn(window, "confirm");

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
    completeIssueManualMock.mockReset();
    completeIssueCleanMock.mockReset();
    detectAgentCommitCompletionMock.mockReset();
    getIssueSummaryMock.mockReset();
    prepareAgentCommitCompletionMock.mockReset();
    sendAgentCommitPromptMock.mockReset();
    markIssueReviewMock.mockReset();
    updateIssueMock.mockReset();
    openPathMock.mockReset();
    confirmSpy.mockReset();
    confirmSpy.mockReturnValue(true);
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
    sendAgentCommitPromptMock.mockResolvedValue({
      issueId: 22,
      sessionId: 502,
      codexSessionId: "019d8b4d-2998-7913-889d-fb3c32971610",
    });
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
    completeIssueManualMock.mockResolvedValue({
      id: 22,
      projectId: 1,
      title: "Review issue",
      description: "Review description",
      status: "completed",
      linkedSessionId: 502,
      linkedSessionStatus: "closed",
      linkedSessionAttention: "none",
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_639_000_000,
    });
    completeIssueCleanMock.mockResolvedValue({
      id: 22,
      projectId: 1,
      title: "Review issue",
      description: "Review description",
      status: "completed",
      linkedSessionId: 502,
      linkedSessionStatus: "closed",
      linkedSessionAttention: "none",
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_639_000_000,
    });
    detectAgentCommitCompletionMock.mockResolvedValue({
      outcome: "completed",
      issue: {
        id: 22,
        projectId: 1,
        title: "Review issue",
        description: "Review description",
        status: "completed",
        linkedSessionId: 502,
        linkedSessionStatus: "closed",
        linkedSessionAttention: "none",
        linkedSessionLogPath: "/tmp/session.log",
        createdAt: 1_780_632_000_000,
        updatedAt: 1_780_639_000_000,
      },
      message: "已检测到新的 commit，Issue 已完成。",
    });
    getIssueSummaryMock.mockResolvedValue({
      issue: {
        id: 23,
        projectId: 1,
        title: "Newest completed issue",
        description: "Completed description",
        status: "completed",
        linkedSessionId: 601,
        linkedSessionStatus: "closed",
        linkedSessionAttention: "none",
        linkedSessionLogPath: "/tmp/completed.log",
        createdAt: 1_780_632_000_000,
        updatedAt: 1_780_639_000_000,
      },
      sessionStartedAt: 1_780_638_000_000,
      sessionClosedAt: 1_780_639_000_000,
      completion: {
        option: "agent_auto_commit",
        result: "completed",
        commitHash: "abc1234",
        failureReason: null,
        headBefore: "1111111",
        headAfter: "abc1234",
        changedFilesJson: "[]",
        createdAt: 1_780_639_000_000,
        source: "completion_attempt",
      },
      diagnostics: [],
    });
    prepareAgentCommitCompletionMock.mockResolvedValue({
      issueId: 22,
      sessionId: 502,
      option: "complete_agent_commit",
      head: "4157f0c",
      changedFilesCount: 2,
      changedFiles: [
        { status: " M", path: "src/features/agents/agents-activity.tsx" },
        { status: " M", path: "src-tauri/src/core/issue_service.rs" },
      ],
      completionPrompt: "请仅处理当前 Issue 相关改动，并在确认无误后提交。",
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
          latestOutput: "Running pnpm test -- --run agents-activity.test.tsx",
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

    render(
      <AgentsActivity
        activeSessionId={301}
        projectCompletionPolicy="manual"
        projectId={1}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Agents" }),
    ).toBeInTheDocument();

    const runningGroup = await screen.findByRole("region", {
      name: "In Progress sessions",
    });
    const completedGroup = screen.getByRole("region", {
      name: "Done sessions",
    });
    const reviewGroup = screen.getByRole("region", {
      name: "Review sessions",
    });

    expect(within(runningGroup).getByText("In Progress")).toBeInTheDocument();
    expect(within(runningGroup).getByText("(2)")).toBeInTheDocument();
    expect(
      within(reviewGroup).getByRole("button", {
        name: "Collapse Review sessions",
      }),
    ).toBeInTheDocument();
    expect(within(reviewGroup).getByText("(0)")).toBeInTheDocument();
    expect(
      within(completedGroup).getByRole("button", {
        name: "Expand Done sessions",
      }),
    ).toBeInTheDocument();
    expect(within(completedGroup).getByText("(1)")).toBeInTheDocument();
    expect(
      within(runningGroup).getByRole("button", { name: /Existing issue/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(runningGroup).getByText(
        "Running pnpm test -- --run agents-activity.test.tsx",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Linked Issue")).not.toBeInTheDocument();
    expect(screen.queryByText("Selected Session")).not.toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: "Resize session list" }),
    ).toHaveAttribute("aria-valuenow", "230");
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

    render(
      <AgentsActivity
        activeSessionId={301}
        projectCompletionPolicy="manual"
        projectId={1}
      />,
    );

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
      name: "In Progress sessions",
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

  it("groups sessions by linked issue status without rendering backlog", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 302,
          issueId: 21,
          issueTitle: "Running issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_638_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
        },
        {
          sessionId: 303,
          issueId: 25,
          issueTitle: "Review issue",
          issueStatus: "review",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_636_000_000,
          startedAt: 1_780_636_000_000,
          closedAt: null,
        },
        {
          sessionId: 401,
          issueId: 22,
          issueTitle: "Closed issue",
          issueStatus: "completed",
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
          issueStatus: "running",
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
          issueStatus: "review",
          title: null,
          agentType: "codex",
          status: "stopped",
          attention: "none",
          lastActiveAt: 1_780_634_000_000,
          startedAt: 1_780_633_000_000,
          closedAt: 1_780_635_000_000,
        },
        {
          sessionId: 404,
          issueId: 26,
          issueTitle: "Backlog issue",
          issueStatus: "backlog",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_635_000_000,
          startedAt: 1_780_635_000_000,
          closedAt: null,
        },
        {
          sessionId: 405,
          issueId: null,
          issueTitle: null,
          issueStatus: null,
          title: "Finished scratch session",
          agentType: "codex",
          status: "closed",
          attention: "none",
          lastActiveAt: 1_780_636_000_000,
          startedAt: 1_780_635_000_000,
          closedAt: 1_780_636_500_000,
        },
      ],
    });

    render(
      <AgentsActivity
        activeSessionId={302}
        projectCompletionPolicy="manual"
        projectId={1}
      />,
    );

    const inProcessGroup = await screen.findByRole("region", {
      name: "In Progress sessions",
    });
    const reviewGroup = screen.getByRole("region", {
      name: "Review sessions",
    });
    const completedGroup = screen.getByRole("region", {
      name: "Done sessions",
    });

    expect(within(inProcessGroup).getByText("In Progress")).toBeInTheDocument();
    expect(within(inProcessGroup).getByText("(2)")).toBeInTheDocument();
    expect(
      within(reviewGroup).getByRole("button", {
        name: "Collapse Review sessions",
      }),
    ).toBeInTheDocument();
    expect(within(reviewGroup).getByText("(2)")).toBeInTheDocument();
    expect(
      within(completedGroup).getByRole("button", {
        name: "Expand Done sessions",
      }),
    ).toBeInTheDocument();
    expect(within(completedGroup).getByText("(2)")).toBeInTheDocument();
    fireEvent.click(
      within(completedGroup).getByRole("button", {
        name: "Expand Done sessions",
      }),
    );
    expect(
      within(inProcessGroup).getByRole("button", { name: /Running issue/i }),
    ).toBeInTheDocument();
    expect(
      within(inProcessGroup).getByRole("button", { name: /Crashed issue/i }),
    ).toBeInTheDocument();
    expect(
      within(reviewGroup).getByRole("button", { name: /Review issue/i }),
    ).toBeInTheDocument();
    expect(
      within(reviewGroup).getByRole("button", { name: /Stopped issue/i }),
    ).toBeInTheDocument();
    expect(
      within(completedGroup).getByRole("button", { name: /Closed issue/i }),
    ).toBeInTheDocument();
    expect(
      within(completedGroup).getByRole("button", {
        name: /Finished scratch session/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Backlog issue/i }),
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

    render(
      <AgentsActivity
        activeSessionId={301}
        projectCompletionPolicy="manual"
        projectId={1}
      />,
    );

    const runningGroup = await screen.findByRole("region", {
      name: "In Progress sessions",
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
        {
          sessionId: 304,
          issueId: 23,
          issueTitle: "Selected issue",
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

    render(
      <AgentsActivity
        activeSessionId={304}
        projectCompletionPolicy="manual"
        projectId={1}
      />,
    );

    const runningGroup = await screen.findByRole("region", {
      name: "In Progress sessions",
    });
    const attentionRow = within(runningGroup).getByRole("button", {
      name: /Needs attention issue/i,
    });
    const quietRow = within(runningGroup).getByRole("button", {
      name: /Quiet issue/i,
    });

    expect(
      within(attentionRow).getByLabelText("Session 状态：输出完成"),
    ).toHaveClass("agents-session-row__status-dot--completed");
    expect(within(quietRow).getByLabelText("Session 状态：运行中")).toHaveClass(
      "agents-session-row__status-dot--running",
    );
    expect(attentionRow).not.toHaveTextContent("running");
    expect(quietRow).not.toHaveTextContent("running");
  });

  it("shows a gray output status dot for completed sessions", async () => {
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
      name: "Done sessions",
    });
    fireEvent.click(
      within(completedGroup).getByRole("button", {
        name: "Expand Done sessions",
      }),
    );
    const completedRow = within(completedGroup).getByRole("button", {
      name: /Closed issue/i,
    });

    expect(
      within(completedRow).getByLabelText("Session 状态：closed"),
    ).toHaveClass("agents-session-row__status-dot--done");
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

    const runningGroup = await screen.findByRole("region", {
      name: "In Progress sessions",
    });
    const crashedRow = within(runningGroup).getByRole("button", {
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

  it("shows stopped status and opens the session log from the header", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 403,
          issueId: 24,
          issueTitle: "Stopped issue",
          issueStatus: "running",
          title: null,
          agentType: "codex",
          status: "stopped",
          attention: "none",
          logPath: "/tmp/stopped.log",
          lastActiveAt: 1_780_633_000_000,
          startedAt: 1_780_632_000_000,
          closedAt: 1_780_634_000_000,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={403} projectId={1} />);

    const runningGroup = await screen.findByRole("region", {
      name: "In Progress sessions",
    });
    const stoppedRow = within(runningGroup).getByRole("button", {
      name: /Stopped issue/i,
    });

    expect(stoppedRow).toHaveTextContent("stopped");
    expect(await screen.findByText("Status: stopped")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Log" }));

    expect(openPathMock).toHaveBeenCalledWith("/tmp/stopped.log");
    expect(
      screen.queryByRole("button", { name: "Open Session" }),
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
          {
            sessionId: 303,
            issueId: 22,
            issueTitle: "Selected polling issue",
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
          {
            sessionId: 303,
            issueId: 22,
            issueTitle: "Selected polling issue",
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

    render(<AgentsActivity activeSessionId={303} projectId={1} />);

    await act(async () => {
      await Promise.resolve();
    });
    const runningGroup = screen.getByRole("region", {
      name: "In Progress sessions",
    });
    const initialRow = within(runningGroup).getByRole("button", {
      name: /Session 正在运行Polling issue/i,
    });
    expect(
      within(initialRow).getByLabelText("Session 状态：运行中"),
    ).toHaveClass("agents-session-row__status-dot--running");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    const refreshedRow = within(runningGroup).getByRole("button", {
      name: /Session 正在运行Polling issue/i,
    });
    expect(
      within(refreshedRow).getByLabelText("Session 状态：输出完成"),
    ).toHaveClass("agents-session-row__status-dot--completed");
  });

  it("turns a running session blue after the user clicks it", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 303,
          issueId: 22,
          issueTitle: "Initially selected issue",
          title: null,
          agentType: "codex",
          status: "running",
          attention: "none",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: null,
        },
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

    render(<AgentsActivity activeSessionId={303} projectId={1} />);

    const runningGroup = await screen.findByRole("region", {
      name: "In Progress sessions",
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

  it("keeps the current session row blue after new session activity arrives", async () => {
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
      name: "In Progress sessions",
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
      within(sessionRow).getByLabelText("Session 状态：已查看"),
    ).toHaveClass("agents-session-row__status-dot--viewed");
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

    const completedGroup = screen.getByRole("region", {
      name: "Done sessions",
    });
    await user.click(
      within(completedGroup).getByRole("button", {
        name: "Expand Done sessions",
      }),
    );
    await user.click(
      within(completedGroup).getByRole("button", { name: /Completed issue/i }),
    );
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

    const reviewGroup = await screen.findByRole("region", {
      name: "Review sessions",
    });
    expect(
      await screen.findByRole("heading", { level: 3, name: "Review issue" }),
    ).toBeInTheDocument();
    expect(
      within(reviewGroup).getByRole("button", { name: /Review issue/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /#issue22.*Review issue/i }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "Mark Review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Complete Manually" }),
    ).toBeInTheDocument();
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

  it("shows the manual completion action on review header without placeholder follow-up actions", async () => {
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
      screen.getByRole("button", { name: "Complete Manually" }),
    ).toBeInTheDocument();
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

  it("shows agent commit action for dirty review sessions and opens completion confirmation", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 502,
          issueId: 22,
          issueTitle: "Review issue",
          issueStatus: "review",
          canCompleteClean: false,
          canCompleteAgentCommit: true,
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
        activeSessionId={502}
        projectCompletionPolicy="agent_auto_commit"
        projectId={1}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Complete with Agent Commit" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Complete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Complete Manually" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Complete with Agent Commit" }),
    );

    expect(prepareAgentCommitCompletionMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 22,
    });

    const dialog = await screen.findByRole("dialog", {
      name: "Completion Confirmation",
    });
    expect(within(dialog).getByText("HEAD: 4157f0c")).toBeInTheDocument();
    expect(within(dialog).getByText("Changed files: 2")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Completion option: complete_agent_commit"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "请仅处理当前 Issue 相关改动，并在确认无误后提交。",
      ),
    ).not.toBeVisible();

    await user.click(within(dialog).getByText("Completion prompt"));
    expect(
      within(dialog).getByText(
        "请仅处理当前 Issue 相关改动，并在确认无误后提交。",
      ),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Completion Confirmation" }),
      ).not.toBeInTheDocument(),
    );
    expect(completeIssueCleanMock).not.toHaveBeenCalled();
  });

  it("keeps the review session active when agent commit detection does not complete", async () => {
    const user = userEvent.setup();
    detectAgentCommitCompletionMock.mockResolvedValueOnce({
      outcome: "no_commit_detected",
      issue: {
        id: 22,
        projectId: 1,
        title: "Review issue",
        description: "Review description",
        status: "review",
        linkedSessionId: 502,
        linkedSessionStatus: "running",
        linkedSessionAttention: "none",
        linkedSessionLogPath: "/tmp/session.log",
        createdAt: 1_780_632_000_000,
        updatedAt: 1_780_639_000_000,
      },
      message: "尚未检测到新的 commit，Issue 保持待验收。",
    });
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 502,
            issueId: 22,
            issueTitle: "Review issue",
            issueStatus: "review",
            canCompleteClean: false,
            canCompleteAgentCommit: true,
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
            sessionId: 502,
            issueId: 22,
            issueTitle: "Review issue",
            issueStatus: "review",
            canCompleteClean: false,
            canCompleteAgentCommit: true,
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_100_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
          },
        ],
      });

    render(
      <AgentsActivity
        activeSessionId={502}
        projectCompletionPolicy="agent_auto_commit"
        projectId={1}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Complete with Agent Commit" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Completion Confirmation",
    });
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(sendAgentCommitPromptMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 22,
    });
    expect(detectAgentCommitCompletionMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 22,
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Completion Confirmation" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Complete with Agent Commit" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("尚未检测到新的 commit，Issue 保持待验收。"),
    ).toBeInTheDocument();
  });

  it("keeps the review session active when agent commit is blocked by git operation", async () => {
    const user = userEvent.setup();
    detectAgentCommitCompletionMock.mockResolvedValueOnce({
      outcome: "git_operation_blocked",
      issue: {
        id: 22,
        projectId: 1,
        title: "Review issue",
        description: "Review description",
        status: "review",
        linkedSessionId: 502,
        linkedSessionStatus: "running",
        linkedSessionAttention: "none",
        linkedSessionLogPath: "/tmp/session.log",
        createdAt: 1_780_632_000_000,
        updatedAt: 1_780_639_000_000,
      },
      message:
        "当前 Git 正在进行中的操作阻止 Agent Commit 完成，请先手动处理 Git 状态。",
    });
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 502,
            issueId: 22,
            issueTitle: "Review issue",
            issueStatus: "review",
            canCompleteClean: false,
            canCompleteAgentCommit: true,
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
            sessionId: 502,
            issueId: 22,
            issueTitle: "Review issue",
            issueStatus: "review",
            canCompleteClean: false,
            canCompleteAgentCommit: true,
            title: null,
            agentType: "codex",
            status: "running",
            attention: "none",
            lastActiveAt: 1_780_637_100_000,
            startedAt: 1_780_637_000_000,
            closedAt: null,
          },
        ],
      });

    render(
      <AgentsActivity
        activeSessionId={502}
        projectCompletionPolicy="agent_auto_commit"
        projectId={1}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Complete with Agent Commit" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Completion Confirmation",
    });
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Completion Confirmation" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Complete with Agent Commit" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "当前 Git 正在进行中的操作阻止 Agent Commit 完成，请先手动处理 Git 状态。",
      ),
    ).toBeInTheDocument();
  });

  it("shows explicit blocker message when clean completion is rejected", async () => {
    const user = userEvent.setup();
    completeIssueCleanMock.mockRejectedValueOnce({
      code: "ISSUE_VALIDATION_FAILED",
      message: "当前 Git 正在进行中的操作阻止直接完成。",
    });
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 502,
          issueId: 22,
          issueTitle: "Review issue",
          issueStatus: "review",
          canCompleteClean: true,
          canCompleteAgentCommit: false,
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
    confirmSpy.mockReturnValueOnce(true);

    render(
      <AgentsActivity
        activeSessionId={502}
        projectCompletionPolicy="agent_auto_commit"
        projectId={1}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Complete" }));

    expect(
      await screen.findByText("当前 Git 正在进行中的操作阻止直接完成。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Complete" }),
    ).toBeInTheDocument();
  });

  it("detects agent commit completion after sending prompt and hides completion actions", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 502,
            issueId: 22,
            issueTitle: "Review issue",
            issueStatus: "review",
            canCompleteClean: false,
            canCompleteAgentCommit: true,
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
            sessionId: 502,
            issueId: 22,
            issueTitle: "Review issue",
            issueStatus: "completed",
            canCompleteClean: false,
            canCompleteAgentCommit: false,
            title: null,
            agentType: "codex",
            status: "closed",
            attention: "none",
            lastActiveAt: 1_780_639_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: 1_780_639_000_000,
          },
        ],
      });

    render(
      <AgentsActivity
        activeSessionId={502}
        projectCompletionPolicy="agent_auto_commit"
        projectId={1}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Complete with Agent Commit" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Completion Confirmation",
    });
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(sendAgentCommitPromptMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: 22,
      }),
    );
    await waitFor(() =>
      expect(detectAgentCommitCompletionMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: 22,
      }),
    );
    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Complete with Agent Commit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Complete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Complete Manually" }),
    ).not.toBeInTheDocument();
  });

  it("completes a linked review issue manually from the session header and refreshes sessions", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 502,
            issueId: 22,
            issueTitle: "Review issue",
            issueStatus: "completed",
            title: null,
            agentType: "codex",
            status: "closed",
            attention: "none",
            lastActiveAt: 1_780_639_000_000,
            startedAt: 1_780_637_000_000,
            closedAt: 1_780_639_000_000,
          },
        ],
      });

    render(<AgentsActivity activeSessionId={502} projectId={1} />);

    expect(
      await screen.findByRole("button", { name: "Complete Manually" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Complete Manually" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "确认手动完成 #issue22 Review issue 吗？",
    );
    expect(completeIssueManualMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 22,
    });
    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Complete Manually" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark Review" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Codex Session terminal")).toBeInTheDocument();
  });

  it("keeps complete manually hidden after command success when refreshing sessions fails", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({
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
      })
      .mockRejectedValueOnce(new Error("refresh failed"));

    render(<AgentsActivity activeSessionId={502} projectId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "Complete Manually" }),
    );

    await waitFor(() => expect(listAgentSessionsMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Complete Manually" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
    expect(screen.getByLabelText("Codex Session terminal")).toBeInTheDocument();
  });

  it("does not complete manually when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    confirmSpy.mockReturnValue(false);
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

    await user.click(
      await screen.findByRole("button", { name: "Complete Manually" }),
    );

    expect(confirmSpy).toHaveBeenCalledWith(
      "确认手动完成 #issue22 Review issue 吗？",
    );
    expect(completeIssueManualMock).not.toHaveBeenCalled();
    expect(listAgentSessionsMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Complete Manually" }),
    ).toBeInTheDocument();
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
      name: "In Progress sessions",
    });
    const attentionRow = within(runningGroup).getByRole("button", {
      name: /Manual attention issue/i,
    });

    expect(
      within(attentionRow).getByLabelText("Session 状态：输出完成"),
    ).toHaveClass("agents-session-row__status-dot--viewed");

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
    expect(separator).toHaveAttribute("aria-valuenow", "246");

    await user.keyboard("{ArrowLeft}");
    expect(separator).toHaveAttribute("aria-valuenow", "230");
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

    expect(separator).toHaveAttribute("aria-valuenow", "326");

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
      name: "In Progress sessions",
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
      name: "Done sessions",
    });
    fireEvent.click(
      within(completedGroup).getByRole("button", {
        name: "Expand Done sessions",
      }),
    );
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

    const completedGroup = await screen.findByRole("region", {
      name: "Done sessions",
    });
    fireEvent.click(
      within(completedGroup).getByRole("button", {
        name: "Expand Done sessions",
      }),
    );
    expect(
      within(completedGroup).getByRole("button", {
        name: /Finished scratch session/i,
      }),
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

  it("opens the linked session log from the inspector for abnormal sessions", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "stopped",
          attention: "none",
          logPath: "/tmp/stopped.log",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: 1_780_638_000_000,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await user.click(
      await screen.findByRole("button", { name: /#issue20.*Existing issue/i }),
    );

    const inspector = await screen.findByRole("complementary", {
      name: "Issue Inspector",
    });
    await user.click(
      within(inspector).getByRole("button", { name: "Open Log" }),
    );

    expect(openPathMock).toHaveBeenCalledWith("/tmp/stopped.log");
  });

  it("surfaces inspector open log failures for abnormal sessions", async () => {
    const user = userEvent.setup();
    openPathMock.mockRejectedValueOnce(new Error("log unavailable"));
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 301,
          issueId: 20,
          issueTitle: "Existing issue",
          title: null,
          agentType: "codex",
          status: "crashed",
          attention: "none",
          logPath: "/tmp/crashed.log",
          lastActiveAt: 1_780_637_000_000,
          startedAt: 1_780_637_000_000,
          closedAt: 1_780_638_000_000,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={301} projectId={1} />);

    await user.click(
      await screen.findByRole("button", { name: /#issue20.*Existing issue/i }),
    );

    const inspector = await screen.findByRole("complementary", {
      name: "Issue Inspector",
    });
    await user.click(
      within(inspector).getByRole("button", { name: "Open Log" }),
    );

    expect(
      await within(inspector).findByText("log unavailable"),
    ).toBeInTheDocument();
  });

  it("opens completed issue summary from the header for closed completed sessions", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 601,
          issueId: 23,
          issueTitle: "Newest completed issue",
          issueStatus: "completed",
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          logPath: "/tmp/completed.log",
          lastActiveAt: 1_780_639_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: 1_780_639_000_000,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={601} projectId={1} />);

    expect(
      await screen.findByRole("button", { name: "Open Log" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Log" }));
    expect(openPathMock).toHaveBeenCalledWith("/tmp/completed.log");

    expect(
      screen.getByRole("button", { name: "View Summary" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View Summary" }));

    const dialog = await screen.findByRole("dialog", { name: "Issue Summary" });
    expect(
      within(dialog).getByText("Commit hash: abc1234"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Log path: /tmp/completed.log"),
    ).toBeInTheDocument();
  });

  it("opens completed issue summary from the header for stopped completed sessions", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 601,
          issueId: 23,
          issueTitle: "Newest completed issue",
          issueStatus: "completed",
          title: null,
          agentType: "codex",
          status: "stopped",
          attention: "none",
          logPath: "/tmp/completed.log",
          lastActiveAt: 1_780_639_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: null,
        },
      ],
    });
    getIssueSummaryMock.mockResolvedValueOnce({
      issue: {
        id: 23,
        projectId: 1,
        title: "Newest completed issue",
        description: "Completed description",
        status: "completed",
        linkedSessionId: 601,
        linkedSessionStatus: "stopped",
        linkedSessionAttention: "none",
        linkedSessionLogPath: "/tmp/completed.log",
        createdAt: 1_780_632_000_000,
        updatedAt: 1_780_639_000_000,
      },
      sessionStartedAt: 1_780_638_000_000,
      sessionClosedAt: null,
      completion: {
        option: "complete_manual",
        result: "completed",
        commitHash: null,
        failureReason: null,
        headBefore: null,
        headAfter: null,
        changedFilesJson: null,
        createdAt: 1_780_639_000_000,
        source: "issue_action_fallback",
      },
      diagnostics: [
        "已完成 Issue 关联的 Session 状态异常：stopped。",
        "已完成 Issue 关联的 Session 缺少 closed_at。",
      ],
    });

    render(<AgentsActivity activeSessionId={601} projectId={1} />);

    expect(
      await screen.findByRole("button", { name: "View Summary" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View Summary" }));

    const dialog = await screen.findByRole("dialog", { name: "Issue Summary" });
    expect(
      within(dialog).getByText(
        "已完成 Issue 关联的 Session 状态异常：stopped。",
      ),
    ).toBeInTheDocument();
  });

  it("shows a factual error when completed header log path is missing", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 601,
          issueId: 23,
          issueTitle: "Newest completed issue",
          issueStatus: "completed",
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          logPath: null,
          lastActiveAt: 1_780_639_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: 1_780_639_000_000,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={601} projectId={1} />);

    await user.click(await screen.findByRole("button", { name: "Open Log" }));

    expect(
      await screen.findByText("No log path recorded for this session."),
    ).toBeInTheDocument();
    expect(openPathMock).not.toHaveBeenCalled();
  });

  it("opens completed issue summary from the inspector", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 601,
          issueId: 23,
          issueTitle: "Newest completed issue",
          issueStatus: "completed",
          title: null,
          agentType: "codex",
          status: "closed",
          attention: "none",
          logPath: "/tmp/completed.log",
          lastActiveAt: 1_780_639_000_000,
          startedAt: 1_780_638_000_000,
          closedAt: 1_780_639_000_000,
        },
      ],
    });
    listIssuesMock.mockResolvedValue({
      issues: [
        {
          id: 23,
          projectId: 1,
          title: "Newest completed issue",
          description: "Completed description",
          status: "completed",
          linkedSessionId: 601,
          linkedSessionStatus: "closed",
          linkedSessionAttention: "none",
          linkedSessionLogPath: "/tmp/completed.log",
          createdAt: 1_780_632_000_000,
          updatedAt: 1_780_639_000_000,
        },
      ],
    });

    render(<AgentsActivity activeSessionId={601} projectId={1} />);

    await user.click(
      await screen.findByRole("button", {
        name: /#issue23.*Newest completed issue/i,
      }),
    );

    const inspector = await screen.findByRole("complementary", {
      name: "Issue Inspector",
    });
    await user.click(
      within(inspector).getByRole("button", { name: "Open Log" }),
    );
    expect(openPathMock).toHaveBeenCalledWith("/tmp/completed.log");

    await user.click(
      within(inspector).getByRole("button", { name: "View Summary" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Issue Summary" });
    expect(
      within(dialog).getByText("Commit hash: abc1234"),
    ).toBeInTheDocument();
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
      name: "In Progress sessions",
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
