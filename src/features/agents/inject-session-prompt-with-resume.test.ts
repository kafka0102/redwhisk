import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./agent-session-commands", () => ({
  injectAgentSessionPrompt: vi.fn(),
  resumeAgentSession: vi.fn(),
}));

import {
  injectAgentSessionPrompt,
  resumeAgentSession,
} from "./agent-session-commands";
import { injectSessionPromptWithResume } from "./inject-session-prompt-with-resume";

const injectMock = vi.mocked(injectAgentSessionPrompt);
const resumeMock = vi.mocked(resumeAgentSession);

const input = {
  projectId: 1,
  sessionId: 42,
  prompt: "resolve merge conflicts",
  kind: "follow_up" as const,
};

describe("injectSessionPromptWithResume", () => {
  beforeEach(() => {
    injectMock.mockReset();
    resumeMock.mockReset();
  });

  it("injects directly when the session is already live (TUI PTY / structured handle)", async () => {
    injectMock.mockResolvedValueOnce({
      sessionId: 42,
      providerSessionId: null,
    });

    await expect(injectSessionPromptWithResume(input)).resolves.toEqual({
      sessionId: 42,
      providerSessionId: null,
    });

    expect(injectMock).toHaveBeenCalledTimes(1);
    expect(injectMock).toHaveBeenCalledWith(input);
    // live Codex TUI 等已在运行的会话不应先 resume，否则会因缺少 provider_session_id 误报。
    expect(resumeMock).not.toHaveBeenCalled();
  });

  it("resumes then injects when inject reports not running", async () => {
    injectMock
      .mockRejectedValueOnce({
        code: "AGENT_SESSION_NOT_RUNNING",
        message: "当前 Session 未运行，请先恢复会话后再注入。",
        reason: "notRunningForInject",
      })
      .mockResolvedValueOnce({
        sessionId: 42,
        providerSessionId: "thread-42",
      });
    resumeMock.mockResolvedValueOnce({
      sessionId: 42,
      threadId: "thread-42",
    });

    await expect(injectSessionPromptWithResume(input)).resolves.toEqual({
      sessionId: 42,
      providerSessionId: "thread-42",
    });

    expect(injectMock).toHaveBeenNthCalledWith(1, input);
    expect(resumeMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 42,
    });
    expect(injectMock).toHaveBeenNthCalledWith(2, input);
  });

  it("surfaces non-notRunning inject errors without resuming", async () => {
    injectMock.mockRejectedValueOnce({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "prompt too long",
      reason: "promptTooLong",
    });

    await expect(injectSessionPromptWithResume(input)).rejects.toMatchObject({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      reason: "promptTooLong",
    });
    expect(resumeMock).not.toHaveBeenCalled();
  });

  it("surfaces resume failure when session is not running and cannot resume", async () => {
    injectMock.mockRejectedValueOnce({
      code: "AGENT_SESSION_NOT_RUNNING",
      message: "当前 Session 未运行，请先恢复会话后再注入。",
      reason: "notRunningForInject",
    });
    resumeMock.mockRejectedValueOnce({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "当前 Session 缺少可续接的会话标识。",
      reason: "missingResumeSessionId",
    });

    await expect(injectSessionPromptWithResume(input)).rejects.toMatchObject({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      reason: "missingResumeSessionId",
    });
    expect(injectMock).toHaveBeenCalledTimes(1);
  });
});
