import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../shared/i18n/i18n";
import { getIssueTimeline } from "../issue-commands";
import { IssueTimeline } from "./issue-timeline";

vi.mock("../issue-commands", () => ({
  getIssueTimeline: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock("../../agents/agent-visuals", () => ({
  getAgentLogoSrc: vi.fn((agentType: string) => `agent-logo:${agentType}`),
}));

vi.mock("../../agents/message-stream/agent-markdown", () => ({
  AgentMarkdown: (props: { children: string }) => (
    <div data-testid="agent-markdown">{props.children}</div>
  ),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const getIssueTimelineMock = vi.mocked(getIssueTimeline);

function renderTimeline() {
  return render(
    <I18nProvider fixedLocale="en">
      <IssueTimeline issueId={2} projectId={1} />
    </I18nProvider>,
  );
}

describe("IssueTimeline", () => {
  it("does not render the activity module when no entries exist", async () => {
    getIssueTimelineMock.mockResolvedValue({ entries: [] });

    renderTimeline();

    await waitFor(() => {
      expect(getIssueTimelineMock).toHaveBeenCalledWith({
        issueId: 2,
        projectId: 1,
      });
    });
    expect(screen.queryByRole("region", { name: "Activity" })).toBeNull();
    expect(screen.queryByText("Activity")).toBeNull();
  });

  it("renders the created entry with a fallback avatar and relative time", async () => {
    getIssueTimelineMock.mockResolvedValue({
      entries: [
        {
          actionType: "issue_created",
          actor: { name: "Alice", avatarPath: null, actorKind: "user" },
          createdAt: Date.now() - 120_000,
        },
      ],
    });

    renderTimeline();

    expect(
      await screen.findByRole("region", { name: "Activity" }),
    ).toBeVisible();
    expect(screen.getByText("Alice")).toBeVisible();
    expect(screen.getByText("created this Issue")).toBeVisible();
    expect(screen.getByText("2m ago")).toBeVisible();
    expect(document.querySelector(".issue-timeline__avatar")).toHaveAttribute(
      "src",
      expect.stringContaining("default_user_profile"),
    );
  });

  it("renders the agent actor with the agent logo instead of the user avatar", async () => {
    getIssueTimelineMock.mockResolvedValue({
      entries: [
        {
          actionType: "agent_session_started",
          actor: {
            name: "Codex",
            avatarPath: null,
            actorKind: "agent",
            agentType: "codex",
          },
          createdAt: Date.now() - 120_000,
        },
      ],
    });

    renderTimeline();

    expect(await screen.findByText("Codex")).toBeVisible();
    const avatar = document.querySelector(".issue-timeline__avatar");
    expect(avatar).not.toBeNull();
    expect(avatar).toHaveAttribute("src", "agent-logo:codex");
  });

  it("renders the comment body for an agent comment entry", async () => {
    getIssueTimelineMock.mockResolvedValue({
      entries: [
        {
          actionType: "issue_comment_added",
          actor: {
            name: "Codex",
            avatarPath: null,
            actorKind: "agent",
            agentType: "codex",
          },
          commentBody: "已完成提交并验证通过",
          createdAt: Date.now() - 120_000,
        },
      ],
    });

    renderTimeline();

    expect(await screen.findByText("已完成提交并验证通过")).toBeVisible();
    expect(screen.getByTestId("agent-markdown")).toBeVisible();
  });

  it("lays out multi-line comments below the meta row, not inline with the avatar", async () => {
    const longBody = [
      "按 `matt-dev-workflow` 进入阶段 0。",
      "",
      "- 全量导入：`TodoMiggoImportService.importAllFromView`",
      "",
      "---",
      "",
      "「最新 n 条」按什么取？",
    ].join("\n");

    getIssueTimelineMock.mockResolvedValue({
      entries: [
        {
          actionType: "issue_comment_added",
          actor: {
            name: "codex",
            avatarPath: null,
            actorKind: "agent",
            agentType: "codex",
          },
          commentBody: longBody,
          createdAt: Date.now() - 120_000,
        },
      ],
    });

    renderTimeline();

    expect(await screen.findByText(/进入阶段 0/)).toBeVisible();
    const entry = document.querySelector(".issue-timeline__entry--comment");
    expect(entry).not.toBeNull();
    expect(entry?.querySelector(".issue-timeline__meta")).not.toBeNull();
    expect(entry?.querySelector(".issue-timeline__comment")).not.toBeNull();
    // 元信息行与评论正文是兄弟节点，避免横向 flex 挤压 Markdown
    const meta = entry?.querySelector(".issue-timeline__meta");
    const comment = entry?.querySelector(".issue-timeline__comment");
    expect(meta?.nextElementSibling).toBe(comment);
    expect(screen.getByText("codex")).toBeVisible();
    // 评论条目不再把 action 文案塞进 meta
    expect(screen.queryByText("commented")).toBeNull();
  });
});
