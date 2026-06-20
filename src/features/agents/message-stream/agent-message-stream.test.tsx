import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentMessageStream } from "./agent-message-stream";

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

describe("AgentMessageStream", () => {
  it("加载完成且无消息时显示空态文案", async () => {
    setupStream([]);
    render(<AgentMessageStream projectId={1} sessionId={1} />);
    await waitFor(() => {
      expect(screen.getByText("发送一条消息开始对话。")).toBeInTheDocument();
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

  it("渲染 tool_call 卡片与状态 badge", async () => {
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
    expect(screen.getByText(/ls -la/)).toBeInTheDocument();
    expect(screen.getByText("完成")).toBeInTheDocument();
    const output = screen.getByText("file.txt");
    const details = output.closest("details") as HTMLDetailsElement | null;
    expect(details?.open).toBe(false);
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
    expect(screen.getByText("查看搜索内容和 1 条结果")).toBeInTheDocument();
    expect(screen.getByText("Claude 最新模型")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://docs.anthropic.com/en/docs/about-claude/models/overview",
    );
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
      expect(screen.getByText("待办清单")).toBeInTheDocument();
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
      expect(screen.getByText("上下文已压缩")).toBeInTheDocument();
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
