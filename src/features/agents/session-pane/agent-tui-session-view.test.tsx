import { createElement } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentTuiSessionView } from "./agent-tui-session-view";
import type { TerminalTransport } from "../../terminals/terminal-types";

const terminalSurfaceMock = vi.hoisted(() => ({
  lastTransport: null as TerminalTransport | null,
  lastTransportKey: null as string | number | null,
  lastAriaLabel: null as string | null,
  remountCount: 0,
}));

const commandMocks = vi.hoisted(() => ({
  listAgentModels: vi.fn(),
  readAgentSessionTerminal: vi.fn(),
  resizeAgentSessionTerminal: vi.fn(),
  restoreAgentSessionTerminal: vi.fn(),
  resumeAgentSession: vi.fn(),
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
    terminalSurfaceMock.remountCount += 1;
    return createElement("div", {
      "aria-label": ariaLabel,
      "data-testid": "agent-tui-terminal-surface",
    });
  },
}));

vi.mock("../agent-session-commands", () => ({
  listAgentModels: commandMocks.listAgentModels,
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

function mockInactivePty() {
  commandMocks.readAgentSessionTerminal.mockResolvedValue({
    snapshot: "",
    isActive: false,
  });
}

function mockActivePty() {
  commandMocks.readAgentSessionTerminal.mockResolvedValue({
    snapshot: "",
    isActive: true,
  });
}

function mockSupportsTuiResume(supports: boolean) {
  commandMocks.listAgentModels.mockResolvedValue({
    models: [],
    isReadOnly: false,
    capabilities: {
      modelTypeLabel: "Codex",
      canShowModel: false,
      supportsModelSwitching: false,
      supportsReasoningEffort: false,
      supportsModes: false,
      supportsTuiResume: supports,
    },
  });
}

describe("AgentTuiSessionView", () => {
  beforeEach(() => {
    terminalSurfaceMock.lastTransport = null;
    terminalSurfaceMock.lastTransportKey = null;
    terminalSurfaceMock.lastAriaLabel = null;
    terminalSurfaceMock.remountCount = 0;
    eventMocks.handler = null;
    commandMocks.listAgentModels.mockReset();
    commandMocks.readAgentSessionTerminal.mockReset();
    commandMocks.resizeAgentSessionTerminal.mockReset();
    commandMocks.restoreAgentSessionTerminal.mockReset();
    commandMocks.resumeAgentSession.mockReset();
    commandMocks.subscribeAgentSessionTerminalOutputCommand.mockReset();
    commandMocks.unsubscribeAgentSessionTerminalOutput.mockReset();
    commandMocks.writeAgentSessionTerminal.mockReset();
    mockSupportsTuiResume(true);
    mockActivePty();
    commandMocks.resumeAgentSession.mockResolvedValue({
      sessionId: 42,
      threadId: "thread-1",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("渲染 TerminalSurface 并用 i18n 文案作为 aria-label", () => {
    render(<AgentTuiSessionView projectId={7} sessionId={42} />);

    expect(
      screen.getByTestId("agent-tui-terminal-surface"),
    ).toBeInTheDocument();
    expect(terminalSurfaceMock.lastAriaLabel).toMatch(/TUI|终端|会话/i);
    expect(terminalSurfaceMock.lastTransportKey).toBe("agent-tui:7:42:0");
  });

  it("logPath 为 Issue 归档时渲染 Markdown 回看，不挂 TerminalSurface / 不 resume", async () => {
    mockInactivePty();
    commandMocks.readAgentSessionTerminal.mockResolvedValue({
      snapshot: "• ## 结果\n\n**完成** 拆分。\n",
      isActive: false,
    });

    render(
      <AgentTuiSessionView
        projectId={2}
        sessionId={44}
        sessionStatus="closed"
        issueStatus="completed"
        isActive
        logPath="/Users/x/.redwhisk/session-logs/archive/project-2/archive-project-2-issue-33-session-44.log"
      />,
    );

    expect(
      screen.queryByTestId("agent-tui-terminal-surface"),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByLabelText(/归档回看|archive view/i),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(commandMocks.readAgentSessionTerminal).toHaveBeenCalledWith({
        projectId: 2,
        sessionId: 44,
        maxBytes: 512_000,
      });
    });
    expect(commandMocks.resumeAgentSession).not.toHaveBeenCalled();
    expect(commandMocks.listAgentModels).not.toHaveBeenCalled();
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

  it("inactive + supportsTuiResume + running issue 时自动 resume 一次并显示续接中", async () => {
    mockInactivePty();
    let resolveResume:
      | ((value: { sessionId: number; threadId: string }) => void)
      | null = null;
    commandMocks.resumeAgentSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResume = resolve;
        }),
    );

    render(
      <AgentTuiSessionView
        projectId={1}
        sessionId={5}
        sessionStatus="stopped"
        issueStatus="running"
        isActive
      />,
    );

    await waitFor(() => {
      expect(commandMocks.resumeAgentSession).toHaveBeenCalledTimes(1);
    });
    expect(commandMocks.resumeAgentSession).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 5,
    });
    expect(
      await screen.findByText(/正在续接|Resuming session/i),
    ).toBeInTheDocument();

    await act(async () => {
      resolveResume?.({ sessionId: 5, threadId: "thread-5" });
    });

    await waitFor(() => {
      expect(
        screen.queryByText(/正在续接|Resuming session/i),
      ).not.toBeInTheDocument();
    });
    // resume 成功后 remount TerminalSurface 以重新 restore / 订阅 live
    expect(terminalSurfaceMock.remountCount).toBeGreaterThan(1);
  });

  it("自动 resume 只尝试一次，不会对同一挂载重复调用", async () => {
    mockInactivePty();
    commandMocks.resumeAgentSession.mockResolvedValue({
      sessionId: 5,
      threadId: "thread-5",
    });

    const { rerender } = render(
      <AgentTuiSessionView
        projectId={1}
        sessionId={5}
        sessionStatus="crashed"
        issueStatus="review"
        isActive
      />,
    );

    await waitFor(() => {
      expect(commandMocks.resumeAgentSession).toHaveBeenCalledTimes(1);
    });

    rerender(
      <AgentTuiSessionView
        projectId={1}
        sessionId={5}
        sessionStatus="crashed"
        issueStatus="review"
        isActive
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(commandMocks.resumeAgentSession).toHaveBeenCalledTimes(1);
  });

  it("PTY 仍活跃时不调用 resume", async () => {
    mockActivePty();
    render(
      <AgentTuiSessionView
        projectId={1}
        sessionId={5}
        sessionStatus="running"
        issueStatus="running"
        isActive
      />,
    );

    await waitFor(() => {
      expect(commandMocks.listAgentModels).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(commandMocks.resumeAgentSession).not.toHaveBeenCalled();
  });

  it("supportsTuiResume=false 时不自动 resume", async () => {
    mockInactivePty();
    mockSupportsTuiResume(false);

    render(
      <AgentTuiSessionView
        projectId={1}
        sessionId={5}
        sessionStatus="stopped"
        issueStatus="running"
        isActive
      />,
    );

    await waitFor(() => {
      expect(commandMocks.listAgentModels).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(commandMocks.resumeAgentSession).not.toHaveBeenCalled();
  });

  it("issue 非 running/review 或 session closed 时不自动 resume", async () => {
    mockInactivePty();

    const { rerender } = render(
      <AgentTuiSessionView
        projectId={1}
        sessionId={5}
        sessionStatus="stopped"
        issueStatus="completed"
        isActive
      />,
    );
    await waitFor(() => {
      expect(commandMocks.listAgentModels).toHaveBeenCalled();
    });
    expect(commandMocks.resumeAgentSession).not.toHaveBeenCalled();

    rerender(
      <AgentTuiSessionView
        projectId={1}
        sessionId={5}
        sessionStatus="closed"
        issueStatus="running"
        isActive
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(commandMocks.resumeAgentSession).not.toHaveBeenCalled();
  });

  it("resume 失败时显示详细错误；可重试 reason 显示重试按钮", async () => {
    mockInactivePty();
    commandMocks.resumeAgentSession.mockRejectedValue({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "workspace missing",
      reason: "workspaceMissingForResume",
    });

    render(
      <AgentTuiSessionView
        projectId={1}
        sessionId={5}
        sessionStatus="stopped"
        issueStatus="running"
        isActive
      />,
    );

    expect(
      await screen.findByText(
        /Agent Session 工作区不存在|workspace does not exist/i,
      ),
    ).toBeInTheDocument();
    const retry = await screen.findByRole("button", {
      name: /重试|Retry/i,
    });

    commandMocks.resumeAgentSession.mockResolvedValueOnce({
      sessionId: 5,
      threadId: "thread-5",
    });
    await userEvent.click(retry);

    await waitFor(() => {
      expect(commandMocks.resumeAgentSession).toHaveBeenCalledTimes(2);
    });
  });

  it("不可重试 reason 不显示重试按钮", async () => {
    mockInactivePty();
    commandMocks.resumeAgentSession.mockRejectedValue({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "closed",
      reason: "closedSessionCannotResume",
    });

    render(
      <AgentTuiSessionView
        projectId={1}
        sessionId={5}
        sessionStatus="stopped"
        issueStatus="running"
        isActive
      />,
    );

    expect(
      await screen.findByText(/closed|不能续接|正常关闭/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /重试|Retry/i }),
    ).not.toBeInTheDocument();
  });

  it("isActive=false 时不自动 resume（实例池 hidden 面板）", async () => {
    mockInactivePty();
    render(
      <AgentTuiSessionView
        projectId={1}
        sessionId={5}
        sessionStatus="stopped"
        issueStatus="running"
        isActive={false}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(commandMocks.listAgentModels).not.toHaveBeenCalled();
    expect(commandMocks.resumeAgentSession).not.toHaveBeenCalled();
  });
});
