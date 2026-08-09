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
