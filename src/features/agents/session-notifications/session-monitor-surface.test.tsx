import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { openMonitoredAgentSession } from "./session-monitor-commands";
import { SessionMonitorSurface } from "./session-monitor-surface";

vi.mock("./session-monitor-commands", () => ({
  openMonitoredAgentSession: vi.fn(),
}));

vi.mock("./agent-session-monitor-button", () => ({
  AgentSessionMonitorButton: ({
    onViewSession,
  }: {
    onViewSession: (sessionId: number, projectId: number) => void;
  }) => (
    <button type="button" onClick={() => onViewSession(7, 3)}>
      view monitored session
    </button>
  ),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    setPosition: vi.fn().mockResolvedValue(undefined),
    setSize: vi.fn().mockResolvedValue(undefined),
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
  primaryMonitor: vi.fn().mockResolvedValue(null),
}));

const openMonitoredAgentSessionMock = vi.mocked(openMonitoredAgentSession);

describe("SessionMonitorSurface", () => {
  beforeEach(() => {
    document.body.className = "";
    openMonitoredAgentSessionMock.mockReset();
    openMonitoredAgentSessionMock.mockResolvedValue({
      emitted: true,
      windowLabel: "main",
    });
  });

  it("opens the monitored session through the native desktop command", async () => {
    const user = userEvent.setup();

    render(<SessionMonitorSurface ownerWindowLabel="main" />);

    expect(document.body).toHaveClass("session-monitor-window");

    await user.click(
      screen.getByRole("button", { name: "view monitored session" }),
    );

    expect(openMonitoredAgentSessionMock).toHaveBeenCalledWith({
      ownerWindowLabel: "main",
      projectId: 3,
      sessionId: 7,
    });
  });
});
