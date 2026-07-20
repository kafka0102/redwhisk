import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentTuiSessionView } from "./agent-tui-session-view";
import type { TerminalTransport } from "../../terminals/terminal-types";

const terminalSurfaceMock = vi.hoisted(() => ({
  lastTransport: null as TerminalTransport | null,
  lastTransportKey: null as string | number | null,
  lastAriaLabel: null as string | null,
}));

const commandMocks = vi.hoisted(() => ({
  readAgentSessionTerminal: vi.fn(),
  resizeAgentSessionTerminal: vi.fn(),
  restoreAgentSessionTerminal: vi.fn(),
  subscribeAgentSessionTerminalOutputCommand: vi.fn(),
  unsubscribeAgentSessionTerminalOutput: vi.fn(),
  writeAgentSessionTerminal: vi.fn(),
}));

const eventMocks = vi.hoisted(() => ({
  unlisten: vi.fn(),
  handler: null as
    | ((event: {
        projectId: number;
        sessionId: number;
        sequence: number;
        data: string;
      }) => void)
    | null,
}));

vi.mock("../../terminals/terminal-surface", () => ({
  TerminalSurface: ({
    ariaLabel,
    transport,
    transportKey,
  }: {
    ariaLabel: string;
    transport: TerminalTransport;
    transportKey: string | number;
  }) => {
    terminalSurfaceMock.lastAriaLabel = ariaLabel;
    terminalSurfaceMock.lastTransport = transport;
    terminalSurfaceMock.lastTransportKey = transportKey;
    return createElement("div", {
      "aria-label": ariaLabel,
      "data-testid": "agent-tui-terminal-surface",
    });
  },
}));

vi.mock("../agent-session-commands", () => ({
  readAgentSessionTerminal: commandMocks.readAgentSessionTerminal,
  resizeAgentSessionTerminal: commandMocks.resizeAgentSessionTerminal,
  restoreAgentSessionTerminal: commandMocks.restoreAgentSessionTerminal,
  subscribeAgentSessionTerminalOutput:
    commandMocks.subscribeAgentSessionTerminalOutputCommand,
  unsubscribeAgentSessionTerminalOutput:
    commandMocks.unsubscribeAgentSessionTerminalOutput,
  writeAgentSessionTerminal: commandMocks.writeAgentSessionTerminal,
}));

vi.mock("../agent-terminal-events", () => ({
  subscribeAgentSessionTerminalOutput: (
    handler: (event: {
      projectId: number;
      sessionId: number;
      sequence: number;
      data: string;
    }) => void,
  ) => {
    eventMocks.handler = handler;
    return Promise.resolve(eventMocks.unlisten);
  },
}));

describe("AgentTuiSessionView", () => {
  it("渲染 TerminalSurface 并用 i18n 文案作为 aria-label", () => {
    render(<AgentTuiSessionView projectId={7} sessionId={42} />);

    expect(
      screen.getByTestId("agent-tui-terminal-surface"),
    ).toBeInTheDocument();
    expect(terminalSurfaceMock.lastAriaLabel).toMatch(/TUI|终端|会话/i);
    expect(terminalSurfaceMock.lastTransportKey).toBe("agent-tui:7:42");
  });

  it("transport 契约转发到 agent session 终端 I/O 命令", async () => {
    render(<AgentTuiSessionView projectId={3} sessionId={9} />);
    const transport = terminalSurfaceMock.lastTransport;
    expect(transport).not.toBeNull();

    await transport!.readSnapshot(1024);
    expect(commandMocks.readAgentSessionTerminal).toHaveBeenCalledWith({
      projectId: 3,
      sessionId: 9,
      maxBytes: 1024,
    });

    await transport!.resize(24, 80);
    expect(commandMocks.resizeAgentSessionTerminal).toHaveBeenCalledWith({
      projectId: 3,
      sessionId: 9,
      rows: 24,
      cols: 80,
    });

    await transport!.restore();
    expect(commandMocks.restoreAgentSessionTerminal).toHaveBeenCalledWith({
      projectId: 3,
      sessionId: 9,
    });

    await transport!.setLiveSubscription(true);
    expect(
      commandMocks.subscribeAgentSessionTerminalOutputCommand,
    ).toHaveBeenCalledWith({
      projectId: 3,
      sessionId: 9,
    });

    await transport!.setLiveSubscription(false);
    expect(
      commandMocks.unsubscribeAgentSessionTerminalOutput,
    ).toHaveBeenCalledWith({
      projectId: 3,
      sessionId: 9,
    });

    await transport!.write("hello");
    expect(commandMocks.writeAgentSessionTerminal).toHaveBeenCalledWith({
      projectId: 3,
      sessionId: 9,
      data: "hello",
    });
  });

  it("subscribeOutput 仅转发本 session 的终端输出事件", async () => {
    render(<AgentTuiSessionView projectId={1} sessionId={5} />);
    const transport = terminalSurfaceMock.lastTransport!;
    const onChunk = vi.fn();

    await transport.subscribeOutput(onChunk);
    expect(eventMocks.handler).not.toBeNull();

    eventMocks.handler!({
      projectId: 1,
      sessionId: 99,
      sequence: 1,
      data: "other",
    });
    expect(onChunk).not.toHaveBeenCalled();

    eventMocks.handler!({
      projectId: 2,
      sessionId: 5,
      sequence: 2,
      data: "other-project",
    });
    expect(onChunk).not.toHaveBeenCalled();

    eventMocks.handler!({
      projectId: 1,
      sessionId: 5,
      sequence: 3,
      data: "mine",
    });
    expect(onChunk).toHaveBeenCalledWith({
      sequence: 3,
      data: "mine",
    });
  });
});
