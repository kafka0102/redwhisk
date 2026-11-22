import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { describe, expect, it, vi } from "vitest";

import { listAgentSessions } from "../../agents/agent-session-commands";
import { I18nProvider } from "../../../shared/i18n/i18n";
import "../../../shared/styles/issue-detail.css";
import "../../../shared/styles/session-side-panel.css";
import { makeAgentSession } from "../../../test/agent-session-fixture";
import {
  IssueDetailSideCards,
  IssueReadOnlyLabelRow,
} from "./issue-detail-side-cards";
import type {
  IssueDetailProjection,
  LinkedChangeRequestSummary,
} from "./issue-detail-commands";

vi.mock("../../agents/agent-session-commands", () => ({
  listAgentSessions: vi.fn(),
}));

const listAgentSessionsMock = vi.mocked(listAgentSessions);
const openUrlMock = vi.mocked(openUrl);

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const hostLabels = ["仓库", "远端状态", "作者", "指派"] as const;

function projection(): IssueDetailProjection {
  return {
    provider: "github",
    repo: "kafka0102/rumengling",
    externalUrl: "https://github.com/kafka0102/rumengling/issues/1",
    remoteState: "open",
    authorLogin: "kafka0102",
    assignees: [],
    labels: [],
  };
}

function linkedRequest(): LinkedChangeRequestSummary {
  return {
    provider: "github",
    url: "https://github.com/acme/redwhisk/pull/12",
    number: 12,
    state: "closed",
    checksOk: 2,
    checksFailed: 1,
    checksPending: 0,
    title: "Fix login",
    sourceBranch: "feat/login",
    targetBranch: "main",
  };
}

function renderHostCard(): void {
  render(
    <I18nProvider fixedLocale="zh">
      <IssueDetailSideCards
        canOpenSession={false}
        issueStatus="todo"
        linkedChangeRequests={[]}
        linkedSessionId={null}
        projectId={1}
        projection={projection()}
        writebackError={null}
        writebackPending={false}
        onOpenSession={vi.fn()}
        onRetryWriteback={vi.fn()}
      />
    </I18nProvider>,
  );
}

function rowFor(label: string): HTMLElement {
  const host = screen.getByRole("region", { name: "GitHub" });
  const row = withinHostRow(host, label);
  if (row == null) {
    throw new Error(`${label} 没有和值放在同一行`);
  }
  return row;
}

function withinHostRow(host: HTMLElement, label: string): HTMLElement | null {
  const match = Array.from(host.querySelectorAll("div")).find(
    (item) => item.querySelector("dt")?.textContent === label,
  );
  return match ?? null;
}

function localMetaRowStyle(): CSSStyleDeclaration {
  const reference = document.createElement("div");
  reference.className = "session-issue-panel__meta-row";
  document.body.appendChild(reference);
  return window.getComputedStyle(reference);
}

describe("IssueDetailSideCards GitHub 仓库信息", () => {
  it("标签和值与本地会话信息一样排在同一行", () => {
    renderHostCard();
    const localStyle = localMetaRowStyle();
    expect(localStyle.display).toBe("grid");
    expect(localStyle.gridTemplateColumns.match(/minmax\(/g)).toHaveLength(2);

    for (const label of hostLabels) {
      const row = rowFor(label);
      const style = window.getComputedStyle(row);
      expect(row.querySelector("dd")).not.toBeNull();
      expect(style.display).toBe(localStyle.display);
      expect(style.gridTemplateColumns).toBe(localStyle.gridTemplateColumns);
    }
    document
      .querySelectorAll("body > .session-issue-panel__meta-row")
      .forEach((node) => node.remove());
  });
});

describe("Issue 详情标签与远程侧栏", () => {
  it("彩色标签文字与看板芯片一样是白色", () => {
    render(
      <I18nProvider fixedLocale="zh">
        <IssueReadOnlyLabelRow
          labels={[{ name: "think-feature", color: "#2563EB" }]}
        />
      </I18nProvider>,
    );

    expect(
      window.getComputedStyle(screen.getByText("think-feature")).color,
    ).toBe("rgb(255, 255, 255)");
  });

  it("远程详情的会话卡片和 GitHub 卡片共用同一侧栏，不再多一条左边线", async () => {
    listAgentSessionsMock.mockResolvedValue({
      sessions: [makeAgentSession({ sessionId: 12, projectId: 1 })],
    });
    render(
      <I18nProvider fixedLocale="zh">
        <IssueDetailSideCards
          canOpenSession
          issueStatus="running"
          linkedChangeRequests={[]}
          linkedSessionId={12}
          projectId={1}
          projection={projection()}
          writebackError={null}
          writebackPending={false}
          onOpenSession={vi.fn()}
          onRetryWriteback={vi.fn()}
        />
      </I18nProvider>,
    );

    const github = screen.getByRole("region", { name: "GitHub" });
    const sessionHeading = await screen.findByRole("heading", {
      name: "会话信息",
    });
    const sessionRegion = screen.getByRole("complementary", {
      name: "会话信息",
    });
    const panel = sessionRegion.querySelector(".issue-readonly-session-panel");

    expect(sessionHeading.closest(".issue-page__side")).toBe(
      github.closest(".issue-page__side"),
    );
    expect(document.querySelectorAll(".issue-page__side")).toHaveLength(1);
    const regionStyle = window.getComputedStyle(sessionRegion);
    expect(regionStyle.borderLeftStyle).toBe("none");
    expect(regionStyle.paddingLeft).toMatch(/^0(px)?$/);
    expect(panel).not.toBeNull();
    const panelStyle = window.getComputedStyle(panel as Element);
    expect(panelStyle.paddingTop).toMatch(/^0(px)?$/);
    expect(panelStyle.paddingLeft).toMatch(/^0(px)?$/);
  });

  it("关联 PR 使用卡片布局并保留应用内查看、宿主打开与重新打开动作", async () => {
    const user = userEvent.setup();
    const onOpenChangeRequest = vi.fn();
    const onReopenIssue = vi.fn();
    render(
      <I18nProvider fixedLocale="zh">
        <IssueDetailSideCards
          canOpenSession={false}
          issueStatus="completed"
          linkedChangeRequests={[linkedRequest()]}
          linkedSessionId={null}
          projectId={1}
          projection={projection()}
          writebackError={null}
          writebackPending={false}
          onOpenSession={vi.fn()}
          onOpenChangeRequest={onOpenChangeRequest}
          onReopenIssue={onReopenIssue}
          onRetryWriteback={vi.fn()}
        />
      </I18nProvider>,
    );

    const card = screen.getByRole("region", { name: "关联 PR #12" });
    const hostCard = screen.getByRole("region", { name: "GitHub" });
    const cardStyle = window.getComputedStyle(card);
    const hostCardStyle = window.getComputedStyle(hostCard);
    expect(card).toHaveClass("session-issue-panel__card");
    expect(cardStyle.display).toBe("grid");
    expect(cardStyle.padding).toBe("12px");
    expect(cardStyle.borderStyle).toBe("solid");
    expect(cardStyle.borderWidth).toBe("1px");
    expect(cardStyle.borderRadius).toBe(hostCardStyle.borderRadius);
    expect(cardStyle.borderColor).toBe(hostCardStyle.borderColor);
    expect(cardStyle.backgroundColor).toBe(hostCardStyle.backgroundColor);
    expect(card).toHaveTextContent("Fix login");
    expect(card).toHaveTextContent("2/3 通过");

    const actions = card.querySelector(".session-issue-panel__actions");
    expect(actions).not.toBeNull();
    expect(window.getComputedStyle(actions as Element).flexWrap).toBe("wrap");
    await user.click(
      within(card).getByRole("button", { name: "在应用内查看" }),
    );
    expect(onOpenChangeRequest).toHaveBeenCalledWith({
      provider: "github",
      number: 12,
    });
    await user.click(within(card).getByRole("button", { name: "打开 GitHub" }));
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/acme/redwhisk/pull/12",
    );
    await user.click(
      within(card).getByRole("button", { name: "重新打开 Issue" }),
    );
    expect(onReopenIssue).toHaveBeenCalledTimes(1);
  });
});
