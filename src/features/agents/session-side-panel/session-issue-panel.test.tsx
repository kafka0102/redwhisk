import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AgentSessionListItem } from "../agent-session-commands";
import { listIssues } from "../../issues/issue-commands";
import { I18nProvider } from "../../../shared/i18n/i18n";
import { SessionIssuePanel } from "./session-issue-panel";

vi.mock("../../issues/issue-commands", () => ({
  listIssues: vi.fn(),
}));

const listIssuesMock = vi.mocked(listIssues);

function makeSession(
  overrides: Partial<AgentSessionListItem> = {},
): AgentSessionListItem {
  return {
    sessionId: 12,
    number: 1,
    projectId: 1,
    issueId: 8,
    issueNumber: 8,
    issueTitle: "Demo",
    issueStatus: "running",
    agentProfileId: 3,
    agentProfileName: "Codex",
    workflowSkillName: null,
    canCompleteClean: false,
    canCompleteAgentCommit: false,
    title: null,
    agentType: "codex",
    displayMode: "json",
    status: "running",
    attention: "none",
    isTurnRunning: false,
    workspaceMode: "current_branch",
    workingDir: "/tmp/repo",
    workspacePath: null,
    originBranch: "main",
    workspaceBranch: "main",
    worktreeOwner: "redwhisk",
    logPath: "/tmp/session.log",
    latestOutput: null,
    lastActiveAt: 0,
    startedAt: 1_700_000_000_000,
    closedAt: null,
    processingMs: 0,
    lastOutputAt: null,
    startupModel: "gpt-5.5",
    ...overrides,
  };
}

function renderPanel(session: AgentSessionListItem): void {
  listIssuesMock.mockResolvedValue({
    issues: [
      {
        id: 8,
        number: 8,
        projectId: 1,
        title: "Demo",
        description: "desc",
        attachments: [],
        labels: [],
        status: "running",
        linkedSessionId: 12,
        linkedSessionStatus: "running",
        linkedSessionAttention: "none",
        linkedSessionLogPath: "/tmp/session.log",
        linkedSessionLatestOutput: null,
        createdAt: 1,
        updatedAt: 1,
        statusChangedAt: 1,
      },
    ],
  });
  render(
    <I18nProvider fixedLocale="zh">
      <SessionIssuePanel
        issueId={8}
        issueTitle="Demo"
        projectId={1}
        session={session}
        onOpenIssue={() => undefined}
      />
    </I18nProvider>,
  );
}

function runParameterLabels(): string[] {
  const heading = screen.getByRole("heading", { name: "运行参数" });
  const card = heading.closest("section");
  if (!card) {
    throw new Error("运行参数卡片不存在");
  }
  return Array.from(card.querySelectorAll("dt")).map(
    (item) => item.textContent ?? "",
  );
}

function runParameterValue(label: string): string {
  const heading = screen.getByRole("heading", { name: "运行参数" });
  const card = heading.closest("section");
  if (!card) {
    throw new Error("运行参数卡片不存在");
  }
  const row = Array.from(card.querySelectorAll("div")).find(
    (item) => item.querySelector("dt")?.textContent === label,
  );
  return row?.querySelector("dd")?.textContent ?? "";
}

describe("SessionIssuePanel 运行参数模型", () => {
  it("shows startup model under agent", async () => {
    renderPanel(makeSession());
    await waitFor(() => {
      expect(screen.getByText("Demo")).toBeInTheDocument();
    });
    const labels = runParameterLabels();
    expect(labels.indexOf("模型")).toBe(labels.indexOf("智能体") + 1);
    expect(runParameterValue("模型")).toBe("gpt-5.5");
  });

  it("shows a dash when startup model is empty", async () => {
    renderPanel(makeSession({ startupModel: null }));
    await waitFor(() => {
      expect(screen.getByText("Demo")).toBeInTheDocument();
    });
    expect(runParameterValue("模型")).toBe("-");
  });
});
