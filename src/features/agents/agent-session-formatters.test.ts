import { describe, expect, it } from "vitest";

import type { AgentSessionListItem } from "./agent-session-commands";
import {
  formatDuration,
  formatProcessingDuration,
  getSessionEndedAt,
  getSessionStatusTone,
  isAgentTurnActivelyRunning,
  shouldShowRunningSpinner,
} from "./agent-session-formatters";

describe("formatDuration", () => {
  it("returns dash for non-positive input", () => {
    expect(formatDuration(0, "zh")).toBe("-");
    expect(formatDuration(999, "en")).toBe("-");
  });

  it("formats seconds", () => {
    expect(formatDuration(1000, "zh")).toBe("1秒");
    expect(formatDuration(59_000, "en")).toBe("59s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(184_000, "en")).toBe("3m 4s");
    expect(formatDuration(184_000, "zh")).toBe("3分4秒");
  });

  it("formats hours, minutes and seconds", () => {
    expect(formatDuration(3_964_000, "en")).toBe("1h 6m 4s");
    expect(formatDuration(3_964_000, "zh")).toBe("1小时6分4秒");
  });
});

describe("getSessionEndedAt", () => {
  const base = makeSession();

  it("returns null while the session is still running", () => {
    expect(
      getSessionEndedAt({
        ...base,
        status: "running",
        closedAt: null,
        lastOutputAt: 1_780_365_826_523,
      }),
    ).toBeNull();
  });

  it("returns closedAt after the session has ended", () => {
    expect(
      getSessionEndedAt({
        ...base,
        status: "closed",
        closedAt: 1_780_377_000_000,
        lastOutputAt: 1_780_365_826_523,
      }),
    ).toBe(1_780_377_000_000);
  });
});

describe("formatProcessingDuration", () => {
  const base = makeSession();

  it("returns dash for null session", () => {
    expect(formatProcessingDuration(null, "zh")).toBe("-");
  });

  it("returns dash when elapsed time is missing or non-positive", () => {
    expect(formatProcessingDuration({ ...base }, "zh")).toBe("-");
    expect(
      formatProcessingDuration(
        { ...base, startedAt: 1_000, closedAt: 1_000 },
        "en",
      ),
    ).toBe("-");
  });

  it("formats wall-clock duration for crashed and stopped sessions", () => {
    expect(
      formatProcessingDuration(
        {
          ...base,
          status: "crashed",
          startedAt: 1_000,
          closedAt: 185_000,
          processingMs: 60_000,
        },
        "en",
      ),
    ).toBe("3m 4s");
    expect(
      formatProcessingDuration(
        {
          ...base,
          status: "stopped",
          startedAt: 1_000,
          closedAt: 185_000,
          processingMs: 60_000,
        },
        "zh",
      ),
    ).toBe("3分4秒");
  });

  it("formats wall-clock duration for a normally closed session", () => {
    expect(
      formatProcessingDuration(
        {
          ...base,
          startedAt: 1_000,
          closedAt: 185_000,
          processingMs: 5_000,
        },
        "en",
      ),
    ).toBe("3m 4s");
    expect(
      formatProcessingDuration(
        {
          ...base,
          startedAt: 1_000,
          closedAt: 185_000,
          processingMs: 5_000,
        },
        "zh",
      ),
    ).toBe("3分4秒");
  });

  it("uses live elapsed time for a running session instead of lastOutputAt or processingMs", () => {
    const startedAt = 1_789_352_695_333;
    expect(
      formatProcessingDuration(
        {
          ...base,
          status: "running",
          startedAt,
          closedAt: null,
          lastOutputAt: startedAt + 13_191_190,
          processingMs: 1_502_399,
        },
        "zh",
        startedAt + 24_797_314,
      ),
    ).toBe("6小时53分17秒");
  });
});

const runningBase = makeSession({
  issueId: 10,
  issueNumber: 1,
  issueTitle: "Merge conflict issue",
  agentType: "claude",
  displayMode: "json",
  status: "running",
});

describe("isAgentTurnActivelyRunning", () => {
  it("is true when status running and isTurnRunning true", () => {
    expect(
      isAgentTurnActivelyRunning({ ...runningBase, isTurnRunning: true }),
    ).toBe(true);
  });

  it("is false when isTurnRunning false (turn idle)", () => {
    expect(
      isAgentTurnActivelyRunning({ ...runningBase, isTurnRunning: false }),
    ).toBe(false);
  });

  it("is false when isTurnRunning undefined (legacy data)", () => {
    expect(isAgentTurnActivelyRunning({ ...runningBase })).toBe(false);
  });

  it("is false when session is not running", () => {
    expect(
      isAgentTurnActivelyRunning({
        ...runningBase,
        status: "closed",
        isTurnRunning: true,
      }),
    ).toBe(false);
  });
});

describe("session card reflects actual agent running over static issue status", () => {
  // 完成流程 worktree 合并冲突注入 prompt 后：issue 停在 review，但 agent
  // 实际在跑解决冲突的 turn。card 应按实际运行展示 running。
  it("status tone is running when turn actively running despite issueStatus review", () => {
    expect(
      getSessionStatusTone({
        ...runningBase,
        isTurnRunning: true,
        issueStatus: "review",
      }),
    ).toBe("running");
  });

  it("spinner spins when turn actively running despite issueStatus review", () => {
    expect(
      shouldShowRunningSpinner({
        ...runningBase,
        isTurnRunning: true,
        issueStatus: "review",
      }),
    ).toBe(true);
  });

  it("status tone is running when turn actively running despite issueStatus completed", () => {
    expect(
      getSessionStatusTone({
        ...runningBase,
        isTurnRunning: true,
        issueStatus: "completed",
      }),
    ).toBe("running");
  });

  // 回归：turn idle（isTurnRunning false）时回落到静态 issue 状态展示。
  it("status tone falls back to review when idle and issueStatus review", () => {
    expect(
      getSessionStatusTone({
        ...runningBase,
        isTurnRunning: false,
        issueStatus: "review",
      }),
    ).toBe("review");
  });

  it("spinner does not spin when idle and issueStatus review", () => {
    expect(
      shouldShowRunningSpinner({
        ...runningBase,
        isTurnRunning: false,
        issueStatus: "review",
      }),
    ).toBe(false);
  });

  // attention requested 仍优先于 running 展示（保持原语义）。
  it("status tone is attention when requested even if turn actively running", () => {
    expect(
      getSessionStatusTone({
        ...runningBase,
        isTurnRunning: true,
        attention: "requested",
        issueStatus: "review",
      }),
    ).toBe("attention");
  });
});

function makeSession(
  overrides: Partial<AgentSessionListItem> = {},
): AgentSessionListItem {
  return {
    sessionId: 1,
    number: 1,
    projectId: 1,
    issueId: null,
    issueNumber: null,
    issueTitle: null,
    issueStatus: null,
    agentProfileId: 1,
    agentProfileName: "Test Profile",
    workflowSkillName: null,
    canCompleteClean: false,
    canCompleteAgentCommit: false,
    title: null,
    agentType: "codex",
    displayMode: "json",
    status: "closed",
    attention: "none",
    isTurnRunning: false,
    workspaceMode: "current_branch",
    workingDir: "/tmp/repo",
    workspacePath: null,
    originBranch: null,
    workspaceBranch: null,
    worktreeOwner: "redwhisk",
    logPath: "/tmp/session.log",
    latestOutput: null,
    lastActiveAt: 0,
    startedAt: 0,
    closedAt: 0,
    processingMs: 0,
    lastOutputAt: null,
    ...overrides,
  };
}
