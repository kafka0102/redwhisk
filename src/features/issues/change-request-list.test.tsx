import { fireEvent, render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import type { Locale } from "../../shared/i18n/i18n-constants";
import { IssueBoardHeader } from "./issue-board-header";
import { ChangeRequestList } from "./change-request-list";
import type { ChangeRequestListResponse } from "./change-request-commands";
import { listProjectChangeRequests } from "./change-request-commands";

import "../../shared/styles/issues-board.css";

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
      open: 6,
      closed: 2,
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
          { issueId: 12, label: "#12 · 本地标题", linkKind: "branch" },
          {
            issueId: 128,
            label: "#128 · 这是一个长到放不进关联列的标题",
            linkKind: "closing",
          },
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
        linkedIssues: [
          { issueId: 7, label: "#7 · 完成流程", linkKind: "closing" },
        ],
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
        linkedIssues: [
          { issueId: 12, label: "#12 · 本地标题", linkKind: "branch" },
        ],
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

function emptyResponse(): ChangeRequestListResponse {
  return {
    tabCount: 0,
    counts: {
      open: 0,
      closed: 0,
    },
    pullRequestRefs: [],
    rows: [],
  };
}

function expectEmptyChangeRequests(copy: string): void {
  expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Closed" })).toBeInTheDocument();
  expect(document.querySelector(".change-request-head")).toBeNull();
  expect(screen.queryByText("标题")).toBeNull();
  expect(screen.queryByText("检查 / 评审")).toBeNull();
  expect(screen.queryByText("关联 Issue")).toBeNull();
  expect(screen.queryByText("Title")).toBeNull();
  expect(screen.queryByText("Checks / review")).toBeNull();
  expect(screen.queryByText("Linked issues")).toBeNull();
  const empty = document.querySelector(".issue-pull-requests-empty");
  expect(empty).not.toBeNull();
  const icon = empty?.querySelector("svg");
  const copyNode = empty?.querySelector("p");
  expect(icon).not.toBeNull();
  expect(icon?.getAttribute("fill")).toBe("none");
  expect(icon?.getAttribute("stroke")).toBe("currentColor");
  expect(copyNode).toHaveTextContent(copy);
  expect(
    icon!.compareDocumentPosition(copyNode!) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).not.toBe(0);
  expect(window.getComputedStyle(empty!).placeItems).toBe("center");
}

describe("change request list", () => {
  it("shows review copy, wrapped links, and does not navigate the row", () => {
    const onOpenUrl = vi.fn();
    const onOpenDetail = vi.fn();
    renderList(
      "zh",
      <ChangeRequestList
        filter="open"
        now={NOW}
        response={response()}
        sourceMode="remote"
        syncSlot={<span>slot</span>}
        onOpenUrl={onOpenUrl}
        onOpenDetail={onOpenDetail}
      />,
    );

    const openFilter = screen.getByRole("button", { name: "Open" });
    const closedFilter = screen.getByRole("button", { name: "Closed" });
    expect(openFilter).toHaveAttribute("aria-pressed", "true");
    expect(closedFilter).toHaveAttribute("aria-pressed", "false");
    expect(
      openFilter.querySelector(".issue-board-tab__count"),
    ).toHaveTextContent("6");
    expect(
      closedFilter.querySelector(".issue-board-tab__count"),
    ).toHaveTextContent("2");
    expect(openFilter.querySelector(".issue-board-tab__count")).toHaveClass(
      "issue-board-tab__count",
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
    ).toEqual([
      "#12 · 本地标题",
      "#128 · 这是一个长到放不进关联列的标题",
      "#7 · 完成流程",
      "#12 · 本地标题",
    ]);
    expect(screen.queryByText(/\+\d/)).toBeNull();
    const shortLink = screen.getByText("#7 · 完成流程");
    expect(shortLink).toHaveTextContent("#7 · 完成流程");
    expect(shortLink.textContent).not.toMatch(/…|\.\.\./);
    expect(shortLink.tagName).not.toBe("BUTTON");
    const longLabel = "#128 · 这是一个长到放不进关联列的标题";
    const longLink = screen.getByText(longLabel);
    expect(longLink).toHaveAttribute("title", longLabel);
    expect(longLink.tagName).not.toBe("BUTTON");
    for (const link of [shortLink, longLink]) {
      const style = window.getComputedStyle(link);
      expect(style.whiteSpace).toBe("nowrap");
      expect(style.overflow).toBe("hidden");
      expect(style.textOverflow).toBe("ellipsis");
    }
    expect(screen.queryByRole("link", { name: "打开" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
    expect(document.querySelector("a[href*='github.com']")).toBeNull();
    const head = document.querySelector(".change-request-head");
    const row = document.querySelector(".change-request-row");
    const title = document.querySelector(".change-request-title");
    expect(head).not.toBeNull();
    expect(row).not.toBeNull();
    expect(title).not.toBeNull();
    expect(head!.querySelectorAll(":scope > span")).toHaveLength(3);
    expect(row!.children).toHaveLength(3);
    expect(window.getComputedStyle(head!).alignItems).toBe("center");
    expect(window.getComputedStyle(row!).alignItems).toBe("center");
    expect(window.getComputedStyle(title!).alignItems).toBe("center");
    expect(window.getComputedStyle(head!).gridTemplateColumns).toBe(
      window.getComputedStyle(row!).gridTemplateColumns,
    );
    fireEvent.click(screen.getByRole("heading", { name: "Remote issue sync" }));
    expect(onOpenUrl).not.toHaveBeenCalled();
    expect(onOpenDetail).toHaveBeenCalledWith(
      expect.objectContaining({ number: 132, provider: "github" }),
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
        filter="open"
        now={NOW}
        response={{ ...response(), rows: [] }}
        sourceMode="remote"
      />,
    );
    expectEmptyChangeRequests("没有打开的 Pull request");
    expect(screen.queryByText("Pull requests 还没有连接")).toBeNull();
  });

  it("shows the header and the row when one pull request is open", () => {
    renderList(
      "zh",
      <ChangeRequestList
        filter="open"
        now={NOW}
        provider="github"
        response={{
          ...emptyResponse(),
          counts: { open: 1, closed: 0 },
          rows: [
            row({
              id: 7,
              number: 7,
              title: "完成流程",
              linkedIssues: [
                { issueId: 7, label: "#7 · 完成流程", linkKind: "closing" },
              ],
            }),
          ],
        }}
        sourceMode="remote"
      />,
    );
    expect(document.querySelector(".change-request-head")).not.toBeNull();
    expect(screen.getByText("标题")).toBeInTheDocument();
    expect(screen.getByText("检查 / 评审")).toBeInTheDocument();
    expect(screen.getByText("关联 Issue")).toBeInTheDocument();
    expect(document.querySelector(".change-request-row")).not.toBeNull();
    expect(screen.getByText("#7 · 完成流程")).toBeInTheDocument();
    expect(screen.queryByText("没有打开的 Pull request")).toBeNull();
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
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
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
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    expect(screen.queryByText("Remote issue sync")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "去设置连接" }));
    expect(onOpenProjectSettings).toHaveBeenCalledOnce();
    expect(screen.queryByText("Pull requests 还没有连接")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
    const empty = screen
      .getByRole("button", { name: "去设置连接" })
      .closest("section");
    expect(empty?.querySelector("h3")).toBeNull();
    expect(empty?.querySelectorAll("button")).toHaveLength(1);
    expect(window.getComputedStyle(empty!).gridArea).toBe("kanban");
    expect(window.getComputedStyle(empty!).placeItems).toBe("center");
  });

  it("uses english connection button copy without a disconnected title", () => {
    renderList(
      "en",
      <ChangeRequestList
        now={NOW}
        response={response()}
        sourceMode="local"
        onOpenProjectSettings={vi.fn()}
      />,
    );
    expect(screen.queryByText("Pull requests are not connected")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Set up connection" }),
    ).toBeInTheDocument();
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

  it("uses Merge requests for GitLab tabs and keeps Pull requests otherwise", () => {
    const { rerender } = renderList(
      "zh",
      <IssueBoardHeader
        issueCount={4}
        pane="issues"
        projectId={1}
        provider="gitlab"
        sourceMode="remote"
        onPaneChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("tab", { name: "Merge requests" }),
    ).toBeInTheDocument();

    rerender(
      <I18nProvider initialLocale="en">
        <IssueBoardHeader
          issueCount={4}
          pane="issues"
          projectId={1}
          provider="gitlab"
          sourceMode="local"
          onPaneChange={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("tab", { name: "Merge requests" }),
    ).toBeInTheDocument();

    rerender(
      <I18nProvider initialLocale="zh">
        <IssueBoardHeader
          issueCount={4}
          pane="issues"
          projectId={1}
          provider="github"
          sourceMode="remote"
          onPaneChange={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("tab", { name: "Pull requests" }),
    ).toBeInTheDocument();

    rerender(
      <I18nProvider initialLocale="zh">
        <>
          <IssueBoardHeader
            issueCount={4}
            pane="pullRequests"
            projectId={1}
            provider={null}
            sourceMode={null}
            onPaneChange={vi.fn()}
          />
          <ChangeRequestList
            now={NOW}
            provider={null}
            response={response()}
            sourceMode={null}
            onOpenProjectSettings={vi.fn()}
          />
        </>
      </I18nProvider>,
    );
    const tab = screen.getByRole("tab", { name: "Pull requests" });
    expect(tab.querySelector(".issue-board-tab__count")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByRole("button", { name: "去设置连接" })).toBeNull();
    expect(screen.queryByText("Pull requests 还没有连接")).toBeNull();
  });

  it("shows GitLab empty copy and region names in Chinese", () => {
    const { rerender } = renderList(
      "zh",
      <ChangeRequestList
        filter="open"
        now={NOW}
        provider="gitlab"
        response={emptyResponse()}
        sourceMode="remote"
      />,
    );
    expect(
      screen.getByRole("region", { name: "Merge requests" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Merge request 筛选")).toBeInTheDocument();
    expectEmptyChangeRequests("没有打开的 Merge request");

    rerender(
      <I18nProvider initialLocale="zh">
        <ChangeRequestList
          filter="closed"
          now={NOW}
          provider="gitlab"
          response={emptyResponse()}
          sourceMode="remote"
        />
      </I18nProvider>,
    );
    expectEmptyChangeRequests("没有关闭的 Merge request");

    rerender(
      <I18nProvider initialLocale="zh">
        <ChangeRequestList
          filter="open"
          now={NOW}
          provider="github"
          response={emptyResponse()}
          sourceMode="remote"
        />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("region", { name: "Pull requests" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Pull request 筛选")).toBeInTheDocument();
    expectEmptyChangeRequests("没有打开的 Pull request");

    rerender(
      <I18nProvider initialLocale="zh">
        <ChangeRequestList
          filter="closed"
          now={NOW}
          provider="github"
          response={emptyResponse()}
          sourceMode="remote"
        />
      </I18nProvider>,
    );
    expectEmptyChangeRequests("没有关闭的 Pull request");
  });

  it("shows open and closed empty copy in English", () => {
    const { rerender } = renderList(
      "en",
      <ChangeRequestList
        filter="open"
        now={NOW}
        provider="gitlab"
        response={emptyResponse()}
        sourceMode="remote"
      />,
    );
    expect(screen.getByLabelText("Merge request filters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expectEmptyChangeRequests("No open merge requests");

    rerender(
      <I18nProvider initialLocale="en">
        <ChangeRequestList
          filter="closed"
          now={NOW}
          provider="gitlab"
          response={emptyResponse()}
          sourceMode="remote"
        />
      </I18nProvider>,
    );
    expectEmptyChangeRequests("No closed merge requests");

    rerender(
      <I18nProvider initialLocale="en">
        <ChangeRequestList
          filter="open"
          now={NOW}
          provider="github"
          response={emptyResponse()}
          sourceMode="remote"
        />
      </I18nProvider>,
    );
    expect(screen.getByLabelText("Pull request filters")).toBeInTheDocument();
    expectEmptyChangeRequests("No open pull requests");

    rerender(
      <I18nProvider initialLocale="en">
        <ChangeRequestList
          filter="closed"
          now={NOW}
          provider="github"
          response={emptyResponse()}
          sourceMode="remote"
        />
      </I18nProvider>,
    );
    expectEmptyChangeRequests("No closed pull requests");
  });
});
