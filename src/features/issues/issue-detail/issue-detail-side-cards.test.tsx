import { render, screen } from "@testing-library/react";
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
import type { IssueDetailProjection } from "./issue-detail-commands";

vi.mock("../../agents/agent-session-commands", () => ({
  listAgentSessions: vi.fn(),
}));

const listAgentSessionsMock = vi.mocked(listAgentSessions);

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
});
