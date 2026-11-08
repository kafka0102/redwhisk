import { fireEvent, render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import type { Locale } from "../../shared/i18n/i18n-constants";
import { IssueBoardHeader } from "./issue-board-header";
import { ChangeRequestList } from "./change-request-list";
import type { ChangeRequestListResponse } from "./change-request-commands";
import { listProjectChangeRequests } from "./change-request-commands";

vi.mock("./change-request-commands", async () => {
  const actual = await vi.importActual<
    typeof import("./change-request-commands")
  >("./change-request-commands");
  return { ...actual, listProjectChangeRequests: vi.fn() };
});

const NOW = Date.parse("2026-11-07T15:00:00Z");

function renderList(
  locale: Locale,
  ui: JSX.Element,
): ReturnType<typeof render> {
  return render(<I18nProvider initialLocale={locale}>{ui}</I18nProvider>);
}

function response(): ChangeRequestListResponse {
  return {
    tabCount: 8,
    counts: {
      reviewRequested: 3,
      createdByMe: 3,
      allOpen: 6,
      recentlyMerged: 1,
    },
    pullRequestRefs: [],
    rows: [
      row({
        id: 132,
        number: 132,
        title: "Remote issue sync",
        checksOk: 3,
        checksFailed: 1,
        checksPending: 0,
        reviewDecision: "review_required",
        remoteUpdatedAt: Date.parse("2026-11-07T14:58:00Z"),
        linkedIssues: [
          { issueId: 12, label: "#12", linkKind: "branch" },
          { issueId: 128, label: "GH #128", linkKind: "closing" },
        ],
      }),
      row({
        id: 127,
        number: 127,
        title: "Draft checks",
        state: "draft",
        checksOk: 2,
        checksFailed: 0,
        checksPending: 1,
        reviewDecision: "pending",
        remoteUpdatedAt: Date.parse("2026-11-07T12:00:00Z"),
        linkedIssues: [{ issueId: 7, label: "GL #7", linkKind: "closing" }],
      }),
      row({
        id: 130,
        number: 130,
        title: "Empty checks",
        state: "draft",
        checksOk: 0,
        checksFailed: 0,
        checksPending: 0,
        reviewDecision: "review_required",
        remoteUpdatedAt: Date.parse("2026-11-07T14:40:00Z"),
      }),
      row({
        id: 128,
        number: 128,
        title: "Unknown checks",
        checksOk: null,
        checksFailed: null,
        checksPending: null,
        reviewDecision: "none",
        remoteUpdatedAt: Date.parse("2026-11-07T13:00:00Z"),
        linkedIssues: [{ issueId: 12, label: "#12", linkKind: "branch" }],
      }),
      row({
        id: 140,
        number: 140,
        title: "Changes",
        checksOk: 1,
        checksFailed: 1,
        checksPending: 0,
        reviewDecision: "changes_requested",
        remoteUpdatedAt: Date.parse("2026-11-07T01:00:00Z"),
      }),
      row({
        id: 125,
        number: 125,
        title: "Merged row",
        state: "merged",
        checksOk: 4,
        checksFailed: 0,
        checksPending: 0,
        reviewDecision: "approved",
        remoteUpdatedAt: Date.parse("2026-11-06T15:00:00Z"),
      }),
    ],
  };
}

function row(
  patch: Partial<ChangeRequestListResponse["rows"][number]> & {
    id: number;
    number: number;
    title: string;
  },
): ChangeRequestListResponse["rows"][number] {
  return {
    url: `https://github.com/acme/redwhisk/pull/${patch.number}`,
    provider: "github",
    state: "open",
    authorLogin: "yujianjia",
    sourceBranch: "feat/remote-issue",
    targetBranch: "main",
    checksOk: 0,
    checksFailed: 0,
    checksPending: 0,
    reviewDecision: "none",
    remoteUpdatedAt: NOW,
    linkedIssues: [],
    ...patch,
  };
}

describe("change request list", () => {
  it("shows review copy, wrapped links, and does not navigate the row", () => {
    const onOpenUrl = vi.fn();
    const onOpenDetail = vi.fn();
    renderList(
      "zh",
      <ChangeRequestList
        filter="review_requested"
        now={NOW}
        response={response()}
        sourceMode="remote"
        syncSlot={<span>slot</span>}
        onOpenUrl={onOpenUrl}
        onOpenDetail={onOpenDetail}
      />,
    );

    expect(screen.getByRole("button", { name: "需要我审阅" })).toHaveClass(
      "is-selected",
    );
    expect(screen.getByText("3/4 通过")).toHaveClass(
      "change-request-check--danger",
    );
    expect(screen.getAllByText("待审阅")[0]).toHaveClass(
      "change-request-review--warning",
    );
    expect(screen.getByText("2 通过 · 1 运行中")).toHaveClass(
      "change-request-check--warning",
    );
    expect(screen.getByText("等待检查")).toHaveClass(
      "change-request-review--neutral",
    );
    expect(screen.getByText("0/0 通过")).toHaveClass(
      "change-request-check--success",
    );
    expect(
      screen
        .getAllByText("未知")
        .some((node) => node.classList.contains("change-request-check--muted")),
    ).toBe(true);
    expect(screen.getByText("需要修改")).toHaveClass(
      "change-request-review--danger",
    );
    expect(screen.getByText(/2 分钟前/)).toBeInTheDocument();
    expect(screen.getByText(/14 小时前/)).toBeInTheDocument();
    expect(screen.getByText(/昨天/)).toBeInTheDocument();
    expect(
      [...document.querySelectorAll(".change-request-link")].map(
        (link) => link.textContent,
      ),
    ).toEqual(["#12", "GH #128", "GL #7", "#12"]);
    expect(screen.queryByText(/\+\d/)).toBeNull();
    expect(screen.getByText("GL #7")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "打开" })[0]).toHaveAttribute(
      "href",
      "https://github.com/acme/redwhisk/pull/132",
    );
    fireEvent.click(screen.getAllByRole("row")[0]);
    expect(onOpenUrl).not.toHaveBeenCalled();
    expect(onOpenDetail).toHaveBeenCalledWith(
      expect.objectContaining({ number: 132, provider: "github" }),
    );
    fireEvent.click(screen.getAllByRole("link", { name: "打开" })[0]);
    expect(onOpenUrl).toHaveBeenCalledWith(
      "https://github.com/acme/redwhisk/pull/132",
    );
    expect(screen.getByText("slot")).toBeInTheDocument();
    expect(screen.queryByText("已同步")).toBeNull();
  });

  it("uses english relative time", () => {
    renderList(
      "en",
      <ChangeRequestList now={NOW} response={response()} sourceMode="mixed" />,
    );
    expect(screen.getByText(/2 minutes ago/)).toBeInTheDocument();
    expect(screen.getByText(/14 hours ago/)).toBeInTheDocument();
    expect(screen.getByText(/yesterday/)).toBeInTheDocument();
  });

  it("keeps filters when the current filter is empty", () => {
    renderList(
      "zh",
      <ChangeRequestList
        filter="review_requested"
        now={NOW}
        response={{ ...response(), rows: [] }}
        sourceMode="remote"
      />,
    );
    expect(screen.getByText("标题")).toBeInTheDocument();
    expect(
      screen.getByText("没有需要你审阅的 Pull request"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Pull requests 还没有连接")).toBeNull();
  });

  it("shows the connection empty state only for local mode", () => {
    const onOpenProjectSettings = vi.fn();
    const { rerender } = renderList(
      "zh",
      <ChangeRequestList
        now={NOW}
        response={response()}
        sourceMode={null}
        onOpenProjectSettings={onOpenProjectSettings}
      />,
    );
    expect(screen.queryByRole("button", { name: "需要我审阅" })).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("去设置连接")).toBeNull();

    rerender(
      <I18nProvider initialLocale="zh">
        <ChangeRequestList
          now={NOW}
          response={response()}
          sourceMode="local"
          onOpenProjectSettings={onOpenProjectSettings}
        />
      </I18nProvider>,
    );
    expect(screen.queryByRole("button", { name: "需要我审阅" })).toBeNull();
    expect(screen.queryByText("Remote issue sync")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "去设置连接" }));
    expect(onOpenProjectSettings).toHaveBeenCalledOnce();
  });

  it("hides a zero tab count until the source mode is known", async () => {
    vi.mocked(listProjectChangeRequests).mockResolvedValue(response());
    const { rerender } = renderList(
      "en",
      <IssueBoardHeader
        issueCount={4}
        pane="issues"
        projectId={1}
        sourceMode={null}
        onPaneChange={vi.fn()}
      />,
    );
    expect(
      screen
        .getByRole("tab", { name: "Pull requests" })
        .querySelector(".issue-board-tab__count"),
    ).toBeNull();

    rerender(
      <I18nProvider initialLocale="en">
        <IssueBoardHeader
          issueCount={4}
          pane="issues"
          projectId={1}
          sourceMode="local"
          onPaneChange={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(
      screen
        .getByRole("tab", { name: "Pull requests" })
        .querySelector(".issue-board-tab__count")?.textContent,
    ).toBe("0");

    rerender(
      <I18nProvider initialLocale="en">
        <IssueBoardHeader
          issueCount={4}
          pane="issues"
          projectId={1}
          sourceMode="remote"
          onPaneChange={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(await screen.findByText("8")).toBeInTheDocument();
  });
});
