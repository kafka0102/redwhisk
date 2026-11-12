import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentStreamEventEnvelope } from "../agent-stream-types";
import { turnStatusForComposer } from "../message-stream/output-source";
import { AgentSessionView } from "./agent-session-view";
import {
  resetMessageStreamScrollOffsetCacheForTests,
  writeMessageStreamScrollOffset,
} from "../message-stream/message-stream-scroll-offset";
import { clearAgentMessageStreamCacheForTest } from "../message-stream/use-agent-message-stream";
import { clearComposerDraftCacheForTest } from "../composer/use-agent-composer";

// vi.hoisted 让 mock 工厂与测试体共享同一份可变 listeners，便于推送事件。
const mocks = vi.hoisted(() => ({
  listeners: [] as Array<{
    eventName: string;
    callback: (event: { payload: AgentStreamEventEnvelope }) => void;
  }>,
  unlisten: vi.fn(),
}));

const windowMocks = vi.hoisted(() => ({
  focusListener: null as ((event: { payload: boolean }) => void) | null,
  isFocused: vi.fn(async () => true),
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

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFocused: windowMocks.isFocused,
    onFocusChanged: (handler: (event: { payload: boolean }) => void) => {
      windowMocks.focusListener = handler;
      return Promise.resolve(windowMocks.unlisten);
    },
  }),
}));

vi.mock("../agent-session-commands", () => ({
  readAgentTimeline: vi.fn(),
  resumeAgentSession: vi.fn(),
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

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn().mockResolvedValue("/Users/tester"),
}));

const {
  readAgentTimeline,
  resumeAgentSession,
  sendAgentMessage,
  setAgentModel,
  setAgentThinking,
  listAgentModels,
} = await import("../agent-session-commands");
const readAgentTimelineMock = vi.mocked(readAgentTimeline);
const resumeAgentSessionMock = vi.mocked(resumeAgentSession);
const sendAgentMessageMock = vi.mocked(sendAgentMessage);
const setAgentModelMock = vi.mocked(setAgentModel);
const setAgentThinkingMock = vi.mocked(setAgentThinking);
const listAgentModelsMock = vi.mocked(listAgentModels);

function setupTimeline(items: AgentStreamEventEnvelope["event"][]) {
  // readAgentTimeline 返回 AgentTimelineItem[]；测试用 user_message / assistant_message。
  readAgentTimelineMock.mockReset();
  readAgentTimelineMock.mockResolvedValue({
    items: items as never,
    effort: null,
    model: null,
  });
  resumeAgentSessionMock.mockReset();
  resumeAgentSessionMock.mockResolvedValue({
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
  listAgentModelsMock.mockResolvedValue({
    capabilities: {
      modelTypeLabel: "Codex",
      canShowModel: true,
      supportsModelSwitching: true,
      supportsReasoningEffort: true,
      supportsModes: true,
      supportsTuiResume: false,
    },
    models: [],
  });
  mocks.listeners.length = 0;
}

function emitEvent(payload: AgentStreamEventEnvelope) {
  act(() => {
    mocks.listeners[0]?.callback({ payload });
  });
}

function mockScrollBox(
  element: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number },
) {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  let current = element.scrollTop;
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => current,
    set: (value: number) => {
      current = Math.min(
        Math.max(value, 0),
        Math.max(0, metrics.scrollHeight - metrics.clientHeight),
      );
    },
  });
}

function withScrollLayout(
  metrics: { clientHeight: number; scrollHeight: number },
  run: () => void,
): void {
  const host = HTMLElement.prototype;
  const previousClientHeight = Object.getOwnPropertyDescriptor(
    host,
    "clientHeight",
  );
  const previousScrollHeight = Object.getOwnPropertyDescriptor(
    host,
    "scrollHeight",
  );
  const previousScrollTop = Object.getOwnPropertyDescriptor(host, "scrollTop");
  const scrollTops = new WeakMap<Element, number>();
  Object.defineProperty(host, "clientHeight", {
    configurable: true,
    get: () => metrics.clientHeight,
  });
  Object.defineProperty(host, "scrollHeight", {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(host, "scrollTop", {
    configurable: true,
    get() {
      return scrollTops.get(this) ?? 0;
    },
    set(value: number) {
      const maxOffset = Math.max(
        0,
        metrics.scrollHeight - metrics.clientHeight,
      );
      const box = {
        value: Math.min(Math.max(value, 0), maxOffset),
      };
      Object.defineProperty(this, "scrollTop", {
        configurable: true,
        get: () => box.value,
        set: (next: number) => {
          box.value = Math.min(Math.max(next, 0), maxOffset);
        },
      });
    },
  });
  try {
    run();
  } finally {
    if (previousClientHeight) {
      Object.defineProperty(host, "clientHeight", previousClientHeight);
    } else {
      delete (host as { clientHeight?: number }).clientHeight;
    }
    if (previousScrollHeight) {
      Object.defineProperty(host, "scrollHeight", previousScrollHeight);
    } else {
      delete (host as { scrollHeight?: number }).scrollHeight;
    }
    if (previousScrollTop) {
      Object.defineProperty(host, "scrollTop", previousScrollTop);
    } else {
      delete (host as { scrollTop?: number }).scrollTop;
    }
  }
}

beforeEach(() => {
  clearAgentMessageStreamCacheForTest();
  windowMocks.focusListener = null;
  windowMocks.isFocused.mockReset();
  windowMocks.isFocused.mockResolvedValue(true);
  windowMocks.unlisten.mockClear();
});

afterEach(() => {
  clearAgentMessageStreamCacheForTest();
  clearComposerDraftCacheForTest();
  resetMessageStreamScrollOffsetCacheForTests();
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
      capabilities: {
        modelTypeLabel: "Codex",
        canShowModel: true,
        supportsModelSwitching: true,
        supportsReasoningEffort: true,
        supportsModes: true,
        supportsTuiResume: false,
      },
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
      ).toHaveTextContent("High");
    });
  });

  it("进入历史 session 时用 timeline 返回的 Think effort 初始化显示", async () => {
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [],
      effort: "high",
      model: null,
    });
    listAgentModelsMock.mockResolvedValueOnce({
      capabilities: {
        modelTypeLabel: "Codex",
        canShowModel: true,
        supportsModelSwitching: true,
        supportsReasoningEffort: true,
        supportsModes: true,
        supportsTuiResume: false,
      },
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
      ).toHaveTextContent("High");
    });
  });

  it("进入历史 session 时用 timeline 返回的 model 初始化显示，不跟列表 default", async () => {
    readAgentTimelineMock.mockResolvedValueOnce({
      items: [],
      effort: null,
      model: "gpt-5.2",
    });
    listAgentModelsMock.mockResolvedValueOnce({
      capabilities: {
        modelTypeLabel: "Codex",
        canShowModel: true,
        supportsModelSwitching: true,
        supportsReasoningEffort: true,
        supportsModes: true,
        supportsTuiResume: false,
      },
      models: [
        {
          modelId: "gpt-5.5",
          displayName: "GPT-5.5",
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
        {
          modelId: "gpt-5.2",
          displayName: "GPT-5.2",
          isDefault: false,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
      ],
    });

    render(<AgentSessionView projectId={1} sessionId={10} agentType="codex" />);

    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "Select model" }),
      ).toHaveTextContent("gpt-5.2");
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

    // turn_started 与 timeline 同序入队，按帧 flush 后才进入 running。
    expect(await screen.findByText("Thinking...")).toBeInTheDocument();
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

  it("已关闭或已完成的 session 不使用外部 isTurnRunning 强行显示运行态", async () => {
    setupTimeline([
      {
        type: "assistant_message",
        text: "最终结论",
        messageId: "a1",
      } as never,
    ]);

    render(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        sessionStatus="closed"
        issueStatus="completed"
        isTurnRunning={true}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("最终结论")).toBeInTheDocument();
    });
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  });

  it("claude agentType 时 composer 也请求模型列表（展示模型区域）", async () => {
    setupTimeline([]);

    render(
      <AgentSessionView projectId={1} sessionId={10} agentType="claude" />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: "Message input" }),
      ).toBeInTheDocument();
    });

    // Claude 现在也会展示模型：canShowModel=true，会请求模型列表。
    expect(listAgentModelsMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 10,
    });
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

  it("已完成 Issue 的 session 重挂载时恢复到记录的滚动位置", async () => {
    setupTimeline([
      { type: "assistant_message", text: "最终结论", messageId: "a1" } as never,
    ]);
    writeMessageStreamScrollOffset(10, 200);

    const { container } = render(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        sessionStatus="closed"
        issueStatus="completed"
      />,
    );
    // 在历史 timeline 到达前撑开滚动盒子，模拟真实布局。
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    mockScrollBox(scroll, { clientHeight: 100, scrollHeight: 500 });

    await waitFor(() => {
      expect(screen.getByText("最终结论")).toBeInTheDocument();
    });

    expect(scroll.scrollTop).toBe(200);
  });

  it("非运行态 session 切回时恢复记录位置，不定位到底部", async () => {
    setupTimeline([
      {
        type: "assistant_message",
        text: "已结束的结论",
        messageId: "a1",
      } as never,
    ]);
    writeMessageStreamScrollOffset(10, 200);

    const { container, rerender } = render(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        sessionStatus="closed"
        issueStatus="review"
        isActive={false}
      />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    mockScrollBox(scroll, { clientHeight: 100, scrollHeight: 500 });

    await waitFor(() => {
      expect(screen.getByText("已结束的结论")).toBeInTheDocument();
    });

    rerender(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        sessionStatus="closed"
        issueStatus="review"
        isActive
      />,
    );

    expect(scroll.scrollTop).toBe(200);
  });

  it("运行态 session 切回时仍定位到底部", async () => {
    setupTimeline([
      {
        type: "assistant_message",
        text: "运行中的输出",
        messageId: "a1",
      } as never,
    ]);
    writeMessageStreamScrollOffset(10, 200);

    const { container, rerender } = render(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        sessionStatus="running"
        issueStatus="review"
        isTurnRunning
        isActive={false}
      />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    mockScrollBox(scroll, { clientHeight: 100, scrollHeight: 500 });

    await waitFor(() => {
      expect(screen.getByText("运行中的输出")).toBeInTheDocument();
    });

    rerender(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        sessionStatus="running"
        issueStatus="review"
        isTurnRunning
      />,
    );

    expect(scroll.scrollTop).toBe(400);
  });

  it("不在运行的 Session 切回时停在离开前的位置", async () => {
    setupTimeline([
      {
        type: "assistant_message",
        text: "停在中间的结论",
        messageId: "a1",
      } as never,
    ]);

    const viewProps = {
      projectId: 1 as const,
      sessionId: 10,
      agentType: "codex" as const,
      sessionStatus: "running" as const,
      issueStatus: "review" as const,
      isTurnRunning: false,
    };

    const { container, rerender } = render(
      <AgentSessionView {...viewProps} isActive />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    const metrics = { clientHeight: 100, scrollHeight: 500 };
    mockScrollBox(scroll, metrics);

    await waitFor(() => {
      expect(screen.getByText("停在中间的结论")).toBeInTheDocument();
    });

    scroll.scrollTop = 200;
    fireEvent.scroll(scroll);
    expect(scroll.scrollTop).toBe(200);

    // 切到别的 Session 时视图不卸载，宿主 hidden 使滚动盒高度变为 0，
    // 浏览器把 scrollTop 读成 0。切回后高度恢复，位置必须回到离开前。
    metrics.clientHeight = 0;
    scroll.scrollTop = 0;
    rerender(<AgentSessionView {...viewProps} isActive={false} />);
    metrics.clientHeight = 100;
    rerender(<AgentSessionView {...viewProps} isActive />);

    expect(scroll.scrollTop).toBe(200);
    expect(scroll.scrollTop).not.toBe(0);
    expect(scroll.scrollTop).not.toBe(400);
  });

  it("不在运行的 Session 卸载再挂上时停在离开前的位置", async () => {
    setupTimeline([
      {
        type: "assistant_message",
        text: "切走前的结论",
        messageId: "a1",
      } as never,
    ]);

    const viewProps = {
      projectId: 1 as const,
      sessionId: 10,
      agentType: "codex" as const,
      sessionStatus: "running" as const,
      issueStatus: "review" as const,
      isTurnRunning: false,
    };

    const first = render(<AgentSessionView {...viewProps} isActive />);
    const firstScroll = first.container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    mockScrollBox(firstScroll, { clientHeight: 100, scrollHeight: 500 });

    await waitFor(() => {
      expect(screen.getByText("切走前的结论")).toBeInTheDocument();
    });

    firstScroll.scrollTop = 200;
    fireEvent.scroll(firstScroll);
    expect(firstScroll.scrollTop).toBe(200);

    first.unmount();

    let second: ReturnType<typeof render> | undefined;
    withScrollLayout({ clientHeight: 100, scrollHeight: 500 }, () => {
      second = render(<AgentSessionView {...viewProps} isActive />);
    });
    if (!second) {
      throw new Error("remount did not render");
    }
    const secondScroll = second.container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;

    await waitFor(() => {
      expect(screen.getByText("切走前的结论")).toBeInTheDocument();
    });

    expect(secondScroll.scrollTop).toBe(200);
    expect(secondScroll.scrollTop).not.toBe(0);
    expect(secondScroll.scrollTop).not.toBe(400);
  });

  it("不在运行的 Session 窗口失焦再聚焦时停在离开前的位置", async () => {
    setupTimeline([
      {
        type: "assistant_message",
        text: "失焦前的结论",
        messageId: "a1",
      } as never,
    ]);

    const { container } = render(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        sessionStatus="running"
        issueStatus="review"
        isTurnRunning={false}
        isActive
      />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    const metrics = { clientHeight: 100, scrollHeight: 500 };
    mockScrollBox(scroll, metrics);

    await waitFor(() => {
      expect(screen.getByText("失焦前的结论")).toBeInTheDocument();
    });
    await act(async () => {
      await Promise.resolve();
    });

    scroll.scrollTop = 200;
    fireEvent.scroll(scroll);
    expect(scroll.scrollTop).toBe(200);

    metrics.clientHeight = 0;
    scroll.scrollTop = 0;
    act(() => {
      windowMocks.focusListener?.({ payload: false });
    });
    metrics.clientHeight = 100;
    act(() => {
      windowMocks.focusListener?.({ payload: true });
    });

    expect(scroll.scrollTop).toBe(200);
    expect(scroll.scrollTop).not.toBe(0);
  });

  it("不在运行的 Session 切到其它标签再回到日志时停在离开前的位置", async () => {
    const resizeCallbacks: ResizeObserverCallback[] = [];
    const originalResizeObserver = globalThis.ResizeObserver;
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }

      observe(): void {}

      unobserve(): void {}

      disconnect(): void {}
    }
    globalThis.ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;

    try {
      setupTimeline([
        {
          type: "assistant_message",
          text: "切标签前的结论",
          messageId: "a1",
        } as never,
      ]);

      const { container } = render(
        <AgentSessionView
          projectId={1}
          sessionId={10}
          agentType="codex"
          sessionStatus="running"
          issueStatus="review"
          isTurnRunning={false}
          isActive
        />,
      );
      const scroll = container.querySelector(
        ".agents-message-stream__scroll",
      ) as HTMLElement;
      const metrics = { clientHeight: 100, scrollHeight: 500 };
      mockScrollBox(scroll, metrics);

      await waitFor(() => {
        expect(screen.getByText("切标签前的结论")).toBeInTheDocument();
      });

      scroll.scrollTop = 200;
      fireEvent.scroll(scroll);
      expect(scroll.scrollTop).toBe(200);

      metrics.clientHeight = 0;
      scroll.scrollTop = 0;
      act(() => {
        for (const callback of resizeCallbacks) {
          callback([], {} as ResizeObserver);
        }
      });
      metrics.clientHeight = 100;
      act(() => {
        for (const callback of resizeCallbacks) {
          callback([], {} as ResizeObserver);
        }
      });

      expect(scroll.scrollTop).toBe(200);
      expect(scroll.scrollTop).not.toBe(0);
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("正在运行的 Session 切到别的 Session 再回来时定位到底部", async () => {
    setupTimeline([
      {
        type: "assistant_message",
        text: "运行中的输出",
        messageId: "a1",
      } as never,
    ]);

    const viewProps = {
      projectId: 1 as const,
      sessionId: 10,
      agentType: "codex" as const,
      sessionStatus: "running" as const,
      issueStatus: "review" as const,
      isTurnRunning: true,
    };

    const { container, rerender } = render(
      <AgentSessionView {...viewProps} isActive />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    const metrics = { clientHeight: 100, scrollHeight: 500 };
    mockScrollBox(scroll, metrics);

    await waitFor(() => {
      expect(screen.getByText("运行中的输出")).toBeInTheDocument();
    });

    scroll.scrollTop = 200;
    fireEvent.scroll(scroll);
    expect(scroll.scrollTop).toBe(200);

    metrics.clientHeight = 0;
    scroll.scrollTop = 0;
    rerender(<AgentSessionView {...viewProps} isActive={false} />);
    metrics.clientHeight = 100;
    rerender(<AgentSessionView {...viewProps} isActive />);

    expect(scroll.scrollTop).toBe(400);
    expect(scroll.scrollTop).not.toBe(200);
  });

  it("正在运行的 Session 卸载再挂上时定位到底部", async () => {
    setupTimeline([
      {
        type: "assistant_message",
        text: "运行中的输出",
        messageId: "a1",
      } as never,
    ]);

    const viewProps = {
      projectId: 1 as const,
      sessionId: 10,
      agentType: "codex" as const,
      sessionStatus: "running" as const,
      issueStatus: "review" as const,
      isTurnRunning: true,
    };

    const first = render(<AgentSessionView {...viewProps} isActive />);
    const firstScroll = first.container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    mockScrollBox(firstScroll, { clientHeight: 100, scrollHeight: 500 });

    await waitFor(() => {
      expect(screen.getByText("运行中的输出")).toBeInTheDocument();
    });
    firstScroll.scrollTop = 200;
    fireEvent.scroll(firstScroll);
    expect(firstScroll.scrollTop).toBe(200);
    first.unmount();

    let second: ReturnType<typeof render> | undefined;
    withScrollLayout({ clientHeight: 100, scrollHeight: 500 }, () => {
      second = render(<AgentSessionView {...viewProps} isActive />);
    });
    if (!second) {
      throw new Error("remount did not render");
    }
    const secondScroll = second.container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;

    await waitFor(() => {
      expect(screen.getByText("运行中的输出")).toBeInTheDocument();
    });

    expect(secondScroll.scrollTop).toBe(400);
    expect(secondScroll.scrollTop).not.toBe(200);
  });

  it("正在运行的 Session 窗口失焦再聚焦时定位到底部", async () => {
    setupTimeline([
      {
        type: "assistant_message",
        text: "运行中的输出",
        messageId: "a1",
      } as never,
    ]);

    const { container } = render(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        sessionStatus="running"
        issueStatus="review"
        isTurnRunning
        isActive
      />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    const metrics = { clientHeight: 100, scrollHeight: 500 };
    mockScrollBox(scroll, metrics);

    await waitFor(() => {
      expect(screen.getByText("运行中的输出")).toBeInTheDocument();
    });
    await act(async () => {
      await Promise.resolve();
    });

    scroll.scrollTop = 200;
    fireEvent.scroll(scroll);
    expect(scroll.scrollTop).toBe(200);

    metrics.clientHeight = 0;
    scroll.scrollTop = 0;
    act(() => {
      windowMocks.focusListener?.({ payload: false });
    });
    metrics.clientHeight = 100;
    act(() => {
      windowMocks.focusListener?.({ payload: true });
    });

    expect(scroll.scrollTop).toBe(400);
    expect(scroll.scrollTop).not.toBe(200);
  });

  it("正在运行的 Session 切到其它标签再回到日志时定位到底部", async () => {
    const resizeCallbacks: ResizeObserverCallback[] = [];
    const originalResizeObserver = globalThis.ResizeObserver;
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }

      observe(): void {}

      unobserve(): void {}

      disconnect(): void {}
    }
    globalThis.ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;

    try {
      setupTimeline([
        {
          type: "assistant_message",
          text: "运行中的输出",
          messageId: "a1",
        } as never,
      ]);

      const { container } = render(
        <AgentSessionView
          projectId={1}
          sessionId={10}
          agentType="codex"
          sessionStatus="running"
          issueStatus="review"
          isTurnRunning
          isActive
        />,
      );
      const scroll = container.querySelector(
        ".agents-message-stream__scroll",
      ) as HTMLElement;
      const metrics = { clientHeight: 100, scrollHeight: 500 };
      mockScrollBox(scroll, metrics);

      await waitFor(() => {
        expect(screen.getByText("运行中的输出")).toBeInTheDocument();
      });

      scroll.scrollTop = 200;
      fireEvent.scroll(scroll);
      expect(scroll.scrollTop).toBe(200);

      metrics.clientHeight = 0;
      scroll.scrollTop = 0;
      act(() => {
        for (const callback of resizeCallbacks) {
          callback([], {} as ResizeObserver);
        }
      });
      metrics.clientHeight = 100;
      act(() => {
        for (const callback of resizeCallbacks) {
          callback([], {} as ResizeObserver);
        }
      });

      expect(scroll.scrollTop).toBe(400);
      expect(scroll.scrollTop).not.toBe(200);
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("人还停在页面上时，不在运行的重渲染仍停在离开前的位置", async () => {
    setupTimeline([
      {
        type: "assistant_message",
        text: "停在中间的结论",
        messageId: "a1",
      } as never,
    ]);

    const viewProps = {
      projectId: 1 as const,
      sessionId: 10,
      agentType: "codex" as const,
      sessionStatus: "running" as const,
      issueStatus: "review" as const,
      isTurnRunning: false,
    };
    const { container, rerender } = render(
      <AgentSessionView {...viewProps} isActive />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    mockScrollBox(scroll, { clientHeight: 100, scrollHeight: 500 });

    await waitFor(() => {
      expect(screen.getByText("停在中间的结论")).toBeInTheDocument();
    });
    scroll.scrollTop = 200;
    fireEvent.scroll(scroll);

    rerender(
      <AgentSessionView {...viewProps} isActive workspacePath="/tmp/repo" />,
    );

    expect(scroll.scrollTop).toBe(200);
    expect(scroll.scrollTop).not.toBe(0);
    expect(scroll.scrollTop).not.toBe(400);
  });

  it("人还停在页面上时，正在运行的新内容不把阅读位置拽到底部", async () => {
    setupTimeline([
      {
        type: "assistant_message",
        text: "运行中的输出",
        messageId: "a1",
      } as never,
    ]);

    const { container } = render(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        sessionStatus="running"
        issueStatus="review"
        isTurnRunning
        isActive
      />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    const metrics = { clientHeight: 100, scrollHeight: 500 };
    mockScrollBox(scroll, metrics);

    await waitFor(() => {
      expect(screen.getByText("运行中的输出")).toBeInTheDocument();
    });
    scroll.scrollTop = 200;
    fireEvent.scroll(scroll);
    expect(scroll.scrollTop).toBe(200);

    metrics.scrollHeight = 800;
    emitEvent({
      projectId: 1,
      sessionId: 10,
      seq: 2,
      epoch: "epoch-1",
      event: {
        type: "timeline",
        seq: 2,
        timestamp: 2,
        item: {
          type: "assistant_message",
          text: "新的一行",
          messageId: "a2",
        },
      } as never,
    });

    await waitFor(() => {
      expect(screen.getByText("新的一行")).toBeInTheDocument();
    });
    expect(scroll.scrollTop).toBe(200);
    expect(scroll.scrollTop).not.toBe(400);
  });

  it("不在运行时，容器高度为 0 的滚动不覆盖离开前的位置", async () => {
    const resizeCallbacks: ResizeObserverCallback[] = [];
    const originalResizeObserver = globalThis.ResizeObserver;
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }

      observe(): void {}

      unobserve(): void {}

      disconnect(): void {}
    }
    globalThis.ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;

    try {
      setupTimeline([
        {
          type: "assistant_message",
          text: "停在中间的结论",
          messageId: "a1",
        } as never,
      ]);

      const { container } = render(
        <AgentSessionView
          projectId={1}
          sessionId={10}
          agentType="codex"
          sessionStatus="running"
          issueStatus="review"
          isTurnRunning={false}
          isActive
        />,
      );
      const scroll = container.querySelector(
        ".agents-message-stream__scroll",
      ) as HTMLElement;
      const metrics = { clientHeight: 100, scrollHeight: 500 };
      mockScrollBox(scroll, metrics);

      await waitFor(() => {
        expect(screen.getByText("停在中间的结论")).toBeInTheDocument();
      });
      scroll.scrollTop = 200;
      fireEvent.scroll(scroll);
      expect(scroll.scrollTop).toBe(200);

      metrics.clientHeight = 0;
      scroll.scrollTop = 0;
      fireEvent.scroll(scroll);
      act(() => {
        for (const callback of resizeCallbacks) {
          callback([], {} as ResizeObserver);
        }
      });
      metrics.clientHeight = 100;
      act(() => {
        for (const callback of resizeCallbacks) {
          callback([], {} as ResizeObserver);
        }
      });

      expect(scroll.scrollTop).toBe(200);
      expect(scroll.scrollTop).not.toBe(0);
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("不在运行时，内容增高后回到尚未到达的记录位置", async () => {
    writeMessageStreamScrollOffset(10, 900);
    setupTimeline([
      {
        type: "assistant_message",
        text: "先到的一段",
        messageId: "a1",
      } as never,
    ]);

    const { container } = render(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        sessionStatus="running"
        issueStatus="review"
        isTurnRunning={false}
        isActive
      />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    const metrics = { clientHeight: 100, scrollHeight: 500 };
    mockScrollBox(scroll, metrics);

    await waitFor(() => {
      expect(screen.getByText("先到的一段")).toBeInTheDocument();
    });
    expect(scroll.scrollTop).toBe(400);

    metrics.scrollHeight = 2000;
    emitEvent({
      projectId: 1,
      sessionId: 10,
      seq: 2,
      epoch: "epoch-1",
      event: {
        type: "timeline",
        seq: 2,
        timestamp: 2,
        item: {
          type: "assistant_message",
          text: "随后增高的正文",
          messageId: "a2",
        },
      } as never,
    });

    await waitFor(() => {
      expect(screen.getByText("随后增高的正文")).toBeInTheDocument();
    });
    expect(scroll.scrollTop).toBe(900);
    expect(scroll.scrollTop).not.toBe(400);
    expect(scroll.scrollTop).not.toBe(0);
  });

  it("不在运行时，离开期间补上的正文不改变回来后的位置", async () => {
    setupTimeline([
      {
        type: "assistant_message",
        text: "离开前的正文",
        messageId: "a1",
      } as never,
    ]);

    const viewProps = {
      projectId: 1 as const,
      sessionId: 10,
      agentType: "codex" as const,
      sessionStatus: "running" as const,
      issueStatus: "review" as const,
      isTurnRunning: false,
    };
    const { container, rerender } = render(
      <AgentSessionView {...viewProps} isActive />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    const metrics = { clientHeight: 100, scrollHeight: 500 };
    mockScrollBox(scroll, metrics);

    await waitFor(() => {
      expect(screen.getByText("离开前的正文")).toBeInTheDocument();
    });
    scroll.scrollTop = 200;
    fireEvent.scroll(scroll);
    expect(scroll.scrollTop).toBe(200);

    metrics.clientHeight = 0;
    scroll.scrollTop = 0;
    rerender(<AgentSessionView {...viewProps} isActive={false} />);

    metrics.scrollHeight = 800;
    emitEvent({
      projectId: 1,
      sessionId: 10,
      seq: 2,
      epoch: "epoch-1",
      event: {
        type: "timeline",
        seq: 2,
        timestamp: 2,
        item: {
          type: "assistant_message",
          text: "离开期间的正文",
          messageId: "a2",
        },
      } as never,
    });
    await waitFor(() => {
      expect(screen.getByText("离开期间的正文")).toBeInTheDocument();
    });

    metrics.clientHeight = 100;
    rerender(<AgentSessionView {...viewProps} isActive />);

    expect(scroll.scrollTop).toBe(200);
    expect(scroll.scrollTop).not.toBe(0);
    expect(scroll.scrollTop).not.toBe(700);
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
    resumeAgentSessionMock.mockResolvedValueOnce({
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
      expect(resumeAgentSessionMock).toHaveBeenCalledWith({
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
      capabilities: {
        modelTypeLabel: "Codex",
        canShowModel: true,
        supportsModelSwitching: true,
        supportsReasoningEffort: true,
        supportsModes: true,
        supportsTuiResume: false,
      },
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
    resumeAgentSessionMock.mockResolvedValueOnce({
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
    await user.click(await screen.findByRole("option", { name: "gpt-4o" }));

    await waitFor(() => {
      expect(resumeAgentSessionMock).toHaveBeenCalledWith({
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
      capabilities: {
        modelTypeLabel: "Codex",
        canShowModel: true,
        supportsModelSwitching: true,
        supportsReasoningEffort: true,
        supportsModes: true,
        supportsTuiResume: false,
      },
      models: [
        {
          modelId: "gpt-5",
          displayName: "GPT-5",
          isDefault: true,
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
      ],
    });
    resumeAgentSessionMock.mockResolvedValueOnce({
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
    await user.click(await screen.findByRole("option", { name: "High" }));

    await waitFor(() => {
      expect(resumeAgentSessionMock).toHaveBeenCalledWith({
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

describe("AgentSessionView 输出来源", () => {
  const rosterItems = [
    {
      type: "tool_call",
      callId: "spawn",
      name: "collabAgentToolCall",
      status: "completed",
      detail: {
        type: "collab_agent",
        prompt: "检查日志",
        receiverThreadIds: ["thr_a"],
        senderThreadId: "thr_parent",
      },
    },
    {
      type: "assistant_message",
      text: "子路正文",
      messageId: "m1",
      subagentId: "thr_a",
    },
  ] as never[];

  it("重新挂载后选中档回到全部，会话不在运行时显示已结束", async () => {
    setupTimeline(rosterItems);
    const user = userEvent.setup();
    const first = render(
      <AgentSessionView projectId={1} sessionId={10} agentType="codex" />,
    );
    const source = await screen.findByRole("combobox", {
      name: "Output source",
    });
    expect(source).toHaveTextContent("All");
    await user.click(source);
    await user.click(
      await screen.findByRole("option", { name: /检查日志 · Ended/ }),
    );
    expect(
      screen.getByRole("combobox", { name: "Output source" }),
    ).toHaveTextContent("检查日志 · Ended");

    first.unmount();
    render(<AgentSessionView projectId={1} sessionId={10} agentType="codex" />);
    expect(
      await screen.findByRole("combobox", { name: "Output source" }),
    ).toHaveTextContent("All");
  });

  it("运行中的 Turn 显示运行中，子智能体结束后仍停在这一档", async () => {
    setupTimeline(rosterItems);
    const user = userEvent.setup();
    render(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        sessionStatus="running"
        isTurnRunning
      />,
    );
    const source = await screen.findByRole("combobox", {
      name: "Output source",
    });
    expect(source).toHaveTextContent("All");
    await user.click(source);
    await user.click(
      await screen.findByRole("option", { name: /检查日志 · Running/ }),
    );
    expect(
      screen.getByRole("combobox", { name: "Output source" }),
    ).toHaveTextContent("检查日志 · Running");

    emitEvent({
      projectId: 1,
      sessionId: 10,
      seq: 1,
      epoch: "epoch-1",
      event: {
        type: "timeline",
        seq: 1,
        timestamp: 1,
        item: { type: "subagent_roster", subagentId: "thr_a", status: "ended" },
      },
    });

    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "Output source" }),
      ).toHaveTextContent("检查日志 · Ended");
    });
    expect(
      screen.getByRole("combobox", { name: "Output source" }),
    ).not.toHaveTextContent("All");
    expect(screen.getByText("子路正文")).toBeInTheDocument();
  });

  it("Grok json 花名册没有任务描述时用子智能体序号切换消息流", async () => {
    setupTimeline([
      {
        type: "assistant_message",
        text: "主路正文",
        messageId: "parent",
      } as never,
      {
        type: "subagent_roster",
        subagentId: "child-session",
        status: "ended",
      } as never,
      {
        type: "assistant_message",
        text: "子路正文",
        messageId: "child",
        subagentId: "child-session",
      } as never,
    ]);
    const user = userEvent.setup();
    const first = render(
      <AgentSessionView projectId={1} sessionId={10} agentType="grok" />,
    );

    const source = await screen.findByRole("combobox", {
      name: "Output source",
    });
    expect(source).toHaveTextContent("All");
    await user.click(source);
    expect(
      await screen.findByRole("option", { name: "Main agent" }),
    ).toBeInTheDocument();
    await user.click(
      await screen.findByRole("option", { name: "Subagent 1 · Ended" }),
    );

    expect(screen.getByText("子路正文")).toBeInTheDocument();
    expect(screen.queryByText("主路正文")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Output source" }));
    await user.click(await screen.findByRole("option", { name: "Main agent" }));
    expect(screen.getByText("主路正文")).toBeInTheDocument();
    expect(screen.queryByText("子路正文")).not.toBeInTheDocument();

    first.unmount();
    render(<AgentSessionView projectId={1} sessionId={10} agentType="grok" />);
    expect(
      await screen.findByRole("combobox", { name: "Output source" }),
    ).toHaveTextContent("All");
  });

  it("Grok json 没有子智能体时不出现输出来源 select", async () => {
    setupTimeline([
      {
        type: "assistant_message",
        text: "只有主路",
        messageId: "parent",
      } as never,
    ]);

    render(<AgentSessionView projectId={1} sessionId={10} agentType="grok" />);

    await screen.findByText("只有主路");
    expect(
      screen.queryByRole("combobox", { name: "Output source" }),
    ).not.toBeInTheDocument();
  });
});

describe("turnStatusForComposer", () => {
  it("父 Turn 已结束但子智能体仍在跑时保留停止按钮", () => {
    expect(
      turnStatusForComposer("idle", [
        { id: "thr_live", prompt: "/root/fact", ended: false, live: true },
      ]),
    ).toBe("running");
    expect(
      turnStatusForComposer("idle", [
        { id: "thr_done", prompt: null, ended: true, live: false },
      ]),
    ).toBe("idle");
    expect(turnStatusForComposer("canceled", [])).toBe("canceled");
  });
});

describe("AgentSessionView 本地文件链接", () => {
  it("助手消息里的工作区相对路径点击后带本 session id 调用 openFilePath", async () => {
    setupTimeline([
      {
        type: "assistant_message",
        text: "改动见 [a.ts](./src/app/a.ts)。",
        messageId: "a1",
      } as never,
    ]);
    const onOpenFilePath = vi.fn();
    const user = userEvent.setup();

    render(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        onOpenFilePath={onOpenFilePath}
        workspacePath="/Users/tester/repo"
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Open file src/app/a.ts",
      }),
    );

    expect(onOpenFilePath).toHaveBeenCalledWith(10, "src/app/a.ts");
  });

  it("~/ 路径用解析出的 home 目录收成工作区相对路径后再打开", async () => {
    setupTimeline([
      {
        type: "assistant_message",
        text: "改动见 [a.ts](~/repo/src/app/a.ts)。",
        messageId: "a1",
      } as never,
    ]);
    const onOpenFilePath = vi.fn();
    const user = userEvent.setup();

    render(
      <AgentSessionView
        projectId={1}
        sessionId={10}
        agentType="codex"
        onOpenFilePath={onOpenFilePath}
        workspacePath="/Users/tester/repo"
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Open file src/app/a.ts",
      }),
    );

    expect(onOpenFilePath).toHaveBeenCalledWith(10, "src/app/a.ts");
  });
});
