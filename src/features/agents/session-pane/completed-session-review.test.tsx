import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CompletedSessionReview } from "./completed-session-review";

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

const SURFACE_CLASS = "completed-session-review__surface";

function renderReview(showingSession: boolean) {
  commandMocks.readAgentSessionTerminal.mockResolvedValue({
    snapshot: "归档正文",
    isActive: false,
  });
  return render(
    <CompletedSessionReview
      projectId={1}
      readOnlySession={<div data-testid="read-only-session" />}
      sessionId={9}
      showingSession={showingSession}
    />,
  );
}

// 归档 Markdown 与终端 shell 都靠父级高度把自身的 `height: 100%` 解析成确定值；
// 若这里退回成裸 div 包裹，两者会退化为内容高度，其 `overflow: auto` 永不触发，
// 超出一屏的部分被 pane 的 `overflow: hidden` 直接裁掉——表现为归档回看只能看
// 第一屏且无法滚动。
describe("CompletedSessionReview", () => {
  it("归档面承载归档视图并带高度约束类", async () => {
    const { container } = renderReview(false);
    const archiveSurface = container.querySelector(`.${SURFACE_CLASS}`);

    expect(archiveSurface).not.toBeNull();
    expect(archiveSurface?.hasAttribute("hidden")).toBe(false);
    expect(
      archiveSurface?.querySelector(".agent-tui-archive-markdown"),
    ).not.toBeNull();
    expect(await screen.findByTestId("agent-markdown")).toBeInTheDocument();
  });

  it("只读 Session 面同样带高度约束类，且与归档面互斥显隐", () => {
    const { container } = renderReview(true);
    const surfaces = container.querySelectorAll(`.${SURFACE_CLASS}`);

    expect(surfaces).toHaveLength(2);
    expect(surfaces[0].hasAttribute("hidden")).toBe(true);
    expect(surfaces[1].hasAttribute("hidden")).toBe(false);
    expect(
      surfaces[1].querySelector('[data-testid="read-only-session"]'),
    ).not.toBeNull();
  });

  it("高度约束定义在 session-shell.css：撑满 pane 而不是内容高度", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/shared/styles/session-shell.css"),
      "utf8",
    );
    const rule = css.match(
      /\.completed-session-review__surface\s*\{[^}]+\}/,
    )?.[0];

    expect(rule).toBeDefined();
    expect(rule).toMatch(/height:\s*100%/);
    expect(rule).toMatch(/min-height:\s*0/);
    expect(rule).toMatch(/overflow:\s*hidden/);
  });
});
