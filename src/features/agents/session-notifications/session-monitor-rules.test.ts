import { describe, expect, it } from "vitest";

import type { AgentSessionListItem } from "../agent-session-commands";
import {
  createAgentSessionStatusNotificationIntent,
  selectSessionMonitorItems,
} from "./session-monitor-rules";

describe("selectSessionMonitorItems", () => {
  it("lists every running session ordered by recent activity", () => {
    const sessions = [
      session({ sessionId: 1, status: "closed", lastActiveAt: 40 }),
      session({ sessionId: 2, status: "running", lastActiveAt: 20 }),
      session({ sessionId: 3, status: "running", lastActiveAt: 50 }),
      session({ sessionId: 4, status: "running", lastActiveAt: 30 }),
    ];

    expect(
      selectSessionMonitorItems(sessions).map((item) => item.sessionId),
    ).toEqual([3, 4, 2]);
  });

  it("keeps only the three most recent sessions when none are running", () => {
    const sessions = [
      session({ sessionId: 1, status: "closed", lastActiveAt: 40 }),
      session({ sessionId: 2, status: "crashed", lastActiveAt: 20 }),
      session({ sessionId: 3, status: "closed", lastActiveAt: 50 }),
      session({ sessionId: 4, status: "stopped", lastActiveAt: 30 }),
    ];

    expect(
      selectSessionMonitorItems(sessions).map((item) => item.sessionId),
    ).toEqual([3, 1, 4]);
  });
});

describe("createAgentSessionStatusNotificationIntent", () => {
  it("creates a five-minute completion notification with summary and recent messages", () => {
    const intent = createAgentSessionStatusNotificationIntent(
      session({
        sessionId: 8,
        status: "closed",
        title: "Implement monitor",
      }),
      [
        { type: "user_message", text: "Please add the floating monitor." },
        { type: "assistant_message", text: "I added the monitor and tests." },
        { type: "assistant_message", text: "Summary: monitor is ready." },
      ],
      {
        copy: TEST_COPY,
        projectName: "RedWhisk",
      },
    );

    expect(intent).toMatchObject({
      durationMs: 300_000,
      key: "agent-session-status:8:closed",
      level: "normal",
      title: "RedWhisk session completed",
    });
    expect(intent?.body).toContain("Summary");
    expect(intent?.body).toContain("Summary: monitor is ready.");
    expect(intent?.body).toContain("Recent messages");
    expect(intent?.body).toContain("User: Please add the floating monitor.");
    expect(intent?.body).toContain("Agent: I added the monitor and tests.");
  });

  it("creates an urgent failure notification from the latest error", () => {
    const intent = createAgentSessionStatusNotificationIntent(
      session({
        sessionId: 9,
        status: "crashed",
        title: "Run tests",
      }),
      [{ type: "error", message: "Process exited with code 1." }],
      {
        copy: TEST_COPY,
        projectName: "RedWhisk",
      },
    );

    expect(intent).toMatchObject({
      level: "urgent",
      title: "RedWhisk session failed",
    });
    expect(intent?.body).toContain("Process exited with code 1.");
  });
});

function session(
  overrides: Partial<AgentSessionListItem> = {},
): AgentSessionListItem {
  return {
    agentType: "codex",
    attention: "none",
    closedAt: null,
    issueId: null,
    issueTitle: null,
    lastActiveAt: 10,
    latestOutput: null,
    sessionId: 1,
    startedAt: 1,
    status: "running",
    title: null,
    ...overrides,
  };
}

const TEST_COPY = {
  needsInputTitle: (projectName: string) => `${projectName} needs your input`,
  permissionFallbackBody: "Agent is waiting for approval or input.",
  sessionCompletedTitle: (projectName: string) =>
    `${projectName} session completed`,
  sessionCompletionFallbackSummary: "No final summary was captured.",
  sessionFailedTitle: (projectName: string) => `${projectName} session failed`,
  sessionRecentMessagesLabel: "Recent messages",
  sessionStatusLine: (title: string, status: string) =>
    `${title} finished with status ${status}.`,
  sessionSummaryLabel: "Summary",
  sessionUpdatedTitle: (projectName: string) =>
    `${projectName} session updated`,
  turnCompletedBody: (sessionId: number) =>
    `Session #${sessionId} has finished the latest turn.`,
  turnFailedFallbackBody: "The latest agent turn failed.",
};
