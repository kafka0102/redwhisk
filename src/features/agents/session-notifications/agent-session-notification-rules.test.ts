import { describe, expect, it } from "vitest";

import type { AgentStreamEventEnvelope } from "../agent-stream-types";
import { createAgentSessionNotificationIntent } from "./agent-session-notification-rules";

describe("createAgentSessionNotificationIntent", () => {
  it("creates an urgent notification when a session requests permission", () => {
    const intent = createAgentSessionNotificationIntent(
      eventEnvelope({
        event: {
          type: "permission_requested",
          request: {
            id: "req-1",
            kind: "tool",
            title: "Run command",
            description: "pnpm test",
            actions: [],
          },
        },
      }),
      {
        copy: TEST_COPY,
        projectName: "RedWhisk",
      },
    );

    expect(intent).toEqual({
      body: "Run command",
      key: "agent-session:2:epoch-1:4",
      level: "urgent",
      title: "RedWhisk needs your input",
    });
  });

  it("uses a fallback body when permission request title is missing", () => {
    const intent = createAgentSessionNotificationIntent(
      eventEnvelope({
        event: {
          type: "permission_requested",
          request: {
            id: "req-1",
            kind: "question",
            actions: [],
          },
        },
      }),
      {
        copy: TEST_COPY,
        projectName: "RedWhisk",
      },
    );

    expect(intent?.body).toBe("Agent is waiting for approval or input.");
  });

  it("creates a normal notification when a turn completes", () => {
    const intent = createAgentSessionNotificationIntent(
      eventEnvelope({
        event: {
          type: "turn_completed",
          turnId: "turn-1",
          usage: null,
        },
      }),
      {
        copy: TEST_COPY,
        projectName: "RedWhisk",
      },
    );

    expect(intent).toMatchObject({
      body: "Session #2 has finished the latest turn.",
      level: "normal",
      title: "RedWhisk session updated",
    });
  });

  it("creates an urgent notification when a turn fails", () => {
    const intent = createAgentSessionNotificationIntent(
      eventEnvelope({
        event: {
          type: "turn_failed",
          turnId: "turn-1",
          error: "Network error",
        },
      }),
      {
        copy: TEST_COPY,
        projectName: "RedWhisk",
      },
    );

    expect(intent).toMatchObject({
      body: "Network error",
      level: "urgent",
      title: "RedWhisk session failed",
    });
  });

  it("does not create notifications for noisy stream events", () => {
    const intent = createAgentSessionNotificationIntent(
      eventEnvelope({
        event: {
          type: "usage_updated",
          usage: {
            contextWindowUsedTokens: 100,
          },
        },
      }),
      {
        copy: TEST_COPY,
        projectName: "RedWhisk",
      },
    );

    expect(intent).toBeNull();
  });
});

function eventEnvelope(
  partial: Pick<AgentStreamEventEnvelope, "event">,
): AgentStreamEventEnvelope {
  return {
    epoch: "epoch-1",
    event: partial.event,
    projectId: 1,
    seq: 4,
    sessionId: 2,
  };
}

const TEST_COPY = {
  needsInputTitle: (projectName: string) => `${projectName} needs your input`,
  permissionFallbackBody: "Agent is waiting for approval or input.",
  sessionFailedTitle: (projectName: string) => `${projectName} session failed`,
  sessionUpdatedTitle: (projectName: string) =>
    `${projectName} session updated`,
  turnCompletedBody: (sessionId: number) =>
    `Session #${sessionId} has finished the latest turn.`,
  turnFailedFallbackBody: "The latest agent turn failed.",
};
