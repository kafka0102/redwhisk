import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CompletedReviewTerminal } from "./completed-review-terminal";
import type { TerminalTransport } from "../../terminals/terminal-types";

const terminalSurfaceMock = vi.hoisted(() => ({
  lastTransport: null as TerminalTransport | null,
}));

const commandMocks = vi.hoisted(() => ({
  openCompletedReview: vi.fn(),
  readAgentSessionTerminal: vi.fn(),
  resizeAgentSessionTerminal: vi.fn(),
  restoreAgentSessionTerminal: vi.fn(),
  resumeAgentSession: vi.fn(),
  subscribeAgentSessionTerminalOutputCommand: vi.fn(),
  unsubscribeAgentSessionTerminalOutput: vi.fn(),
  writeAgentSessionTerminal: vi.fn(),
}));

vi.mock("../../terminals/terminal-surface", () => ({
  TerminalSurface: ({
    ariaLabel,
    transport,
  }: {
    ariaLabel: string;
    transport: TerminalTransport;
  }) => {
    terminalSurfaceMock.lastTransport = transport;
    return createElement("div", {
      "aria-label": ariaLabel,
      "data-testid": "completed-review-terminal-surface",
    });
  },
}));

vi.mock("../agent-session-commands", () => ({
  openCompletedReview: commandMocks.openCompletedReview,
  readAgentSessionTerminal: commandMocks.readAgentSessionTerminal,
  resizeAgentSessionTerminal: commandMocks.resizeAgentSessionTerminal,
  restoreAgentSessionTerminal: commandMocks.restoreAgentSessionTerminal,
  resumeAgentSession: commandMocks.resumeAgentSession,
  subscribeAgentSessionTerminalOutput:
    commandMocks.subscribeAgentSessionTerminalOutputCommand,
  unsubscribeAgentSessionTerminalOutput:
    commandMocks.unsubscribeAgentSessionTerminalOutput,
  writeAgentSessionTerminal: commandMocks.writeAgentSessionTerminal,
}));

vi.mock("../agent-terminal-events", () => ({
  subscribeAgentSessionTerminalOutput: () => Promise.resolve(() => undefined),
}));

describe("CompletedReviewTerminal", () => {
  beforeEach(() => {
    terminalSurfaceMock.lastTransport = null;
    commandMocks.openCompletedReview.mockReset();
    commandMocks.readAgentSessionTerminal.mockReset();
    commandMocks.writeAgentSessionTerminal.mockReset();
    commandMocks.resumeAgentSession.mockReset();
    commandMocks.openCompletedReview.mockResolvedValue({
      sessionId: 9,
      command: "codex resume thread-1",
      workingDir: "/tmp/workspace",
    });
    commandMocks.readAgentSessionTerminal.mockResolvedValue({
      snapshot: "",
      isActive: true,
    });
    commandMocks.writeAgentSessionTerminal.mockResolvedValue(undefined);
  });

  it("opens the completed review and shows the interactive terminal", async () => {
    render(<CompletedReviewTerminal projectId={3} sessionId={9} />);

    await waitFor(() => {
      expect(commandMocks.openCompletedReview).toHaveBeenCalledWith({
        projectId: 3,
        sessionId: 9,
      });
    });
    expect(commandMocks.resumeAgentSession).not.toHaveBeenCalled();
    expect(
      await screen.findByTestId("completed-review-terminal-surface"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/structured|消息流|message stream/i),
    ).not.toBeInTheDocument();
  });

  it("forwards wheel and page keys, and drops letters, enter, and paste", async () => {
    render(<CompletedReviewTerminal projectId={3} sessionId={9} />);
    await screen.findByTestId("completed-review-terminal-surface");
    const transport = terminalSurfaceMock.lastTransport;
    expect(transport).not.toBeNull();

    await transport!.write("\u001b[5~");
    await transport!.write("a\r");
    await transport!.write("pasted text");

    expect(commandMocks.writeAgentSessionTerminal).toHaveBeenCalledTimes(1);
    expect(commandMocks.writeAgentSessionTerminal).toHaveBeenCalledWith({
      projectId: 3,
      sessionId: 9,
      data: "\u001b[5~",
    });
  });

  it("stays on the archive message when the workspace is missing", async () => {
    commandMocks.openCompletedReview.mockRejectedValue({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      reason: "workspaceMissingForCompletedReview",
      message: "完成回看的工作区目录不存在。",
    });

    render(<CompletedReviewTerminal projectId={3} sessionId={9} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/workspace directory is gone/i);
    expect(alert.textContent).not.toMatch(/[\u4e00-\u9fff]/);
    expect(
      screen.queryByTestId("completed-review-terminal-surface"),
    ).not.toBeInTheDocument();
  });
});
