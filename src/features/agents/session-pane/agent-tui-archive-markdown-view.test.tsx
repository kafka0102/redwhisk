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
});
