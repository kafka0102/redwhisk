import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentsActivity } from "./agents-activity";
import {
  listAgentSessions,
  readAgentSessionTerminal,
  resizeAgentSessionTerminal,
  writeAgentSessionTerminal,
} from "./agent-session-commands";

vi.mock("./agent-session-commands", () => ({
  listAgentSessions: vi.fn(),
  readAgentSessionTerminal: vi.fn(),
  resizeAgentSessionTerminal: vi.fn(),
  writeAgentSessionTerminal: vi.fn(),
}));

const listAgentSessionsMock = vi.mocked(listAgentSessions);
const readAgentSessionTerminalMock = vi.mocked(readAgentSessionTerminal);
const resizeAgentSessionTerminalMock = vi.mocked(resizeAgentSessionTerminal);
const writeAgentSessionTerminalMock = vi.mocked(writeAgentSessionTerminal);

describe("AgentsActivity", () => {
  beforeEach(() => {
    listAgentSessionsMock.mockReset();
    readAgentSessionTerminalMock.mockReset();
    resizeAgentSessionTerminalMock.mockReset();
    writeAgentSessionTerminalMock.mockReset();
    readAgentSessionTerminalMock.mockResolvedValue({
      sessionId: 301,
      snapshot: "",
      isActive: true,
    });
    resizeAgentSessionTerminalMock.mockResolvedValue();
    writeAgentSessionTerminalMock.mockResolvedValue();
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

  it("shows a needs-attention marker on session rows when attention is requested", async () => {
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

    expect(attentionRow).toHaveTextContent("需要确认");
    expect(quietRow).not.toHaveTextContent("需要确认");
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
      screen.queryByRole("complementary", { name: "Session links" }),
    ).not.toBeInTheDocument();
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
