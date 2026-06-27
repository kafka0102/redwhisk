import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentStreamEventEnvelope } from "../agent-stream-types";
import { I18nProvider } from "../../../shared/i18n/i18n";
import { useAgentSessionNotifications } from "./use-agent-session-notifications";
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

function Probe({
  projectId,
  projectName,
  transport,
}: {
  projectId: number;
  projectName: string;
  transport: AgentSessionNotificationTransport;
}) {
  useAgentSessionNotifications({ projectId, projectName, transport });
  return <div data-testid="probe" />;
}

async function renderProbe({
  projectId = 1,
  projectName = "RedWhisk",
  transport,
}: {
  projectId?: number;
  projectName?: string;
  transport: AgentSessionNotificationTransport;
}) {
  const result = render(
    <I18nProvider>
      <Probe
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
