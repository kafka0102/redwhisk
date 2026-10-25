import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentTuiArchiveMarkdownView } from "./agent-tui-archive-markdown-view";

const commandMocks = vi.hoisted(() => ({
  readAgentSessionTerminal: vi.fn(),
}));

vi.mock("../agent-session-commands", () => ({
  readAgentSessionTerminal: commandMocks.readAgentSessionTerminal,
}));

vi.mock("../message-stream/agent-markdown", () => ({
  AgentMarkdown: ({ children }: { children: string }) => (
    <div data-testid="agent-markdown">{children}</div>
  ),
}));

describe("AgentTuiArchiveMarkdownView", () => {
  beforeEach(() => {
    commandMocks.readAgentSessionTerminal.mockReset();
  });

  it("读取快照后以 Markdown 源文交给 AgentMarkdown（保留标题标记）", async () => {
    commandMocks.readAgentSessionTerminal.mockResolvedValue({
      snapshot:
        "• ## 结果\n\n**完成**\n\n<issue-comment>\n摘要\n</issue-comment>\n",
      isActive: false,
    });

    render(<AgentTuiArchiveMarkdownView projectId={1} sessionId={9} />);

    await waitFor(() => {
      expect(screen.getByTestId("agent-markdown")).toBeInTheDocument();
    });
    const body = screen.getByTestId("agent-markdown").textContent ?? "";
    expect(body).toContain("## 结果");
    expect(body).toContain("**完成**");
    expect(body).toContain("摘要");
    expect(body).not.toContain("<issue-comment>");
  });

  it("会话记录提取出的标题和代码块原样交给 AgentMarkdown", async () => {
    const snapshot = [
      "第一个问题",
      "",
      "第一轮结论",
      "",
      "第二个问题",
      "",
      "## 标题",
      "",
      "```rust",
      "fn answer() {}",
      "```",
      "",
      "第二轮结论",
      "",
    ].join("\n");
    commandMocks.readAgentSessionTerminal.mockResolvedValue({
      snapshot,
      isActive: false,
    });

    render(<AgentTuiArchiveMarkdownView projectId={1} sessionId={9} />);

    await waitFor(() => {
      expect(screen.getByTestId("agent-markdown")).toBeInTheDocument();
    });
    expect(screen.getByTestId("agent-markdown").textContent).toBe(
      snapshot.trim(),
    );
  });

  it("带逐行 › 的归档渲染出用户卡和结论卡交替", async () => {
    const snapshot = [
      "› 第一问第一行",
      "›",
      "› 第一问第二行",
      "",
      "# 结论一",
      "",
      "段落",
      "",
      "› 只有用户",
      "",
      "只有结论",
      "",
    ].join("\n");
    commandMocks.readAgentSessionTerminal.mockResolvedValue({
      snapshot,
      isActive: false,
    });

    render(<AgentTuiArchiveMarkdownView projectId={1} sessionId={9} />);

    const userCards = await screen.findAllByRole("article");
    const userBodies = userCards.filter((card) =>
      card.classList.contains("agents-message__entry--user"),
    );
    const conclusionBodies = userCards.filter((card) =>
      card.classList.contains("agents-message__entry--assistant"),
    );

    expect(userBodies).toHaveLength(2);
    expect(conclusionBodies).toHaveLength(2);
    expect(userCards.map((card) => card.className)).toEqual([
      expect.stringContaining("agents-message__entry--user"),
      expect.stringContaining("agents-message__entry--assistant"),
      expect.stringContaining("agents-message__entry--user"),
      expect.stringContaining("agents-message__entry--assistant"),
    ]);

    expect(userBodies[0]?.textContent).toBe("第一问第一行\n\n第一问第二行");
    expect(userBodies[0]?.textContent).not.toContain("›");
    expect(userBodies[1]?.textContent).toBe("只有用户");
    expect(userBodies[1]?.textContent).not.toContain("›");

    expect(
      userBodies[0]?.querySelector(".agents-message__bubble--user"),
    ).not.toBeNull();
    expect(
      conclusionBodies[0]?.querySelector(".agents-message__bubble--assistant"),
    ).not.toBeNull();

    const markdowns = screen.getAllByTestId("agent-markdown");
    expect(markdowns).toHaveLength(2);
    expect(markdowns[0]?.textContent).toBe("# 结论一\n\n段落");
    expect(markdowns[1]?.textContent).toBe("只有结论");
    for (const markdown of markdowns) {
      expect(markdown.parentElement).not.toHaveClass(
        "agent-tui-archive-markdown__body",
      );
    }
  });

  it("空快照显示空态", async () => {
    commandMocks.readAgentSessionTerminal.mockResolvedValue({
      snapshot: "\n\n",
      isActive: false,
    });

    render(<AgentTuiArchiveMarkdownView projectId={1} sessionId={9} />);

    expect(
      await screen.findByText(/归档内容为空|Archive is empty/i),
    ).toBeInTheDocument();
  });

  it("归档 Markdown 正文使用全宽，不限制为 48rem", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/shared/styles/terminals.css"),
      "utf8",
    );
    const rule = css.match(
      /\.agent-tui-archive-markdown__body\s*\{[^}]+\}/,
    )?.[0];
    expect(rule).toBeDefined();
    expect(rule).not.toMatch(/max-width:\s*48rem/);
    expect(rule).toMatch(/max-width:\s*100%/);
  });

  it("JSON 快照按顺序画出靠右纯文本用户卡和靠左 Markdown 助手卡，工具不出现", async () => {
    const userText = "# 不要当标题\n第二行";
    const assistantText = "# 标题\n\n- 一项\n\n```ts\nconst n = 1;\n```";
    const snapshot = [
      timelineLine({
        type: "user_message",
        text: userText,
        messageId: "u1",
      }),
      timelineLine({
        type: "tool_call",
        callId: "SECRET_TOOL",
        name: "shell",
        detail: { type: "shell", command: "SECRET_TOOL" },
      }),
      timelineLine({
        type: "assistant_message",
        text: assistantText,
        messageId: "a1",
      }),
    ].join("\n");
    commandMocks.readAgentSessionTerminal.mockResolvedValue({
      snapshot,
      isActive: false,
    });

    render(<AgentTuiArchiveMarkdownView projectId={1} sessionId={9} />);

    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.className)).toEqual([
      expect.stringContaining("agents-message__entry--user"),
      expect.stringContaining("agents-message__entry--assistant"),
    ]);

    const userCard = cards[0];
    expect(userCard?.textContent).toBe(userText);
    expect(
      userCard?.querySelector("[data-testid='agent-markdown']"),
    ).toBeNull();
    expect(
      userCard?.querySelector(".agents-message__bubble--user"),
    ).not.toBeNull();

    expect(screen.getByTestId("agent-markdown").textContent).toBe(
      assistantText,
    );
    expect(
      cards[1]?.querySelector(".agents-message__bubble--assistant"),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("SECRET_TOOL");

    const css = readFileSync(
      resolve(process.cwd(), "src/shared/styles/message-stream.css"),
      "utf8",
    );
    const userBubble = css.match(
      /\.agents-message__bubble--user\s*\{[^}]+\}/,
    )?.[0];
    expect(userBubble).toBeDefined();
    expect(userBubble).not.toMatch(/box-shadow/);
  });

  it("JSON 归档里的错误单独靠左成卡，不并进助手正文", async () => {
    const snapshot = [
      timelineLine({
        type: "user_message",
        text: "跑一下",
        messageId: "u1",
      }),
      timelineLine({ type: "error", message: "# 失败原因" }),
      timelineLine({
        type: "assistant_message",
        text: "还在",
        messageId: "a1",
      }),
    ].join("\n");
    commandMocks.readAgentSessionTerminal.mockResolvedValue({
      snapshot,
      isActive: false,
    });

    render(<AgentTuiArchiveMarkdownView projectId={1} sessionId={9} />);

    const cards = await screen.findAllByRole("article");
    expect(cards.map((card) => card.className)).toEqual([
      expect.stringContaining("agents-message__entry--user"),
      expect.stringContaining("agents-message__entry--error"),
      expect.stringContaining("agents-message__entry--assistant"),
    ]);
    expect(cards[1]?.textContent).toBe("# 失败原因");
    expect(
      cards[1]?.querySelector("[data-testid='agent-markdown']"),
    ).toBeNull();
    expect(screen.getByTestId("agent-markdown").textContent).toBe("还在");
  });

  it("同一条用户消息只留最新一份，并留在第一次出现的位置", async () => {
    const snapshot = [
      timelineLine({
        type: "user_message",
        text: "旧稿",
        messageId: "u1",
      }),
      timelineLine({
        type: "assistant_message",
        text: "先看",
        messageId: "a1",
      }),
      timelineLine({
        type: "user_message",
        text: "新稿",
        messageId: "u1",
      }),
    ].join("\n");
    commandMocks.readAgentSessionTerminal.mockResolvedValue({
      snapshot,
      isActive: false,
    });

    render(<AgentTuiArchiveMarkdownView projectId={1} sessionId={9} />);

    const cards = await screen.findAllByRole("article");
    expect(cards.map((card) => card.className)).toEqual([
      expect.stringContaining("agents-message__entry--user"),
      expect.stringContaining("agents-message__entry--assistant"),
    ]);
    expect(cards[0]?.textContent).toBe("新稿");
    expect(screen.getByTestId("agent-markdown").textContent).toBe("先看");
    expect(document.body.textContent).not.toContain("旧稿");
  });

  it("没有标识时，只有紧邻上一条的相同用户原文不另起一张卡", async () => {
    const snapshot = [
      timelineLine({ type: "user_message", text: "你好" }),
      timelineLine({ type: "user_message", text: "你好" }),
      timelineLine({
        type: "assistant_message",
        text: "在",
        messageId: "a1",
      }),
      timelineLine({ type: "user_message", text: "你好" }),
    ].join("\n");
    commandMocks.readAgentSessionTerminal.mockResolvedValue({
      snapshot,
      isActive: false,
    });

    render(<AgentTuiArchiveMarkdownView projectId={1} sessionId={9} />);

    const cards = await screen.findAllByRole("article");
    expect(cards.map((card) => card.className)).toEqual([
      expect.stringContaining("agents-message__entry--user"),
      expect.stringContaining("agents-message__entry--assistant"),
      expect.stringContaining("agents-message__entry--user"),
    ]);
    expect(cards[0]?.textContent).toBe("你好");
    expect(cards[2]?.textContent).toBe("你好");
    expect(screen.getAllByText("你好")).toHaveLength(2);
  });

  it("同一输出来源上的同一条助手消息只留最新一份，不同来源各留一张", async () => {
    const snapshot = [
      timelineLine({
        type: "assistant_message",
        text: "主草稿",
        messageId: "m1",
      }),
      timelineLine({
        type: "user_message",
        text: "继续",
        messageId: "u1",
      }),
      timelineLine({
        type: "assistant_message",
        text: "子结论",
        messageId: "m1",
        subagentId: "child",
      }),
      timelineLine({
        type: "assistant_message",
        text: "主终稿",
        messageId: "m1",
      }),
    ].join("\n");
    commandMocks.readAgentSessionTerminal.mockResolvedValue({
      snapshot,
      isActive: false,
    });

    render(<AgentTuiArchiveMarkdownView projectId={1} sessionId={9} />);

    const cards = await screen.findAllByRole("article");
    expect(cards.map((card) => card.className)).toEqual([
      expect.stringContaining("agents-message__entry--assistant"),
      expect.stringContaining("agents-message__entry--user"),
      expect.stringContaining("agents-message__entry--assistant"),
    ]);
    expect(
      screen.getAllByTestId("agent-markdown").map((node) => node.textContent),
    ).toEqual(["主终稿", "子结论"]);
    expect(cards[1]?.textContent).toBe("继续");
    expect(document.body.textContent).not.toContain("主草稿");
  });

  it("文案相同但不是同一条的用户输入都保留", async () => {
    const snapshot = [
      timelineLine({
        type: "user_message",
        text: "选 A",
        messageId: "u1",
      }),
      timelineLine({
        type: "assistant_message",
        text: "记下了",
        messageId: "a1",
      }),
      timelineLine({
        type: "user_message",
        text: "选 A",
        messageId: "u2",
      }),
    ].join("\n");
    commandMocks.readAgentSessionTerminal.mockResolvedValue({
      snapshot,
      isActive: false,
    });

    render(<AgentTuiArchiveMarkdownView projectId={1} sessionId={9} />);

    const userCards = (await screen.findAllByRole("article")).filter((card) =>
      card.classList.contains("agents-message__entry--user"),
    );
    expect(userCards).toHaveLength(2);
    expect(userCards.map((card) => card.textContent)).toEqual(["选 A", "选 A"]);
  });

  it("坏行跳过，推理和其它类型不出现，其余卡仍在", async () => {
    const snapshot = [
      "{NOT_JSON",
      timelineLine({ type: "reasoning", text: "SECRET_REASON" }),
      timelineLine({
        type: "user_message",
        text: "留下",
        messageId: "u1",
      }),
      timelineLine({
        type: "todo",
        items: [{ text: "SECRET_TODO", completed: false }],
      }),
      timelineLine({
        type: "assistant_message",
        text: "也在",
        messageId: "a1",
      }),
      timelineLine({ type: "error", message: "错了" }),
    ].join("\n");
    commandMocks.readAgentSessionTerminal.mockResolvedValue({
      snapshot,
      isActive: false,
    });

    render(<AgentTuiArchiveMarkdownView projectId={1} sessionId={9} />);

    const cards = await screen.findAllByRole("article");
    expect(cards.map((card) => card.className)).toEqual([
      expect.stringContaining("agents-message__entry--user"),
      expect.stringContaining("agents-message__entry--assistant"),
      expect.stringContaining("agents-message__entry--error"),
    ]);
    expect(cards[0]?.textContent).toBe("留下");
    expect(screen.getByTestId("agent-markdown").textContent).toBe("也在");
    expect(cards[2]?.textContent).toBe("错了");
    expect(document.body.textContent).not.toContain("NOT_JSON");
    expect(document.body.textContent).not.toContain("SECRET_REASON");
    expect(document.body.textContent).not.toContain("SECRET_TODO");
  });

  it("只含丢掉的类型时不把它们画出来", async () => {
    const snapshot = [
      timelineLine({
        type: "tool_call",
        callId: "SECRET_TOOL",
        name: "shell",
      }),
      timelineLine({ type: "reasoning", text: "SECRET_REASON" }),
    ].join("\n");
    commandMocks.readAgentSessionTerminal.mockResolvedValue({
      snapshot,
      isActive: false,
    });

    render(<AgentTuiArchiveMarkdownView projectId={1} sessionId={9} />);

    expect(
      await screen.findByText(/归档内容为空|Archive is empty/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("SECRET_TOOL");
    expect(document.body.textContent).not.toContain("SECRET_REASON");
  });

  it("读失败仍是错误态", async () => {
    commandMocks.readAgentSessionTerminal.mockRejectedValue(
      new Error("disk failed"),
    );

    render(<AgentTuiArchiveMarkdownView projectId={1} sessionId={9} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("disk failed");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("切换会话不会留下上一条的卡", async () => {
    commandMocks.readAgentSessionTerminal.mockImplementation(
      ({ sessionId }: { sessionId: number }) =>
        Promise.resolve({
          snapshot: timelineLine({
            type: "user_message",
            text: sessionId === 9 ? "第一条" : "第二条",
            messageId: "u1",
          }),
          isActive: false,
        }),
    );

    const { rerender } = render(
      <AgentTuiArchiveMarkdownView projectId={1} sessionId={9} />,
    );
    expect(await screen.findByText("第一条")).toBeInTheDocument();

    rerender(<AgentTuiArchiveMarkdownView projectId={1} sessionId={10} />);

    expect(screen.queryByText("第一条")).not.toBeInTheDocument();
    expect(await screen.findByText("第二条")).toBeInTheDocument();
    expect(screen.queryByText("第一条")).not.toBeInTheDocument();
  });
});

function timelineLine(item: Record<string, unknown>): string {
  return JSON.stringify({
    event: { type: "timeline", item },
  });
}
