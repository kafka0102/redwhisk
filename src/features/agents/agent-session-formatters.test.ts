import { describe, expect, it } from "vitest";

import type { AgentSessionListItem } from "./agent-session-commands";
import {
  formatDuration,
  formatProcessingDuration,
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

describe("formatProcessingDuration", () => {
  const base: AgentSessionListItem = {
    sessionId: 1,
    number: 1,
    issueId: null,
    issueNumber: null,
    issueTitle: null,
    title: null,
    agentType: "codex",
    status: "closed",
    attention: "none",
    lastActiveAt: 0,
    startedAt: 0,
    closedAt: 0,
  };

  it("returns dash for null session", () => {
    expect(formatProcessingDuration(null, "zh")).toBe("-");
  });

  it("returns dash when processingMs is missing or non-positive", () => {
    expect(formatProcessingDuration({ ...base }, "zh")).toBe("-");
    expect(formatProcessingDuration({ ...base, processingMs: 0 }, "en")).toBe(
      "-",
    );
  });

  it("returns dash for crashed and stopped sessions", () => {
    expect(
      formatProcessingDuration(
        { ...base, status: "crashed", processingMs: 60_000 },
        "en",
      ),
    ).toBe("-");
    expect(
      formatProcessingDuration(
        { ...base, status: "stopped", processingMs: 60_000 },
        "en",
      ),
    ).toBe("-");
  });

  it("formats duration for a normally closed session", () => {
    expect(
      formatProcessingDuration({ ...base, processingMs: 184_000 }, "en"),
    ).toBe("3m 4s");
    expect(
      formatProcessingDuration({ ...base, processingMs: 184_000 }, "zh"),
    ).toBe("3分4秒");
  });
});
