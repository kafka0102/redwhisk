import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  AgentMessageStream,
  AgentMessageStreamView,
} from "./agent-message-stream";
import type { MessageStreamState } from "./message-stream-types";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));

vi.mock("../agent-session-commands", () => ({
  readAgentTimeline: vi.fn(),
}));

const { readAgentTimeline } = await import("../agent-session-commands");
const readAgentTimelineMock = vi.mocked(readAgentTimeline);

function setupStream(
  items: Parameters<typeof readAgentTimelineMock.mockResolvedValue>[0]["items"],
) {
  readAgentTimelineMock.mockReset();
  readAgentTimelineMock.mockResolvedValue({ items });
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
    isInitialized: true,
    ...overrides,
  };
}

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
      items: [
        { type: "user_message", text: "你好", messageId: "u1" },
        { type: "assistant_message", text: "你好！", messageId: "a1" },
      ],
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

  it("渲染 reasoning 折叠区", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: [{ type: "reasoning", text: "我先想想" }],
    });
    render(<AgentMessageStream projectId={1} sessionId={3} />);
    await waitFor(() => {
      expect(screen.getByText("Thinking")).toBeInTheDocument();
    });
    const details = screen
      .getByText("Thinking")
      .closest("details") as HTMLDetailsElement | null;
    expect(details?.open).toBe(false);
    expect(screen.getByText("我先想想")).toBeInTheDocument();
  });

  it("渲染 tool_call 卡片并由工具行展开详情", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: [
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
      ],
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
      items: [
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
      ],
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

  it("隐藏无输出的 shell 详情折叠区", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: [
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
      ],
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
      items: [
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
      ],
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
      items: [
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
      ],
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

  it("渲染 todo 清单", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: [
        {
          type: "todo",
          items: [
            { text: "任务一", completed: true },
            { text: "任务二", completed: false },
          ],
        },
      ],
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
      items: [{ type: "error", message: "出错了" }],
    });
    render(<AgentMessageStream projectId={1} sessionId={6} />);
    await waitFor(() => {
      expect(screen.getByText("出错了")).toBeInTheDocument();
    });
  });

  it("渲染 compaction 横幅", async () => {
    readAgentTimelineMock.mockReset();
    readAgentTimelineMock.mockResolvedValue({
      items: [{ type: "compaction", status: "completed" }],
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
      items: [
        {
          type: "assistant_message",
          text: "示例：\n```ts\nconst x = 1;\n```",
          messageId: "a1",
        },
      ],
    });
    const { container } = render(
      <AgentMessageStream projectId={1} sessionId={9} />,
    );
    await waitFor(() => {
      expect(screen.getByText("示例：")).toBeInTheDocument();
    });
    expect(
      container.querySelector(".agents-message__code-block"),
    ).not.toBeNull();
    expect(screen.getByText("const x = 1;")).toBeInTheDocument();
  });
});
