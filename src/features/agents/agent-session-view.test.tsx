import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentStreamEventEnvelope } from "./agent-stream-types";
import { AgentSessionView } from "./agent-session-view";
import { clearAgentMessageStreamCacheForTest } from "./message-stream/use-agent-message-stream";

// vi.hoisted 让 mock 工厂与测试体共享同一份可变 listeners，便于推送事件。
const mocks = vi.hoisted(() => ({
  listeners: [] as Array<{
    eventName: string;
    callback: (event: { payload: AgentStreamEventEnvelope }) => void;
  }>,
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (
      eventName: string,
      callback: (event: { payload: AgentStreamEventEnvelope }) => void,
    ) => {
      mocks.listeners.push({ eventName, callback });
      return Promise.resolve(mocks.unlisten);
    },
  ),
}));

vi.mock("./agent-session-commands", () => ({
  readAgentTimeline: vi.fn(),
  resumeStructuredAgentSession: vi.fn(),
  sendAgentMessage: vi.fn(),
  cancelAgentTurn: vi.fn(),
  respondAgentPermission: vi.fn(),
  setAgentModel: vi.fn(),
  setAgentThinking: vi.fn(),
  setAgentMode: vi.fn(),
  listAgentModels: vi.fn(),
  listAgentModes: vi.fn(),
  saveAgentAttachment: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const {
  readAgentTimeline,
  resumeStructuredAgentSession,
  sendAgentMessage,
  setAgentModel,
  setAgentThinking,
  listAgentModels,
} = await import("./agent-session-commands");
const readAgentTimelineMock = vi.mocked(readAgentTimeline);
const resumeStructuredAgentSessionMock = vi.mocked(
  resumeStructuredAgentSession,
);
const sendAgentMessageMock = vi.mocked(sendAgentMessage);
const setAgentModelMock = vi.mocked(setAgentModel);
const setAgentThinkingMock = vi.mocked(setAgentThinking);
const listAgentModelsMock = vi.mocked(listAgentModels);

function setupTimeline(items: AgentStreamEventEnvelope["event"][]) {
  // readAgentTimeline 返回 AgentTimelineItem[]；测试用 user_message / assistant_message。
  readAgentTimelineMock.mockReset();
  readAgentTimelineMock.mockResolvedValue({
    items: items as never,
  });
  resumeStructuredAgentSessionMock.mockReset();
  resumeStructuredAgentSessionMock.mockResolvedValue({
    sessionId: 10,
    threadId: "thread-10",
  });
  sendAgentMessageMock.mockReset();
  sendAgentMessageMock.mockResolvedValue(undefined);
  setAgentModelMock.mockReset();
  setAgentModelMock.mockResolvedValue(undefined);
  setAgentThinkingMock.mockReset();
  setAgentThinkingMock.mockResolvedValue(undefined);
  listAgentModelsMock.mockReset();
  listAgentModelsMock.mockResolvedValue({ models: [] });
  mocks.listeners.length = 0;
}

function emitEvent(payload: AgentStreamEventEnvelope) {
  act(() => {
    mocks.listeners[0]?.callback({ payload });
  });
}

afterEach(() => {
  clearAgentMessageStreamCacheForTest();
});

describe("AgentSessionView", () => {
  it("渲染消息流历史与 composer 输入框", async () => {
    setupTimeline([
      { type: "user_message", text: "你好", messageId: "u1" } as never,
      { type: "assistant_message", text: "你好！", messageId: "a1" } as never,
    ]);

    render(<AgentSessionView projectId={1} sessionId={10} agentType="codex" />);

    await waitFor(() => {
      expect(screen.getByText("你好")).toBeInTheDocument();
    });
    expect(screen.getByText("你好！")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Agent session message stream"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Message input" }),
    ).toBeInTheDocument();
  });

  it("发送消息后乐观插入用户消息", async () => {
    setupTimeline([]);
    sendAgentMessageMock.mockReset();
    sendAgentMessageMock.mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<AgentSessionView projectId={1} sessionId={10} agentType="codex" />);

    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: "Message input" }),
      ).toBeInTheDocument();
    });

    await user.type(
      screen.getByRole("textbox", { name: "Message input" }),
      "测试消息",
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(sendAgentMessageMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 10,
      message: "测试消息",
      attachments: [],
    });
    // 乐观插入：发送后立即在流中看到用户消息，不等后端回显。
    expect(screen.getByText("测试消息")).toBeInTheDocument();
  });

  it("收到配置中的 Think effort 后优先显示该值", async () => {
    setupTimeline([]);
    listAgentModelsMock.mockResolvedValueOnce({
      models: [
        {
          modelId: "gpt-5.5",
          displayName: "GPT-5.5",
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
      ],
    });

    render(<AgentSessionView projectId={1} sessionId={10} agentType="codex" />);

    await screen.findByRole("combobox", { name: "Think mode" });
    emitEvent({
      projectId: 1,
      sessionId: 10,
      seq: 1,
      epoch: "epoch-1",
      event: { type: "effort_changed", effort: "high" } as never,
    });

    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "Think mode" }),
      ).toHaveTextContent("高");
    });
  });

  it("进入历史 session 时用 timeline 返回的 Think effort 初始化显示", async () => {
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [],
      effort: "high",
    });
    listAgentModelsMock.mockResolvedValueOnce({
      models: [
        {
          modelId: "gpt-5.5",
          displayName: "GPT-5.5",
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
      ],
    });

    render(<AgentSessionView projectId={1} sessionId={10} agentType="codex" />);

    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "Think mode" }),
      ).toHaveTextContent("高");
    });
  });

  it("permission_requested 事件到达后渲染权限卡片", async () => {
    setupTimeline([]);

    render(<AgentSessionView projectId={1} sessionId={10} agentType="codex" />);

    await waitFor(() => {
      expect(
        screen.getByLabelText("Agent session message stream"),
      ).toBeInTheDocument();
    });

    emitEvent({
      projectId: 1,
      sessionId: 10,
      seq: 1,
      epoch: "epoch-1",
      event: {
        type: "permission_requested",
        request: {
          id: "permission-item-1",
          kind: "tool",
          title: "Run command: ls",
          actions: [
            { id: "accept", label: "允许", behavior: "allow" },
            { id: "decline", label: "拒绝", behavior: "deny" },
          ],
        },
      },
    });

    expect(
      await screen.findByLabelText("Agent permission approval card"),
    ).toBeInTheDocument();
    expect(screen.getByText("Run command: ls")).toBeInTheDocument();
  });

  it("turn_started 事件后 composer 切换为取消按钮", async () => {
    setupTimeline([]);

    render(<AgentSessionView projectId={1} sessionId={10} agentType="codex" />);

    await waitFor(() => {
      expect(
        screen.getByLabelText("Agent session message stream"),
      ).toBeInTheDocument();
    });

    emitEvent({
      projectId: 1,
      sessionId: 10,
      seq: 1,
      epoch: "epoch-1",
      event: { type: "turn_started", turnId: "t1" },
    });

    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("从 session 列表恢复运行中轮次时立即显示思考状态", async () => {
    setupTimeline([
      {
        type: "user_message",
        text: "北京今天天气如何？",
        messageId: "u1",
      } as never,
    ]);

    render(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        isTurnRunning={true}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("北京今天天气如何？")).toBeInTheDocument();
    });
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("claude agentType 时 composer 不渲染模型 Select", async () => {
    setupTimeline([]);

    render(
      <AgentSessionView projectId={1} sessionId={10} agentType="claude" />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: "Message input" }),
      ).toBeInTheDocument();
    });

    expect(screen.queryByLabelText("Select model")).not.toBeInTheDocument();
  });

  it("已完成 Issue 的 session 不渲染底部输入框", async () => {
    setupTimeline([]);

    render(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        sessionStatus="closed"
        issueStatus="completed"
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByLabelText("Agent session message stream"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("textbox", { name: "Message input" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Completed Issues cannot be run again."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send message" }),
    ).not.toBeInTheDocument();
  });

  it("切换 session 后不沿用上一个 session 的输入错误", async () => {
    setupTimeline([]);
    sendAgentMessageMock.mockRejectedValueOnce(new Error("A session failed"));
    const user = userEvent.setup();
    const { rerender } = render(
      <AgentSessionView projectId={1} sessionId={10} agentType="codex" />,
    );

    await user.type(
      await screen.findByRole("textbox", { name: "Message input" }),
      "失败",
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("A session failed")).toBeInTheDocument();

    setupTimeline([]);
    rerender(
      <AgentSessionView projectId={1} sessionId={11} agentType="codex" />,
    );

    await waitFor(() => {
      expect(screen.queryByText("A session failed")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("textbox", { name: "Message input" })).toHaveValue(
      "",
    );
  });

  it("未完成的关闭 session 发送时先自动恢复再发送消息", async () => {
    setupTimeline([]);
    resumeStructuredAgentSessionMock.mockResolvedValueOnce({
      sessionId: 10,
      threadId: "thread-10",
    });
    const user = userEvent.setup();

    render(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        sessionStatus="closed"
        issueStatus="review"
      />,
    );

    await user.type(
      await screen.findByRole("textbox", { name: "Message input" }),
      "继续处理",
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(resumeStructuredAgentSessionMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 10,
      });
    });
    expect(sendAgentMessageMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 10,
      message: "继续处理",
      attachments: [],
    });
  });

  it("未完成的关闭 session 切换模型时先自动恢复再设置模型", async () => {
    setupTimeline([]);
    listAgentModelsMock.mockResolvedValueOnce({
      models: [
        {
          modelId: "gpt-5",
          displayName: "GPT-5",
          isDefault: true,
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
        {
          modelId: "gpt-4o",
          displayName: "GPT-4o",
          supportedReasoningEfforts: [],
        },
      ],
    });
    resumeStructuredAgentSessionMock.mockResolvedValueOnce({
      sessionId: 10,
      threadId: "thread-10",
    });
    const user = userEvent.setup();

    render(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        sessionStatus="closed"
        issueStatus="review"
      />,
    );

    await user.click(
      await screen.findByRole("combobox", { name: "Select model" }),
    );
    await user.click(await screen.findByRole("option", { name: "GPT-4o" }));

    await waitFor(() => {
      expect(resumeStructuredAgentSessionMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 10,
      });
    });
    expect(setAgentModelMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 10,
      modelId: "gpt-4o",
    });
  });

  it("未完成的关闭 session 切换 Think 时先自动恢复再设置 effort", async () => {
    setupTimeline([]);
    listAgentModelsMock.mockResolvedValueOnce({
      models: [
        {
          modelId: "gpt-5",
          displayName: "GPT-5",
          isDefault: true,
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
      ],
    });
    resumeStructuredAgentSessionMock.mockResolvedValueOnce({
      sessionId: 10,
      threadId: "thread-10",
    });
    const user = userEvent.setup();

    render(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        sessionStatus="closed"
        issueStatus="review"
      />,
    );

    await user.click(
      await screen.findByRole("combobox", { name: "Think mode" }),
    );
    await user.click(await screen.findByRole("option", { name: "高" }));

    await waitFor(() => {
      expect(resumeStructuredAgentSessionMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 10,
      });
    });
    expect(setAgentThinkingMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 10,
      effort: "high",
    });
  });
});
