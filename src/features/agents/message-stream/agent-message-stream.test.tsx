import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentMessageStream,
  AgentMessageStreamView,
} from "./agent-message-stream";
import {
  readMessageStreamScrollOffset,
  resetMessageStreamScrollOffsetCacheForTests,
  writeMessageStreamScrollOffset,
} from "./message-stream-scroll-offset";
import type {
  AgentStreamEvent,
  AgentTimelineItem,
  TimelineHistoryItem,
} from "../agent-stream-types";
import type { MessageStreamState } from "./message-stream-types";
import {
  createInitialState,
  messageStreamReducer,
} from "./message-stream-reducer";
import type { SessionFileLinks } from "./session-file-links";
import { clearAgentMessageStreamCacheForTest } from "./use-agent-message-stream";
import { clearWorkspaceFileExistenceCacheForTest } from "./use-workspace-file-existence";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));

vi.mock("../agent-session-commands", () => ({
  readAgentTimeline: vi.fn(),
}));

vi.mock("../../../shared/workspace/workspace-commands", () => ({
  statProjectWorktreeFile: vi.fn(() => Promise.reject(new Error("not found"))),
}));

vi.mock("../../../shared/commands/copy-text-to-clipboard", () => ({
  copyTextToClipboard: vi.fn(async () => true),
}));

vi.mock("../../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const { readAgentTimeline } = await import("../agent-session-commands");
const readAgentTimelineMock = vi.mocked(readAgentTimeline);

const { statProjectWorktreeFile } =
  await import("../../../shared/workspace/workspace-commands");
const statProjectWorktreeFileMock = vi.mocked(statProjectWorktreeFile);

const { copyTextToClipboard } =
  await import("../../../shared/commands/copy-text-to-clipboard");
const copyTextToClipboardMock = vi.mocked(copyTextToClipboard);

const { toast } = await import("../../../shared/toast");

/**
 * 多数用例只验证滚动位置 / 状态渲染：给消息流一个不产生副作用的文件链接能力，
 * 使新增的必填 prop 不必在每个用例里重复展开。
 */
const STREAM_FILE_LINKS: SessionFileLinks = {
  projectId: 1,
  sessionId: 1,
  workspacePath: null,
  homePath: null,
  openFilePath: () => {},
};

function historyItems(items: AgentTimelineItem[]): TimelineHistoryItem[] {
  return items.map((item) => ({ item }));
}

function setupStream(items: AgentTimelineItem[]) {
  readAgentTimelineMock.mockReset();
  readAgentTimelineMock.mockResolvedValue({
    items: historyItems(items),
    effort: null,
    model: null,
  });
}

function timelineEvent(
  item: Extract<AgentStreamEvent, { type: "timeline" }>["item"],
): AgentStreamEvent {
  return { type: "timeline", item, seq: 1, timestamp: 0 };
}

function createMessageStreamState(
  overrides: Partial<MessageStreamState> = {},
): MessageStreamState {
  return {
    entries: [],
    turnStatus: "idle",
    usage: null,
    pendingPermissions: [],
    mode: null,
    model: null,
    effort: null,
    lastSeq: null,
    lastError: null,
    turnInterrupted: false,
    interruptedStopReason: null,
    subagentInterrupted: false,
    subagents: [],
    isInitialized: true,
    expandedEntryIds: [],
    entryLoadErrors: {},
    ...overrides,
  };
}

afterEach(() => {
  clearAgentMessageStreamCacheForTest();
  resetMessageStreamScrollOffsetCacheForTests();
});

beforeEach(() => {
  statProjectWorktreeFileMock.mockReset();
  statProjectWorktreeFileMock.mockImplementation(() =>
    Promise.reject(new Error("not found")),
  );
  clearWorkspaceFileExistenceCacheForTest();
  copyTextToClipboardMock.mockReset();
  copyTextToClipboardMock.mockResolvedValue(true);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("AgentMessageStream", () => {
  it("加载完成且无消息时显示空态文案", async () => {
    setupStream([]);
    render(<AgentMessageStream projectId={1} sessionId={1} />);
    await waitFor(() => {
      expect(
        screen.getByText("Send a message to start the conversation."),
      ).toBeInTheDocument();
    });
  });

  it("readAgentTimeline 返回历史消息时渲染卡片", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([
        { type: "user_message", text: "你好", messageId: "u1" },
        { type: "assistant_message", text: "你好！", messageId: "a1" },
      ]),
      effort: null,
      model: null,
    });
    render(<AgentMessageStream projectId={1} sessionId={2} />);
    await waitFor(() => {
      expect(screen.getByText("你好")).toBeInTheDocument();
    });
    expect(screen.getByText("你好！")).toBeInTheDocument();
  });

  it("运行指示器位于消息滚动栈内并跟随消息卡片之后", () => {
    const { container } = render(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        state={createMessageStreamState({
          entries: [
            {
              id: "u1",
              kind: "user_message",
              item: {
                type: "user_message",
                text: "开始处理",
                messageId: "u1",
              },
            },
          ],
          turnStatus: "running",
        })}
      />,
    );

    const scroll = container.querySelector(".agents-message-stream__scroll");
    const messageCard = screen
      .getByText("开始处理")
      .closest(".agents-message__entry") as HTMLElement | null;
    const running = screen
      .getByText("Thinking...")
      .closest(".agents-message-stream__running") as HTMLElement | null;

    expect(scroll).toContainElement(running);
    expect(running?.parentElement).toHaveClass(
      "agents-message__entry",
      "agents-message__entry--running",
    );
    expect(messageCard?.compareDocumentPosition(running!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("异常中断且携带 stop_reason 时渲染提示条", () => {
    render(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        state={createMessageStreamState({
          turnInterrupted: true,
          interruptedStopReason: "max_tokens",
        })}
      />,
    );
    expect(
      screen.getByText(
        "This turn may not have finished normally (interrupted, stop_reason: max_tokens). Send a message to continue.",
      ),
    ).toBeInTheDocument();
  });

  it("异常中断且无 stop_reason 时渲染无原因提示条", () => {
    render(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        state={createMessageStreamState({
          turnInterrupted: true,
          interruptedStopReason: null,
        })}
      />,
    );
    expect(
      screen.getByText(
        "This turn may not have finished normally (interrupted). Send a message to continue.",
      ),
    ).toBeInTheDocument();
  });

  it("渲染 reasoning 折叠区", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([{ type: "reasoning", text: "我先想想" }]),
      effort: null,
      model: null,
    });
    render(<AgentMessageStream projectId={1} sessionId={3} />);
    await waitFor(() => {
      expect(screen.getByText("Thought process")).toBeInTheDocument();
    });
    const details = screen
      .getByText("Thought process")
      .closest("details") as HTMLDetailsElement | null;
    expect(details?.open).toBe(false);
    expect(screen.getByText("我先想想")).toBeInTheDocument();
  });

  it("渲染 tool_call 卡片并由工具行展开详情", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([
        {
          type: "tool_call",
          callId: "c1",
          name: "shell",
          detail: {
            type: "shell",
            command: "ls -la",
            output: "file.txt",
            exitCode: 0,
          },
          status: "completed",
        },
      ]),
      effort: null,
      model: null,
    });
    render(<AgentMessageStream projectId={1} sessionId={4} />);
    await waitFor(() => {
      expect(screen.getByText("Shell")).toBeInTheDocument();
    });
    expect(screen.getAllByText(/ls -la/)).toHaveLength(1);
    expect(screen.queryByText("完成")).not.toBeInTheDocument();
    expect(screen.queryByText("Shell details")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Shell"));

    expect(screen.getAllByText(/ls -la/)).toHaveLength(2);
    const output = screen.getByText("file.txt");
    const details = output.closest("details") as HTMLDetailsElement | null;
    expect(details?.open).toBe(true);
    expect(screen.getByText("exit 0")).toBeInTheDocument();
  });

  it("展开工具行前不挂载大块输出内容", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([
        {
          type: "tool_call",
          callId: "c1",
          name: "shell",
          detail: {
            type: "shell",
            command: "cat large.log",
            output: "大量输出内容",
            exitCode: 0,
          },
          status: "completed",
        },
      ]),
      effort: null,
      model: null,
    });
    render(<AgentMessageStream projectId={1} sessionId={13} />);
    await waitFor(() => {
      expect(screen.getByText("Shell")).toBeInTheDocument();
    });

    expect(screen.queryByText("大量输出内容")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Shell"));

    expect(screen.getByText("大量输出内容")).toBeInTheDocument();
    expect(screen.getByText("exit 0")).toBeInTheDocument();
  });

  it("展开工具行时截断过长输出内容", async () => {
    const longOutput = `${"a".repeat(20_000)}TAIL`;
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([
        {
          type: "tool_call",
          callId: "c-long",
          name: "shell",
          detail: {
            type: "shell",
            command: "cat huge.log",
            output: longOutput,
            exitCode: 0,
          },
          status: "completed",
        },
      ]),
      effort: null,
      model: null,
    });

    render(<AgentMessageStream projectId={1} sessionId={11} />);
    await waitFor(() => {
      expect(screen.getByText("Shell")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Shell"));

    expect(screen.getByText(/^a+$/)).toHaveTextContent("a".repeat(20_000));
    expect(screen.queryByText(/TAIL/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Output truncated to 20000 of 20004 characters."),
    ).toBeInTheDocument();
  });

  it("按文件扩展名渲染 Edit diff 的语法高亮和新增删除背景", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([
        {
          type: "tool_call",
          callId: "edit-1",
          name: "edit",
          detail: {
            type: "edit",
            path: "/tmp/component.tsx",
            diff: [
              "@@ -1,2 +1,2 @@",
              '- const label = "Old";',
              '+ const label = "New";',
            ].join("\n"),
          },
          status: "completed",
        },
      ]),
      effort: null,
      model: null,
    });
    const { container } = render(
      <AgentMessageStream projectId={1} sessionId={14} />,
    );
    await waitFor(() => {
      expect(screen.getByText("Edit")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Edit"));

    const code = container.querySelector(".agents-message__diff-code");
    expect(code).toHaveAttribute("data-language", "tsx");
    expect(
      container.querySelector(
        '.agents-message__diff-line[data-line-kind="add"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '.agents-message__diff-line[data-line-kind="delete"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(".agents-message__syntax--keyword"),
    ).toHaveTextContent("const");
    expect(
      container.querySelector(".agents-message__syntax--string"),
    ).toHaveTextContent('"Old"');
  });

  it("隐藏无输出的 shell 详情折叠区", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([
        {
          type: "tool_call",
          callId: "c1",
          name: "shell",
          detail: {
            type: "shell",
            command: "git status",
          },
          status: "running",
        },
      ]),
      effort: null,
      model: null,
    });
    const { container } = render(
      <AgentMessageStream projectId={1} sessionId={10} />,
    );
    await waitFor(() => {
      expect(screen.getByText("Shell")).toBeInTheDocument();
    });
    expect(screen.getByText(/git status/)).toBeInTheDocument();
    expect(container.querySelector("details")).toBeNull();
  });

  it("渲染搜索工具的可展开查询内容和 URL 结果", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([
        {
          type: "tool_call",
          callId: "search-1",
          name: "web_search",
          detail: {
            type: "search",
            query: "Claude 最新模型",
            mode: "content",
            matches: [
              "Anthropic models https://docs.anthropic.com/en/docs/about-claude/models/overview",
            ],
          },
          status: "completed",
        },
      ]),
      effort: null,
      model: null,
    });
    render(<AgentMessageStream projectId={1} sessionId={11} />);
    await waitFor(() => {
      expect(screen.getByText("Search")).toBeInTheDocument();
    });
    expect(
      screen.queryByText("Search details and 1 result"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Claude 最新模型")).toHaveLength(1);

    fireEvent.click(screen.getByText("Search"));

    const queryTexts = screen.getAllByText("Claude 最新模型");
    expect(queryTexts).toHaveLength(2);
    const details = queryTexts[1]?.closest(
      "details",
    ) as HTMLDetailsElement | null;
    expect(details?.open).toBe(true);
    expect(screen.getByText("Mode")).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://docs.anthropic.com/en/docs/about-claude/models/overview",
    );
  });

  it("兼容旧 unknown webSearch 工具并在摘要显示 query", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([
        {
          type: "tool_call",
          callId: "legacy-search-1",
          name: "webSearch",
          detail: {
            type: "unknown",
            rawOutput: JSON.stringify({
              action: { type: "search", query: "weather: Beijing" },
            }),
          },
          status: "completed",
        },
      ]),
      effort: null,
      model: null,
    });
    render(<AgentMessageStream projectId={1} sessionId={12} />);
    await waitFor(() => {
      expect(screen.getByText("Search")).toBeInTheDocument();
    });
    expect(screen.getByText("weather: Beijing")).toBeInTheDocument();
    expect(screen.queryByText("Tool details")).not.toBeInTheDocument();
    const details = screen
      .getByText("weather: Beijing")
      .closest("details") as HTMLDetailsElement | null;
    expect(details?.open).toBe(false);
  });

  it("把 TaskUpdate unknown 工具渲染为带图标的任务状态更新卡片", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([
        {
          type: "tool_call",
          callId: "task-update-1",
          name: "TaskUpdate",
          detail: {
            type: "unknown",
            rawInput: JSON.stringify({
              taskId: "5",
              status: "completed",
            }),
            rawOutput: "Updated task #5 status",
          },
          status: "completed",
        },
      ]),
      effort: null,
      model: null,
    });
    const { container } = render(
      <AgentMessageStream projectId={1} sessionId={15} />,
    );
    await waitFor(() => {
      expect(screen.getByText("Task")).toBeInTheDocument();
    });
    expect(screen.getByText("Task #5 -> completed")).toBeInTheDocument();
    expect(
      container.querySelector(".agents-message__tool-icon svg"),
    ).not.toBeNull();

    fireEvent.click(screen.getByText("Task"));

    expect(
      screen.getByText("Updated task #5 status to completed."),
    ).toBeInTheDocument();
  });

  it("渲染 todo 清单", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([
        {
          type: "todo",
          items: [
            { text: "任务一", completed: true },
            { text: "任务二", completed: false },
          ],
        },
      ]),
      effort: null,
      model: null,
    });
    render(<AgentMessageStream projectId={1} sessionId={5} />);
    await waitFor(() => {
      expect(screen.getByText("Todo list")).toBeInTheDocument();
    });
    expect(screen.getByText("任务一")).toBeInTheDocument();
    expect(screen.getByText("任务二")).toBeInTheDocument();
  });

  it("渲染 error 卡片", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([{ type: "error", message: "出错了" }]),
      effort: null,
      model: null,
    });
    render(<AgentMessageStream projectId={1} sessionId={6} />);
    await waitFor(() => {
      expect(screen.getByText("出错了")).toBeInTheDocument();
    });
  });

  it("渲染 compaction 横幅", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([{ type: "compaction", status: "completed" }]),
      effort: null,
      model: null,
    });
    render(<AgentMessageStream projectId={1} sessionId={7} />);
    await waitFor(() => {
      expect(screen.getByText("Context compacted")).toBeInTheDocument();
    });
  });

  it("readAgentTimeline 失败时显示错误状态", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockRejectedValue(new Error("加载失败"));
    render(<AgentMessageStream projectId={1} sessionId={8} />);
    await waitFor(() => {
      expect(screen.getByText("加载失败")).toBeInTheDocument();
    });
  });

  it("assistant 消息含 markdown 代码块时渲染 code", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: historyItems([
        {
          type: "assistant_message",
          text: "示例：\n```ts\nconst x = 1;\n```",
          messageId: "a1",
        },
      ]),
      effort: null,
      model: null,
    });
    const { container } = render(
      <AgentMessageStream projectId={1} sessionId={9} />,
    );
    await waitFor(() => {
      expect(screen.getByText("示例：")).toBeInTheDocument();
    });
    const codeBlock = container.querySelector(".agents-message__code-block");
    expect(codeBlock).not.toBeNull();
    // 高亮会把代码切成 `<span class="hljs-*">`，原文仍逐字保留。
    expect(codeBlock?.textContent).toBe("const x = 1;\n");
  });

  it("Claude session 仅含用户消息且 turn 运行时展示正在思考占位", () => {
    // 回归（问题三）：首次运行 Claude session 时，展示用户消息后到 Claude 首条输出
    // 之间有数秒连接延迟。此期间应展示「正在思考…」占位行；一旦 Claude 产出任意
    // assistant_message/reasoning/tool_call，占位行立即隐藏。
    render(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        agentType="claude"
        isTurnRunning
        state={createMessageStreamState({
          entries: [
            {
              id: "u1",
              kind: "user_message",
              item: {
                type: "user_message",
                text: "开始处理",
                messageId: "u1",
              },
            },
          ],
          turnStatus: "running",
        })}
      />,
    );
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("Claude session 产出 assistant 消息后隐藏正在思考占位", () => {
    // 回归（问题三）：Claude 一旦有任意产出（此处为 assistant_message），
    // 「正在思考…」占位行应立即隐藏，避免与 Claude 自身的输出重复。
    render(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        agentType="claude"
        isTurnRunning
        state={createMessageStreamState({
          entries: [
            {
              id: "u1",
              kind: "user_message",
              item: {
                type: "user_message",
                text: "开始处理",
                messageId: "u1",
              },
            },
            {
              id: "a1",
              kind: "assistant_message",
              item: {
                type: "assistant_message",
                text: "我先读取文件",
                messageId: "a1",
              },
            },
          ],
          turnStatus: "running",
        })}
      />,
    );
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
    expect(screen.getByText("我先读取文件")).toBeInTheDocument();
  });

  it("turn 已结束并等待用户回复时，未结算的思考不再显示正在思考", () => {
    // session 324：Grok 已写出 Q1 并 turn_completed，reasoning 没有 durationMs。
    // 标题不能继续用进行中的 Thinking / 正在思考。
    let state = createInitialState();
    const events: AgentStreamEvent[] = [
      { type: "turn_started", turnId: "turn-1" },
      timelineEvent({
        type: "reasoning",
        text: "Waiting for the user to answer Q1.",
      }),
      timelineEvent({
        type: "assistant_message",
        text: "Reply with 1-3.",
        messageId: "grok-msg-1",
      }),
      {
        type: "turn_completed",
        turnId: "turn-1",
        usage: null,
        stopReason: "end_turn",
      },
    ];
    for (const event of events) {
      state = messageStreamReducer(state, { type: "EVENT", event });
    }
    expect(state.turnStatus).toBe("idle");

    render(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        agentType="grok"
        isTurnRunning={false}
        state={{ ...state, isInitialized: true }}
      />,
    );

    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
    expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
    expect(screen.getByText("Thought process")).toBeInTheDocument();
    expect(screen.getByText("Reply with 1-3.")).toBeInTheDocument();
  });

  it("turn 仍在运行时，未结算的思考继续显示正在思考", () => {
    render(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        agentType="grok"
        isTurnRunning
        state={createMessageStreamState({
          entries: [
            {
              id: "r1",
              kind: "reasoning",
              item: { type: "reasoning", text: "Still working." },
            },
          ],
          turnStatus: "running",
        })}
      />,
    );
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.queryByText("Thought process")).not.toBeInTheDocument();
  });
});

describe("AgentMessageStreamView 切换 session 时的滚动定位", () => {
  function mockScrollMetrics(
    el: HTMLElement,
    metrics: { clientHeight?: number; scrollHeight?: number },
  ) {
    if (metrics.clientHeight !== undefined) {
      Object.defineProperty(el, "clientHeight", {
        configurable: true,
        get: () => metrics.clientHeight as number,
      });
    }
    if (metrics.scrollHeight !== undefined) {
      Object.defineProperty(el, "scrollHeight", {
        configurable: true,
        get: () => metrics.scrollHeight as number,
      });
    }
  }

  function createStateWithMessages() {
    return createMessageStreamState({
      entries: [
        {
          id: "u1",
          kind: "user_message",
          item: { type: "user_message", text: "开始", messageId: "u1" },
        },
        {
          id: "a1",
          kind: "assistant_message",
          item: {
            type: "assistant_message",
            text: "处理中",
            messageId: "a1",
          },
        },
      ],
    });
  }

  it("切换到非完成态 session 时将消息流定位到底部", () => {
    const state = createStateWithMessages();
    const { container, rerender } = render(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        state={state}
        isActive={false}
        autoScrollOnActivate
      />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    mockScrollMetrics(scroll, { clientHeight: 100, scrollHeight: 500 });
    scroll.scrollTop = 0;

    rerender(
      <AgentMessageStreamView
        state={state}
        isActive
        autoScrollOnActivate
        sessionFileLinks={STREAM_FILE_LINKS}
      />,
    );

    expect(scroll.scrollTop).toBe(500);
  });

  it("完成态 session 切换时保持原滚动位置", () => {
    const state = createStateWithMessages();
    const { container, rerender } = render(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        state={state}
        isActive={false}
        autoScrollOnActivate={false}
      />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    mockScrollMetrics(scroll, { clientHeight: 100, scrollHeight: 500 });
    scroll.scrollTop = 123;

    rerender(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        state={state}
        isActive
        autoScrollOnActivate={false}
      />,
    );

    expect(scroll.scrollTop).toBe(123);
  });

  it("消息流被其他子 tab 遮蔽时不改写滚动位置", () => {
    const state = createStateWithMessages();
    const { container, rerender } = render(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        state={state}
        isActive={false}
        autoScrollOnActivate
      />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    // clientHeight 保持 0，模拟被 hidden（其他子 tab 激活）时的 display:none
    mockScrollMetrics(scroll, { scrollHeight: 500 });
    scroll.scrollTop = 42;

    rerender(
      <AgentMessageStreamView
        state={state}
        isActive
        autoScrollOnActivate
        sessionFileLinks={STREAM_FILE_LINKS}
      />,
    );

    expect(scroll.scrollTop).toBe(42);
  });
});

describe("AgentMessageStreamView 长内容跳转按钮", () => {
  function mockScrollMetrics(
    el: HTMLElement,
    metrics: {
      clientHeight?: number;
      scrollHeight?: number;
      scrollTop?: number;
    },
  ) {
    if (metrics.clientHeight !== undefined) {
      Object.defineProperty(el, "clientHeight", {
        configurable: true,
        get: () => metrics.clientHeight as number,
      });
    }
    if (metrics.scrollHeight !== undefined) {
      Object.defineProperty(el, "scrollHeight", {
        configurable: true,
        get: () => metrics.scrollHeight as number,
      });
    }
    if (metrics.scrollTop !== undefined) {
      el.scrollTop = metrics.scrollTop;
    }
  }

  function createStateWithMessages() {
    return createMessageStreamState({
      entries: [
        {
          id: "u1",
          kind: "user_message",
          item: { type: "user_message", text: "开始", messageId: "u1" },
        },
        {
          id: "a1",
          kind: "assistant_message",
          item: {
            type: "assistant_message",
            text: "处理中",
            messageId: "a1",
          },
        },
      ],
    });
  }

  function renderLongStream() {
    const state = createStateWithMessages();
    const view = render(
      <AgentMessageStreamView
        state={state}
        sessionFileLinks={STREAM_FILE_LINKS}
      />,
    );
    const scroll = view.container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    mockScrollMetrics(scroll, { clientHeight: 100, scrollHeight: 500 });
    return { ...view, scroll };
  }

  it("贴顶时显示向下按钮", async () => {
    const { scroll } = renderLongStream();
    scroll.scrollTop = 0;
    fireEvent.scroll(scroll);

    expect(
      await screen.findByRole("button", { name: "Scroll to bottom" }),
    ).toBeInTheDocument();
  });

  it("中段滚动时仍显示向下按钮，便于快速到底", async () => {
    const { scroll } = renderLongStream();
    scroll.scrollTop = 150;
    fireEvent.scroll(scroll);

    expect(
      await screen.findByRole("button", { name: "Scroll to bottom" }),
    ).toBeInTheDocument();
  });

  it("贴底时显示向上按钮", async () => {
    const { scroll } = renderLongStream();
    scroll.scrollTop = 400;
    fireEvent.scroll(scroll);

    expect(
      await screen.findByRole("button", { name: "Scroll to top" }),
    ).toBeInTheDocument();
  });

  it("向下滚动时显示向下按钮，即使已滚到底部附近", () => {
    const { scroll } = renderLongStream();
    scroll.scrollTop = 200;
    fireEvent.scroll(scroll);
    scroll.scrollTop = 400;
    fireEvent.scroll(scroll);

    expect(
      screen.getByRole("button", { name: "Scroll to bottom" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Scroll to top" }),
    ).not.toBeInTheDocument();
  });

  it("向上滚动时显示向上按钮，即使距底部较远", () => {
    const { scroll } = renderLongStream();
    scroll.scrollTop = 320;
    fireEvent.scroll(scroll);
    scroll.scrollTop = 200;
    fireEvent.scroll(scroll);

    expect(
      screen.getByRole("button", { name: "Scroll to top" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Scroll to bottom" }),
    ).not.toBeInTheDocument();
  });

  it("停止滚动后按当前位置回落到默认方向", async () => {
    const { scroll } = renderLongStream();
    scroll.scrollTop = 320;
    fireEvent.scroll(scroll);
    scroll.scrollTop = 200;
    fireEvent.scroll(scroll);
    expect(
      screen.getByRole("button", { name: "Scroll to top" }),
    ).toBeInTheDocument();

    // 停稳（无新 scroll 事件）后交回位置判定：中段未贴底，回落为向下。
    expect(
      await screen.findByRole("button", { name: "Scroll to bottom" }),
    ).toBeInTheDocument();
  });

  it("内容不足两屏时不显示跳转按钮", () => {
    const state = createStateWithMessages();
    const { container } = render(
      <AgentMessageStreamView
        state={state}
        sessionFileLinks={STREAM_FILE_LINKS}
      />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    mockScrollMetrics(scroll, {
      clientHeight: 100,
      scrollHeight: 150,
      scrollTop: 0,
    });
    fireEvent.scroll(scroll);

    expect(
      screen.queryByRole("button", { name: "Scroll to bottom" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Scroll to top" }),
    ).not.toBeInTheDocument();
  });
});

describe("AgentMessageStreamView 完成态 session 重挂载后的滚动位置", () => {
  /** 用真实浏览器语义模拟滚动盒子：scrollTop 赋值时夹到 [0, scrollHeight - clientHeight]。 */
  function mockScrollBox(
    el: HTMLElement,
    metrics: { clientHeight: number; scrollHeight: number },
  ) {
    Object.defineProperty(el, "clientHeight", {
      configurable: true,
      get: () => metrics.clientHeight,
    });
    Object.defineProperty(el, "scrollHeight", {
      configurable: true,
      get: () => metrics.scrollHeight,
    });
    let current = el.scrollTop;
    Object.defineProperty(el, "scrollTop", {
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

  function createStateWithMessages(count = 2) {
    return createMessageStreamState({
      entries: Array.from({ length: count }, (_, index) => ({
        id: `a${index}`,
        kind: "assistant_message" as const,
        item: {
          type: "assistant_message" as const,
          text: `第 ${index} 条`,
          messageId: `a${index}`,
        },
      })),
    });
  }

  it("重挂载后内容填充到可恢复高度时回到记录位置，而不是跳到底部", () => {
    writeMessageStreamScrollOffset(9, 200);
    const { container, rerender } = render(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        sessionId={9}
        state={createMessageStreamState()}
        autoScrollOnActivate={false}
      />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    mockScrollBox(scroll, { clientHeight: 100, scrollHeight: 500 });

    // 缓存预览 / 历史 timeline 异步填充内容后的提交。
    rerender(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        sessionId={9}
        state={createStateWithMessages()}
        autoScrollOnActivate={false}
      />,
    );

    expect(scroll.scrollTop).toBe(200);
  });

  it("内容先到一屏、完整 timeline 后到时，最终仍落在记录位置", () => {
    writeMessageStreamScrollOffset(9, 900);
    const { container, rerender } = render(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        sessionId={9}
        state={createMessageStreamState()}
        autoScrollOnActivate={false}
      />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    mockScrollBox(scroll, { clientHeight: 100, scrollHeight: 500 });

    // 第一段内容只有一屏：900 尚不可达，位置被夹到当前最大可滚动高度。
    rerender(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        sessionId={9}
        state={createStateWithMessages(2)}
        autoScrollOnActivate={false}
      />,
    );
    expect(scroll.scrollTop).toBe(400);

    // 完整 timeline 到位后恢复到记录位置。
    mockScrollBox(scroll, { clientHeight: 100, scrollHeight: 2000 });
    rerender(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        sessionId={9}
        state={createStateWithMessages(3)}
        autoScrollOnActivate={false}
      />,
    );
    expect(scroll.scrollTop).toBe(900);
  });

  it("运行中 session 忽略记录位置，仍跟随到底部", () => {
    writeMessageStreamScrollOffset(9, 200);
    const { container, rerender } = render(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        sessionId={9}
        state={createMessageStreamState()}
        autoScrollOnActivate
      />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    mockScrollBox(scroll, { clientHeight: 100, scrollHeight: 500 });

    rerender(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        sessionId={9}
        state={createStateWithMessages()}
        autoScrollOnActivate
      />,
    );

    // 500 - 100：贴底即最大可滚动高度。
    expect(scroll.scrollTop).toBe(400);
  });

  it("滚动时记录当前位置，供切回时恢复", () => {
    const { container } = render(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        sessionId={9}
        state={createStateWithMessages()}
        autoScrollOnActivate={false}
      />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    mockScrollBox(scroll, { clientHeight: 100, scrollHeight: 500 });
    scroll.scrollTop = 250;
    fireEvent.scroll(scroll);

    expect(readMessageStreamScrollOffset(9)).toBe(250);
  });

  it("零高度（被其它子 tab 遮蔽）时的滚动不覆盖已记录位置", () => {
    writeMessageStreamScrollOffset(9, 250);
    const { container } = render(
      <AgentMessageStreamView
        sessionFileLinks={STREAM_FILE_LINKS}
        sessionId={9}
        state={createStateWithMessages()}
        autoScrollOnActivate={false}
      />,
    );
    const scroll = container.querySelector(
      ".agents-message-stream__scroll",
    ) as HTMLElement;
    // clientHeight 保持 jsdom 默认 0，模拟 display:none 遮蔽。
    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      get: () => 500,
    });
    fireEvent.scroll(scroll);

    expect(readMessageStreamScrollOffset(9)).toBe(250);
  });
});

describe("AgentMessageStreamView 用户消息折叠", () => {
  let resizeCallbacks: ResizeObserverCallback[] = [];

  beforeEach(() => {
    resizeCallbacks = [];
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }

      observe() {}

      unobserve() {}

      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderUserMessage(text: string) {
    const state = createMessageStreamState({
      entries: [
        {
          id: "u1",
          kind: "user_message",
          item: { type: "user_message", text, messageId: "u1" },
        },
      ],
    });
    const view = render(
      <AgentMessageStreamView
        state={state}
        sessionFileLinks={STREAM_FILE_LINKS}
      />,
    );
    const content = view.container.querySelector<HTMLElement>(
      ".agents-message__text",
    );
    if (!content) {
      throw new Error("missing user message text container");
    }
    return { view, content };
  }

  it("粘贴的长代码默认折叠为五行并可展开收起", () => {
    const longText = Array.from(
      { length: 20 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    const { view, content } = renderUserMessage(longText);
    expect(content.className).toContain("expandable-text__content--clamped");

    // jsdom 不做布局，手工注入尺寸后触发重新判定。
    Object.defineProperty(content, "clientHeight", {
      configurable: true,
      get: () => 70,
    });
    Object.defineProperty(content, "scrollHeight", {
      configurable: true,
      get: () => 280,
    });
    act(() => {
      for (const callback of resizeCallbacks) {
        callback([], {} as ResizeObserver);
      }
    });

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(
      view.container.querySelector(".expandable-text__content--clamped"),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(
      view.container.querySelector(".expandable-text__content--clamped"),
    ).not.toBeNull();
  });

  it("短用户消息不渲染折叠切换按钮", () => {
    renderUserMessage("开始处理");

    expect(
      screen.queryByRole("button", { name: "Show more" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("开始处理")).toBeInTheDocument();
  });
});

describe("AgentMessageStreamView 文件链接能力透传", () => {
  it("助手消息里的工作区相对路径点击后回传相对路径", async () => {
    const openFilePath = vi.fn();
    const user = userEvent.setup();
    const state = createMessageStreamState({
      entries: [
        {
          id: "a1",
          kind: "assistant_message",
          item: {
            type: "assistant_message",
            text: "改动见 [a.ts](./src/app/a.ts)。",
            messageId: "a1",
          },
        },
      ],
    });

    render(
      <AgentMessageStreamView
        state={state}
        sessionFileLinks={{
          projectId: 1,
          sessionId: 10,
          workspacePath: "/Users/tester/repo",
          homePath: "/Users/tester",
          openFilePath,
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Open file src/app/a.ts" }),
    );

    expect(openFilePath).toHaveBeenCalledWith("src/app/a.ts");
  });

  it("助手消息里已确认存在的行内代码路径点击后回传相对路径", async () => {
    statProjectWorktreeFileMock.mockResolvedValue({
      filePath: "src/app/a.ts",
      sizeBytes: 10,
      modifiedAt: null,
    });
    const openFilePath = vi.fn();
    const user = userEvent.setup();
    const state = createMessageStreamState({
      entries: [
        {
          id: "a1",
          kind: "assistant_message",
          item: {
            type: "assistant_message",
            text: "改动见 `src/app/a.ts`。",
            messageId: "a1",
          },
        },
      ],
    });

    render(
      <AgentMessageStreamView
        state={state}
        sessionFileLinks={{
          projectId: 1,
          sessionId: 10,
          workspacePath: "/Users/tester/repo",
          homePath: "/Users/tester",
          openFilePath,
        }}
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Open file src/app/a.ts",
      }),
    );

    expect(statProjectWorktreeFileMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 10,
      filePath: "src/app/a.ts",
    });
    expect(openFilePath).toHaveBeenCalledWith("src/app/a.ts");
  });
});

describe("AgentMessageStreamView 工具卡交互", () => {
  const WORKSPACE_PATH = "/workspace/repo";

  function fileLinks(openFilePath: (filePath: string) => void) {
    return {
      projectId: 1,
      sessionId: 40,
      workspacePath: WORKSPACE_PATH,
      homePath: "/home/dev",
      openFilePath,
    };
  }

  function renderToolCard(
    item: Extract<AgentTimelineItem, { type: "tool_call" }>,
    sessionFileLinks?: SessionFileLinks,
  ) {
    return render(
      <AgentMessageStreamView
        sessionFileLinks={sessionFileLinks}
        state={createMessageStreamState({
          entries: [{ id: "t1", kind: "tool_call", item }],
        })}
      />,
    );
  }

  /** 生成指定行数的统一 diff，用于验证 diff 折叠阈值。 */
  function largeDiff(contentLines: number): string {
    return [
      `@@ -1,${contentLines} +1,${contentLines} @@`,
      ...Array.from({ length: contentLines }, (_, index) => `+line ${index}`),
    ].join("\n");
  }

  it("read 工具卡的路径是按钮并回传工作区相对路径", () => {
    const openFilePath = vi.fn();
    renderToolCard(
      {
        type: "tool_call",
        callId: "read-1",
        name: "read",
        detail: {
          type: "read",
          path: `${WORKSPACE_PATH}/src/app/a.ts`,
          content: "export const a = 1;",
        },
        status: "completed",
      },
      fileLinks(openFilePath),
    );

    fireEvent.click(screen.getByText("Read"));
    fireEvent.click(
      screen.getByRole("button", { name: "Open file src/app/a.ts" }),
    );

    expect(openFilePath).toHaveBeenCalledWith("src/app/a.ts");
  });

  it("工作区外绝对路径的 read 路径保持纯文本", () => {
    const openFilePath = vi.fn();
    renderToolCard(
      {
        type: "tool_call",
        callId: "read-outside",
        name: "read",
        detail: {
          type: "read",
          path: "/tmp/outside/a.ts",
          content: "export const a = 1;",
        },
        status: "completed",
      },
      fileLinks(openFilePath),
    );

    fireEvent.click(screen.getByText("Read"));

    expect(
      screen.queryByRole("button", { name: /^Open file / }),
    ).not.toBeInTheDocument();
    // 头部摘要与详情各显示一次原文路径。
    expect(screen.getAllByText("/tmp/outside/a.ts")).toHaveLength(2);
  });

  it("write 工具卡的路径是按钮并回传工作区相对路径", () => {
    const openFilePath = vi.fn();
    renderToolCard(
      {
        type: "tool_call",
        callId: "write-1",
        name: "write",
        detail: {
          type: "write",
          path: `${WORKSPACE_PATH}/src/app/b.ts`,
          content: "export const b = 2;",
        },
        status: "completed",
      },
      fileLinks(openFilePath),
    );

    fireEvent.click(screen.getByText("Write"));
    fireEvent.click(
      screen.getByRole("button", { name: "Open file src/app/b.ts" }),
    );

    expect(openFilePath).toHaveBeenCalledWith("src/app/b.ts");
  });

  it("edit 工具卡的路径是按钮，小 diff 维持高亮直出", () => {
    const openFilePath = vi.fn();
    const { container } = renderToolCard(
      {
        type: "tool_call",
        callId: "edit-small",
        name: "edit",
        detail: {
          type: "edit",
          path: `${WORKSPACE_PATH}/src/app/c.tsx`,
          diff: [
            "@@ -1,1 +1,1 @@",
            '- const a = "old";',
            '+ const a = "new";',
          ].join("\n"),
        },
        status: "completed",
      },
      fileLinks(openFilePath),
    );

    fireEvent.click(screen.getByText("Edit"));

    fireEvent.click(
      screen.getByRole("button", { name: "Open file src/app/c.tsx" }),
    );

    expect(openFilePath).toHaveBeenCalledWith("src/app/c.tsx");
    expect(
      container.querySelector(".agents-message__diff-code"),
    ).not.toBeNull();
    expect(screen.queryByText(/^Show diff \(/)).not.toBeInTheDocument();
  });

  it("edit 工具卡的大 diff 默认收起在嵌套折叠里", () => {
    renderToolCard({
      type: "tool_call",
      callId: "edit-large",
      name: "edit",
      detail: {
        type: "edit",
        path: "/tmp/large.ts",
        diff: largeDiff(130),
      },
      status: "completed",
    });

    fireEvent.click(screen.getByText("Edit"));

    const fold = screen
      .getByText("Show diff (131 lines)")
      .closest("details") as HTMLDetailsElement | null;
    expect(fold?.open).toBe(false);

    fireEvent.click(screen.getByText("Show diff (131 lines)"));

    expect(
      screen
        .getByText("Hide diff")
        .closest("details") as HTMLDetailsElement | null,
    ).toHaveProperty("open", true);
  });

  it("shell 卡保留命令与退出码，复制命令成功后提示已复制", async () => {
    renderToolCard({
      type: "tool_call",
      callId: "shell-copy",
      name: "shell",
      detail: {
        type: "shell",
        command: "pnpm test",
        output: "all good",
        exitCode: 0,
      },
      status: "completed",
    });

    fireEvent.click(screen.getByText("Shell"));

    expect(screen.getByText("exit 0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledWith("pnpm test");
    });
    expect(toast.success).toHaveBeenCalledWith("Copied to clipboard");
  });

  it("shell 卡复制命令失败时提示复制失败", async () => {
    copyTextToClipboardMock.mockResolvedValue(false);
    renderToolCard({
      type: "tool_call",
      callId: "shell-copy-failed",
      name: "shell",
      detail: {
        type: "shell",
        command: "pnpm lint",
        output: "no problems",
        exitCode: 0,
      },
      status: "completed",
    });

    fireEvent.click(screen.getByText("Shell"));
    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to copy");
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shell 大输出默认收起在嵌套折叠里", () => {
    const output = Array.from(
      { length: 41 },
      (_, index) => `line ${index}`,
    ).join("\n");
    renderToolCard({
      type: "tool_call",
      callId: "shell-large",
      name: "shell",
      detail: { type: "shell", command: "cat big.log", output, exitCode: 0 },
      status: "completed",
    });

    fireEvent.click(screen.getByText("Shell"));

    const fold = screen
      .getByText("Show output (41 lines)")
      .closest("details") as HTMLDetailsElement | null;
    expect(fold?.open).toBe(false);

    fireEvent.click(screen.getByText("Show output (41 lines)"));

    expect(screen.getByText("Hide output")).toBeInTheDocument();
  });

  it("shell 小输出直接展开，不出现嵌套折叠", () => {
    renderToolCard({
      type: "tool_call",
      callId: "shell-small",
      name: "shell",
      detail: {
        type: "shell",
        command: "ls",
        output: "a.txt\nb.txt",
        exitCode: 0,
      },
      status: "completed",
    });

    fireEvent.click(screen.getByText("Shell"));

    expect(screen.getByText("a.txt b.txt")).toBeInTheDocument();
    expect(screen.queryByText(/^Show output \(/)).not.toBeInTheDocument();
  });

  it("未知工具的 raw 输入输出默认收起在折叠详情里", () => {
    renderToolCard({
      type: "tool_call",
      callId: "unknown-1",
      name: "some_unknown_tool",
      detail: {
        type: "unknown",
        rawInput: '{"foo":"bar"}',
        rawOutput: "raw output text",
      },
      status: "completed",
    });

    expect(screen.queryByText("raw output text")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Some Unknown Tool"));

    const fold = screen
      .getByText("Raw tool input and output")
      .closest("details") as HTMLDetailsElement | null;
    expect(fold?.open).toBe(false);

    fireEvent.click(screen.getByText("Raw tool input and output"));

    expect(screen.getByText('{"foo":"bar"}')).toBeInTheDocument();
    expect(screen.getByText("raw output text")).toBeInTheDocument();
  });
});
