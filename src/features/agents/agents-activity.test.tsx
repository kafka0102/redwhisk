import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentsActivity } from "./agents-activity";
import { listAgentSessions } from "./agent-session-commands";

vi.mock("./agent-session-commands", () => ({
  listAgentSessions: vi.fn(),
}));

const listAgentSessionsMock = vi.mocked(listAgentSessions);

describe("AgentsActivity", () => {
  beforeEach(() => {
    listAgentSessionsMock.mockReset();
  });

  it("renders running and completed groups and highlights the requested session", async () => {
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

    const runningGroup = await screen.findByRole("region", {
      name: "Running sessions",
    });
    const completedGroup = screen.getByRole("region", {
      name: "Completed sessions",
    });

    expect(
      within(runningGroup).getByRole("button", { name: /Running issue/i }),
    ).toBeInTheDocument();
    expect(
      within(runningGroup).getByRole("button", { name: /Existing issue/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(completedGroup).getByRole("button", { name: /Closed issue/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open in Issues" }),
    ).toBeDisabled();
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

    expect(
      await screen.findByRole("button", { name: "Open in Issues" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Newest running issue/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("hides the linked issue header when the selected session has no issue", async () => {
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
    expect(screen.queryByText("Linked Issue")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open in Issues" }),
    ).not.toBeInTheDocument();
  });

  it("opens the linked issue context through the header action", async () => {
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
      await screen.findByRole("button", { name: "Open in Issues" }),
    );

    expect(onOpenIssuesActivity).toHaveBeenCalledWith(20);
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
