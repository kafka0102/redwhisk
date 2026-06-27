import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../shared/i18n/i18n";
import { listAgentSessions } from "../agent-session-commands";
import type { AgentSessionListItem } from "../agent-session-commands";
import { AgentSessionMonitorButton } from "./agent-session-monitor-button";

vi.mock("../agent-session-commands", () => ({
  listAgentSessions: vi.fn(),
}));

const windowMocks = vi.hoisted(() => ({
  setPosition: vi.fn(),
  setSize: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    setPosition: windowMocks.setPosition,
    setSize: windowMocks.setSize,
  })),
  LogicalPosition: class LogicalPosition {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
  LogicalSize: class LogicalSize {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
  primaryMonitor: vi.fn().mockResolvedValue({
    scaleFactor: 1,
    workArea: {
      position: { x: 0, y: 0 },
      size: { height: 900, width: 1440 },
    },
  }),
}));

const listAgentSessionsMock = vi.mocked(listAgentSessions);

describe("AgentSessionMonitorButton", () => {
  beforeEach(() => {
    windowMocks.setPosition.mockReset();
    windowMocks.setPosition.mockResolvedValue(undefined);
    windowMocks.setSize.mockReset();
    windowMocks.setSize.mockResolvedValue(undefined);
    listAgentSessionsMock.mockReset();
    listAgentSessionsMock.mockResolvedValue({ sessions: [] });
  });

  it("shows every running session on hover", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        session({ sessionId: 1, title: "Closed", status: "closed" }),
        session({ sessionId: 2, title: "Runner B", lastActiveAt: 20 }),
        session({ sessionId: 3, title: "Runner A", lastActiveAt: 30 }),
      ],
    });

    renderButton();
    await user.hover(screen.getByRole("button", { name: "Session monitor" }));

    const list = await screen.findByRole("list", {
      name: "Monitored sessions",
    });
    expect(within(list).getByText("Runner A")).toBeInTheDocument();
    expect(within(list).getByText("Runner B")).toBeInTheDocument();
    expect(within(list).queryByText("Closed")).not.toBeInTheDocument();
  });

  it("keeps only the three most recent sessions when none are running", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [
        session({
          sessionId: 1,
          title: "Old",
          status: "closed",
          lastActiveAt: 10,
        }),
        session({
          sessionId: 2,
          title: "New",
          status: "closed",
          lastActiveAt: 40,
        }),
        session({
          sessionId: 3,
          title: "Middle",
          status: "crashed",
          lastActiveAt: 20,
        }),
        session({
          sessionId: 4,
          title: "Recent",
          status: "stopped",
          lastActiveAt: 30,
        }),
      ],
    });

    renderButton();
    await user.hover(screen.getByRole("button", { name: "Session monitor" }));

    const list = await screen.findByRole("list", {
      name: "Monitored sessions",
    });
    expect(within(list).getByText("New")).toBeInTheDocument();
    expect(within(list).getByText("Recent")).toBeInTheDocument();
    expect(within(list).getByText("Middle")).toBeInTheDocument();
    expect(within(list).queryByText("Old")).not.toBeInTheDocument();
  });

  it("reveals a view action for the selected session", async () => {
    const user = userEvent.setup();
    const onViewSession = vi.fn();
    listAgentSessionsMock.mockResolvedValue({
      sessions: [session({ sessionId: 7, title: "Selected run" })],
    });

    renderButton({ onViewSession });
    await user.hover(screen.getByRole("button", { name: "Session monitor" }));
    await user.click(
      await screen.findByRole("button", { name: /Selected run/ }),
    );
    await user.click(screen.getByRole("button", { name: "View session" }));

    expect(onViewSession).toHaveBeenCalledWith(7);
  });

  it("refreshes sessions while the monitor is open", async () => {
    const user = userEvent.setup();
    listAgentSessionsMock
      .mockResolvedValueOnce({ sessions: [] })
      .mockResolvedValue({ sessions: [session({ title: "Loaded later" })] });

    renderButton();
    await user.hover(screen.getByRole("button", { name: "Session monitor" }));

    await waitFor(() => {
      expect(screen.getByText("Loaded later")).toBeInTheDocument();
    });
  });

  it("resizes the native desktop monitor window when opened", async () => {
    const user = userEvent.setup();

    renderButton({ mode: "desktop" });

    await waitFor(() => {
      expect(windowMocks.setSize).toHaveBeenCalledWith(
        expect.objectContaining({ height: 44, width: 44 }),
      );
    });

    await user.hover(screen.getByRole("button", { name: "Session monitor" }));

    await waitFor(() => {
      expect(windowMocks.setSize).toHaveBeenCalledWith(
        expect.objectContaining({ height: 460, width: 360 }),
      );
      expect(windowMocks.setPosition).toHaveBeenCalledWith(
        expect.objectContaining({ x: 1068, y: 220 }),
      );
    });
  });
});

function renderButton({
  mode,
  onViewSession = vi.fn(),
}: {
  mode?: "in-app" | "desktop";
  onViewSession?: (sessionId: number) => void;
} = {}) {
  return render(
    <I18nProvider>
      <AgentSessionMonitorButton
        mode={mode}
        onViewSession={onViewSession}
        projectId={1}
        refreshIntervalMs={10}
      />
    </I18nProvider>,
  );
}

function session(
  overrides: Partial<AgentSessionListItem> = {},
): AgentSessionListItem {
  return {
    agentType: "codex",
    attention: "none",
    closedAt: null,
    issueId: null,
    issueTitle: null,
    lastActiveAt: 1_780_637_000_000,
    latestOutput: null,
    sessionId: 1,
    startedAt: 1,
    status: "running",
    title: "Session",
    ...overrides,
  };
}
