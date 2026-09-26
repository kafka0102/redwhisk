import { describe, expect, it } from "vitest";

import type { AgentSessionListItem } from "./agent-session-commands";
import {
  formatDuration,
  formatProcessingDuration,
  formatSessionTokenCount,
  formatSessionTokenHitRate,
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
        startupModel: null,
        tokenInput: null,
        tokenOutput: null,
        tokenCache: null,
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
        startupModel: null,
        tokenInput: null,
        tokenOutput: null,
        tokenCache: null,
      }),
    ).toBe(1_780_377_000_000);
  });
});

describe("formatProcessingDuration", () => {
  const base = makeSession();

  it("returns dash for null session", () => {
    expect(formatProcessingDuration(null, "zh")).toBe("-");
  });

  it("returns dash when the wall-clock span is missing or non-positive", () => {
    expect(
      formatProcessingDuration({ ...base, displayMode: "tui" }, "zh"),
    ).toBe("-");
    expect(
      formatProcessingDuration(
        { ...base, displayMode: "tui", startedAt: 1_000, closedAt: 1_000 },
        "en",
      ),
    ).toBe("-");
    expect(
      formatProcessingDuration(
        {
          ...base,
          displayMode: "tui",
          status: "closed",
          startedAt: 1_000,
          closedAt: null,
        },
        "en",
      ),
    ).toBe("-");
  });

  it("shows the accumulated processing duration for a closed json session", () => {
    expect(
      formatProcessingDuration(
        {
          ...base,
          displayMode: "json",
          startedAt: 1_000,
          closedAt: 185_000,
          processingMs: 60_000,
        },
        "en",
      ),
    ).toBe("1m 0s");
    expect(
      formatProcessingDuration(
        {
          ...base,
          displayMode: "json",
          startedAt: 1_000,
          closedAt: 185_000,
          processingMs: 60_000,
        },
        "zh",
      ),
    ).toBe("1分0秒");
  });

  it("shows the accumulated processing duration for a running json session without growing with the wall clock", () => {
    const startedAt = 1_789_352_695_333;
    const session = {
      ...base,
      displayMode: "json",
      status: "running",
      startedAt,
      closedAt: null,
      processingMs: 1_502_399,
    } satisfies AgentSessionListItem;
    expect(
      formatProcessingDuration(session, "zh", startedAt + 24_797_314),
    ).toBe("25分2秒");
    expect(
      formatProcessingDuration(session, "zh", startedAt + 999_999_999),
    ).toBe("25分2秒");
  });

  it("falls back to wall-clock for a tui session", () => {
    expect(
      formatProcessingDuration(
        { ...base, displayMode: "tui", startedAt: 1_000, closedAt: 185_000 },
        "en",
      ),
    ).toBe("3m 4s");
    expect(
      formatProcessingDuration(
        { ...base, displayMode: "tui", startedAt: 1_000, closedAt: 185_000 },
        "zh",
      ),
    ).toBe("3分4秒");
    expect(
      formatProcessingDuration(
        {
          ...base,
          displayMode: "tui",
          status: "running",
          startedAt: 1_000,
          closedAt: null,
        },
        "en",
        185_000,
      ),
    ).toBe("3m 4s");
  });

  it("falls back to wall-clock when the accumulated duration is zero", () => {
    expect(
      formatProcessingDuration(
        {
          ...base,
          displayMode: "json",
          status: "crashed",
          startedAt: 1_000,
          closedAt: 185_000,
          processingMs: 0,
        },
        "en",
      ),
    ).toBe("3m 4s");
    expect(
      formatProcessingDuration(
        {
          ...base,
          displayMode: "json",
          status: "stopped",
          startedAt: 1_000,
          closedAt: 185_000,
          processingMs: 0,
        },
        "zh",
      ),
    ).toBe("3分4秒");
  });

  it("uses live elapsed time for a running session when the accumulated duration is zero", () => {
    const startedAt = 1_789_352_695_333;
    expect(
      formatProcessingDuration(
        {
          ...base,
          displayMode: "json",
          status: "running",
          startedAt,
          closedAt: null,
          lastOutputAt: startedAt + 13_191_190,
          startupModel: null,
          tokenInput: null,
          tokenOutput: null,
          tokenCache: null,
          processingMs: 0,
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
    startupModel: null,
    tokenInput: null,
    tokenOutput: null,
    tokenCache: null,
    ...overrides,
  };
}

describe("formatSessionTokenCount", () => {
  it("returns a dash when usage is missing", () => {
    expect(formatSessionTokenCount(null)).toBe("-");
  });

  it("formats zero as 0K", () => {
    expect(formatSessionTokenCount(0)).toBe("0K");
  });

  it("formats values below 1K as 1K", () => {
    expect(formatSessionTokenCount(1)).toBe("1K");
    expect(formatSessionTokenCount(999)).toBe("1K");
  });

  it("formats thousands as integer K floored", () => {
    expect(formatSessionTokenCount(1000)).toBe("1K");
    expect(formatSessionTokenCount(1999)).toBe("1K");
    expect(formatSessionTokenCount(2000)).toBe("2K");
  });

  it("formats millions as M with two decimal places floored", () => {
    expect(formatSessionTokenCount(1_000_000)).toBe("1.00M");
    expect(formatSessionTokenCount(1_234_567)).toBe("1.23M");
    expect(formatSessionTokenCount(1_299_999)).toBe("1.29M");
  });
});

describe("formatSessionTokenHitRate", () => {
  it("returns a dash when usage is missing", () => {
    expect(formatSessionTokenHitRate(null, null)).toBe("-");
  });

  it("returns 0% when usage exists and the denominator is 0", () => {
    expect(formatSessionTokenHitRate(0, 0)).toBe("0%");
  });

  it("returns an integer percentage of cache / (input + cache)", () => {
    expect(formatSessionTokenHitRate(3000, 1000)).toBe("25%");
    expect(formatSessionTokenHitRate(100, 0)).toBe("0%");
  });
});
