import { describe, expect, it } from "vitest";

import {
  getTuiResumeErrorReason,
  isTuiResumeRetryableReason,
  shouldAutoResumeTuiSession,
  TUI_RESUME_RETRYABLE_REASONS,
} from "./agent-tui-session-resume";

describe("shouldAutoResumeTuiSession", () => {
  const base = {
    isActive: true,
    sessionStatus: "stopped" as const,
    issueStatus: "running" as const,
    supportsTuiResume: true,
    isPtyActive: false,
  };

  it("returns true when inactive PTY, supports resume, issue running", () => {
    expect(shouldAutoResumeTuiSession(base)).toBe(true);
  });

  it("returns true when issue is review", () => {
    expect(shouldAutoResumeTuiSession({ ...base, issueStatus: "review" })).toBe(
      true,
    );
  });

  it("returns false when pane is not the current session", () => {
    expect(shouldAutoResumeTuiSession({ ...base, isActive: false })).toBe(
      false,
    );
  });

  it("returns false when session is closed", () => {
    expect(
      shouldAutoResumeTuiSession({ ...base, sessionStatus: "closed" }),
    ).toBe(false);
  });

  it("returns false when issue is backlog or completed or missing", () => {
    expect(
      shouldAutoResumeTuiSession({ ...base, issueStatus: "backlog" }),
    ).toBe(false);
    expect(
      shouldAutoResumeTuiSession({ ...base, issueStatus: "completed" }),
    ).toBe(false);
    expect(shouldAutoResumeTuiSession({ ...base, issueStatus: null })).toBe(
      false,
    );
  });

  it("returns false when provider does not support TUI resume", () => {
    expect(
      shouldAutoResumeTuiSession({ ...base, supportsTuiResume: false }),
    ).toBe(false);
  });

  it("returns false when PTY is already active", () => {
    expect(shouldAutoResumeTuiSession({ ...base, isPtyActive: true })).toBe(
      false,
    );
  });
});

describe("isTuiResumeRetryableReason", () => {
  it("allows only the retry whitelist", () => {
    for (const reason of TUI_RESUME_RETRYABLE_REASONS) {
      expect(isTuiResumeRetryableReason(reason)).toBe(true);
    }
    expect(isTuiResumeRetryableReason("closedSessionCannotResume")).toBe(false);
    expect(isTuiResumeRetryableReason("tuiResumeNotSupported")).toBe(false);
    expect(isTuiResumeRetryableReason("completedIssueSessionCannotRun")).toBe(
      false,
    );
    expect(isTuiResumeRetryableReason("missingLinkedIssue")).toBe(false);
    expect(isTuiResumeRetryableReason(undefined)).toBe(false);
  });
});

describe("getTuiResumeErrorReason", () => {
  it("reads reason from command-shaped errors", () => {
    expect(
      getTuiResumeErrorReason({
        code: "AGENT_SESSION_VALIDATION_FAILED",
        message: "missing id",
        reason: "missingResumeSessionId",
      }),
    ).toBe("missingResumeSessionId");
  });
});
