import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentStreamEventEnvelope } from "../agent-stream-types";
import { I18nProvider } from "../../../shared/i18n/i18n";
import {
  listAgentSessions,
  readAgentTimeline,
} from "../agent-session-commands";
import { useAgentSessionNotifications } from "./use-agent-session-notifications";
import { playNotificationSound } from "../../../shared/audio/notification-sound";
import { NOTIFICATION_REMINDER_STORAGE_KEY } from "../../../shared/i18n/i18n-constants";
import type { AgentSessionNotificationTransport } from "./agent-session-notification-transport";

const mocks = vi.hoisted(() => ({
  listeners: [] as Array<{
    eventName: string;
    callback: (event: { payload: AgentStreamEventEnvelope }) => void;
  }>,
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (
      eventName: string,
      callback: (event: { payload: AgentStreamEventEnvelope }) => void,
    ) => {
      mocks.listeners.push({ eventName, callback });
      return Promise.resolve(mocks.unlisten);
    },
  ),
}));

vi.mock("../agent-session-commands", () => ({
  listAgentSessions: vi.fn(),
  readAgentTimeline: vi.fn(),
}));

vi.mock("../../../shared/audio/notification-sound", () => ({
  playNotificationSound: vi.fn(),
}));

const listAgentSessionsMock = vi.mocked(listAgentSessions);
const readAgentTimelineMock = vi.mocked(readAgentTimeline);
const mockedPlayNotificationSound = vi.mocked(playNotificationSound);

function Probe({
  pollIntervalMs,
  projectId,
  projectName,
  transport,
}: {
  pollIntervalMs?: number;
  projectId: number;
  projectName: string;
  transport: AgentSessionNotificationTransport;
}) {
  useAgentSessionNotifications({
    pollIntervalMs,
    projectId,
    projectName,
    transport,
  });
  return <div data-testid="probe" />;
}

async function renderProbe({
  projectId = 1,
  projectName = "RedWhisk",
  pollIntervalMs,
  transport,
}: {
  projectId?: number;
  projectName?: string;
  pollIntervalMs?: number;
  transport: AgentSessionNotificationTransport;
}) {
  const result = render(
    <I18nProvider>
      <Probe
        pollIntervalMs={pollIntervalMs}
        projectId={projectId}
        projectName={projectName}
        transport={transport}
      />
    </I18nProvider>,
  );

  await act(async () => {
    await Promise.resolve();
  });

  return result;
}

describe("useAgentSessionNotifications", () => {
  beforeEach(() => {
    mocks.listeners.length = 0;
    mocks.unlisten.mockClear();
    listAgentSessionsMock.mockReset();
    readAgentTimelineMock.mockReset();
    listAgentSessionsMock.mockResolvedValue({ sessions: [] });
    readAgentTimelineMock.mockResolvedValue({ items: [], effort: null });
    mockedPlayNotificationSound.mockReset();
    window.localStorage.removeItem(NOTIFICATION_REMINDER_STORAGE_KEY);
  });

  it("shows an in-app notification when the window is focused", async () => {
    const transport = createTransport({ isWindowFocused: true });
    await renderProbe({ transport });

    await emit({
      projectId: 1,
      sessionId: 2,
      seq: 4,
      epoch: "epoch-1",
      event: {
        type: "permission_requested",
        request: {
          id: "req-1",
          kind: "tool",
          title: "Run command",
          actions: [],
        },
      },
    });

    expect(transport.showInAppNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Run command",
        level: "urgent",
        title: "RedWhisk needs your input",
      }),
    );
    expect(transport.sendSystemNotification).not.toHaveBeenCalled();
    expect(transport.requestAttention).not.toHaveBeenCalled();
  });

  it("sends a system notification and requests attention in the background", async () => {
    const transport = createTransport({ isWindowFocused: false });
    await renderProbe({ transport });

    await emit({
      projectId: 1,
      sessionId: 2,
      seq: 5,
      epoch: "epoch-1",
      event: {
        type: "turn_completed",
        turnId: "turn-1",
        usage: null,
      },
    });

    expect(transport.sendSystemNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Session #2 has finished the latest turn.",
        level: "normal",
        title: "RedWhisk session updated",
      }),
    );
    expect(transport.requestAttention).toHaveBeenCalledWith("normal");
    expect(transport.showInAppNotification).not.toHaveBeenCalled();
  });

  it("ignores events from other projects", async () => {
    const transport = createTransport({ isWindowFocused: false });
    await renderProbe({ transport });

    await emit({
      projectId: 99,
      sessionId: 2,
      seq: 6,
      epoch: "epoch-1",
      event: {
        type: "turn_failed",
        turnId: "turn-1",
        error: "Network error",
      },
    });

    expect(transport.sendSystemNotification).not.toHaveBeenCalled();
    expect(transport.showInAppNotification).not.toHaveBeenCalled();
  });

  it("deduplicates the same event envelope", async () => {
    const transport = createTransport({ isWindowFocused: false });
    await renderProbe({ transport });
    const envelope: AgentStreamEventEnvelope = {
      projectId: 1,
      sessionId: 2,
      seq: 7,
      epoch: "epoch-1",
      event: {
        type: "turn_failed",
        turnId: "turn-1",
        error: "Network error",
      },
    };

    await emit(envelope);
    await emit(envelope);

    expect(transport.sendSystemNotification).toHaveBeenCalledTimes(1);
    expect(transport.requestAttention).toHaveBeenCalledTimes(1);
  });

  it("notifies when a running session closes with recent timeline context", async () => {
    const transport = createTransport({ isWindowFocused: false });
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [session({ sessionId: 8, status: "running" })],
      })
      .mockResolvedValue({
        sessions: [session({ sessionId: 8, status: "closed" })],
      });
    readAgentTimelineMock.mockResolvedValue({
      effort: null,
      items: [
        { type: "user_message", text: "Add monitor" },
        { type: "assistant_message", text: "Monitor implementation finished." },
      ],
    });

    await renderProbe({ pollIntervalMs: 10, transport });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    expect(readAgentTimelineMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 8,
    });
    expect(transport.sendSystemNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Monitor implementation finished."),
        durationMs: 300_000,
        level: "normal",
        title: "RedWhisk session completed",
      }),
    );
  });

  it("does not show the long completion summary as an in-app notification when focused", async () => {
    const transport = createTransport({ isWindowFocused: true });
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [session({ sessionId: 8, status: "running" })],
      })
      .mockResolvedValue({
        sessions: [session({ sessionId: 8, status: "closed" })],
      });
    readAgentTimelineMock.mockResolvedValue({
      effort: null,
      items: [
        { type: "user_message", text: "Mark the issue done." },
        {
          type: "assistant_message",
          text: "Summary: finished with status completed and lots of detail.",
        },
      ],
    });

    await renderProbe({ pollIntervalMs: 10, transport });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    expect(readAgentTimelineMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 8,
    });
    expect(transport.showInAppNotification).not.toHaveBeenCalled();
    expect(transport.sendSystemNotification).not.toHaveBeenCalled();
    expect(transport.requestAttention).not.toHaveBeenCalled();
  });

  it("sends an urgent notification when a running session crashes", async () => {
    const transport = createTransport({ isWindowFocused: false });
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [session({ sessionId: 9, status: "running" })],
      })
      .mockResolvedValue({
        sessions: [session({ sessionId: 9, status: "crashed" })],
      });
    readAgentTimelineMock.mockResolvedValue({
      effort: null,
      items: [{ type: "error", message: "Process exited with code 1." }],
    });

    await renderProbe({ pollIntervalMs: 10, transport });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    expect(transport.requestAttention).toHaveBeenCalledWith("urgent");
    expect(transport.sendSystemNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Process exited with code 1."),
        level: "urgent",
        title: "RedWhisk session failed",
      }),
    );
  });

  it("session running->closed 不播放提示音（声音改由 turn 完成触发）", async () => {
    window.localStorage.setItem(NOTIFICATION_REMINDER_STORAGE_KEY, "true");
    const transport = createTransport({ isWindowFocused: true });
    listAgentSessionsMock
      .mockResolvedValueOnce({
        sessions: [session({ sessionId: 8, status: "running" })],
      })
      .mockResolvedValue({
        sessions: [session({ sessionId: 8, status: "closed" })],
      });
    readAgentTimelineMock.mockResolvedValue({ effort: null, items: [] });

    await renderProbe({ pollIntervalMs: 10, transport });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    expect(mockedPlayNotificationSound).not.toHaveBeenCalled();
  });

  it("偏好开启时 turn_completed 播放提示音（不受窗口聚焦门控）", async () => {
    window.localStorage.setItem(NOTIFICATION_REMINDER_STORAGE_KEY, "true");
    const transport = createTransport({ isWindowFocused: true });

    await renderProbe({ transport });

    await emit({
      projectId: 1,
      sessionId: 2,
      seq: 8,
      epoch: "epoch-1",
      event: {
        type: "turn_completed",
        turnId: "turn-1",
        usage: null,
      },
    });

    expect(mockedPlayNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("偏好关闭时 turn_completed 不播放提示音", async () => {
    window.localStorage.setItem(NOTIFICATION_REMINDER_STORAGE_KEY, "false");
    const transport = createTransport({ isWindowFocused: false });

    await renderProbe({ transport });

    await emit({
      projectId: 1,
      sessionId: 2,
      seq: 9,
      epoch: "epoch-1",
      event: {
        type: "turn_completed",
        turnId: "turn-1",
        usage: null,
      },
    });

    expect(mockedPlayNotificationSound).not.toHaveBeenCalled();
  });
});

function createTransport({
  isWindowFocused,
}: {
  isWindowFocused: boolean;
}): AgentSessionNotificationTransport {
  return {
    isWindowFocused: vi.fn().mockResolvedValue(isWindowFocused),
    requestAttention: vi.fn().mockResolvedValue(undefined),
    sendSystemNotification: vi.fn().mockResolvedValue(undefined),
    showInAppNotification: vi.fn(),
  };
}

async function emit(envelope: AgentStreamEventEnvelope): Promise<void> {
  await act(async () => {
    mocks.listeners[0].callback({ payload: envelope });
    await Promise.resolve();
    await Promise.resolve();
  });
}

function session({
  sessionId,
  status,
}: {
  sessionId: number;
  status: "running" | "closed" | "crashed" | "stopped";
}) {
  return {
    agentType: "codex" as const,
    displayMode: "json" as const,
    attention: "none" as const,
    closedAt: status === "running" ? null : 1_780_638_000_000,
    issueId: null,
    issueNumber: null,
    issueTitle: null,
    issueStatus: null,
    projectId: 1,
    agentProfileId: 1,
    agentProfileName: "Test Profile",
    workflowSkillName: null,
    canCompleteClean: false,
    canCompleteAgentCommit: false,
    isTurnRunning: status === "running",
    workspaceMode: "current_branch" as const,
    workingDir: "/tmp/repo",
    workspacePath: null,
    originBranch: null,
    workspaceBranch: null,
    worktreeOwner: "redwhisk" as const,
    logPath: "/tmp/session.log",
    lastActiveAt: 1_780_638_000_000,
    latestOutput: null,
    number: sessionId,
    sessionId,
    startedAt: 1_780_637_000_000,
    status,
    title: `Session ${sessionId}`,
    processingMs: 0,
    lastOutputAt: null,
  };
}
