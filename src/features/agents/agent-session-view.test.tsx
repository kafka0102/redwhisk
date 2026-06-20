import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AgentStreamEventEnvelope } from "./agent-stream-types";
import { AgentSessionView } from "./agent-session-view";

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

const { readAgentTimeline, sendAgentMessage, listAgentModels } =
  await import("./agent-session-commands");
const readAgentTimelineMock = vi.mocked(readAgentTimeline);
const sendAgentMessageMock = vi.mocked(sendAgentMessage);
const listAgentModelsMock = vi.mocked(listAgentModels);

function setupTimeline(items: AgentStreamEventEnvelope["event"][]) {
  // readAgentTimeline 返回 AgentTimelineItem[]；测试用 user_message / assistant_message。
  readAgentTimelineMock.mockReset();
  readAgentTimelineMock.mockResolvedValue({
    items: items as never,
  });
  listAgentModelsMock.mockReset();
  listAgentModelsMock.mockResolvedValue({ models: [] });
  mocks.listeners.length = 0;
}

function emitEvent(payload: AgentStreamEventEnvelope) {
  act(() => {
    mocks.listeners[0]?.callback({ payload });
  });
}

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
    expect(screen.getByLabelText("Agent 会话消息流")).toBeInTheDocument();
    expect(screen.getByLabelText("输入消息")).toBeInTheDocument();
  });

  it("发送消息后乐观插入用户消息", async () => {
    setupTimeline([]);
    sendAgentMessageMock.mockReset();
    sendAgentMessageMock.mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<AgentSessionView projectId={1} sessionId={10} agentType="codex" />);

    await waitFor(() => {
      expect(screen.getByLabelText("输入消息")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("输入消息"), "测试消息{Enter}");

    expect(sendAgentMessageMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 10,
      message: "测试消息",
    });
    // 乐观插入：发送后立即在流中看到用户消息，不等后端回显。
    expect(screen.getByText("测试消息")).toBeInTheDocument();
  });

  it("permission_requested 事件到达后渲染权限卡片", async () => {
    setupTimeline([]);

    render(<AgentSessionView projectId={1} sessionId={10} agentType="codex" />);

    await waitFor(() => {
      expect(screen.getByLabelText("Agent 会话消息流")).toBeInTheDocument();
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
      await screen.findByLabelText("Agent 权限审批卡片"),
    ).toBeInTheDocument();
    expect(screen.getByText("Run command: ls")).toBeInTheDocument();
  });

  it("turn_started 事件后 composer 切换为取消按钮", async () => {
    setupTimeline([]);

    render(<AgentSessionView projectId={1} sessionId={10} agentType="codex" />);

    await waitFor(() => {
      expect(screen.getByLabelText("Agent 会话消息流")).toBeInTheDocument();
    });

    emitEvent({
      projectId: 1,
      sessionId: 10,
      seq: 1,
      epoch: "epoch-1",
      event: { type: "turn_started", turnId: "t1" },
    });

    expect(screen.getByText("正在思考…")).toBeInTheDocument();
  });

  it("claude agentType 时 composer 不渲染模型 Select", async () => {
    setupTimeline([]);

    render(
      <AgentSessionView projectId={1} sessionId={10} agentType="claude" />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("输入消息")).toBeInTheDocument();
    });

    expect(screen.queryByLabelText("选择模型")).not.toBeInTheDocument();
  });
});
