import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";

import { I18nProvider } from "../../shared/i18n/i18n";
import { ChangeRequestDetailPage } from "./change-request-detail";
import {
  closeChangeRequest,
  getProjectChangeRequest,
  markChangeRequestReady,
  mergeChangeRequest,
  requestChangeRequestReview,
  type ChangeRequestDetail,
} from "./change-request-commands";

const focusState = vi.hoisted(() => ({
  initial: true,
  listeners: new Set<(focused: boolean) => void>(),
}));

vi.mock("../../shared/window/use-window-focus", async () => {
  const React = await import("react");
  return {
    useWindowFocus: () => {
      const [focused, setFocused] = React.useState(focusState.initial);
      React.useEffect(() => {
        const listener = (next: boolean) => {
          setFocused(next);
        };
        focusState.listeners.add(listener);
        return () => {
          focusState.listeners.delete(listener);
        };
      }, []);
      return focused;
    },
  };
});

vi.mock("./change-request-commands", async () => {
  const actual = await vi.importActual<
    typeof import("./change-request-commands")
  >("./change-request-commands");
  return {
    ...actual,
    closeChangeRequest: vi.fn(),
    getProjectChangeRequest: vi.fn(),
    markChangeRequestReady: vi.fn(),
    mergeChangeRequest: vi.fn(),
    requestChangeRequestReview: vi.fn(),
  };
});

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const getDetailMock = vi.mocked(getProjectChangeRequest);
const markReadyMock = vi.mocked(markChangeRequestReady);
const requestReviewMock = vi.mocked(requestChangeRequestReview);
const closeRequestMock = vi.mocked(closeChangeRequest);
const mergeRequestMock = vi.mocked(mergeChangeRequest);
const openUrlMock = vi.mocked(openUrl);

function detail(patch: Partial<ChangeRequestDetail> = {}): ChangeRequestDetail {
  return {
    id: 1,
    provider: "github",
    number: 132,
    title: "Remote issue sync",
    url: "https://github.com/acme/redwhisk/pull/132",
    state: "open",
    body: "Sync issues from GitHub.",
    authorLogin: "lin",
    sourceBranch: "feat/remote-issue",
    targetBranch: "main",
    commitCount: 2,
    additions: 412,
    deletions: 87,
    labels: ["enhancement"],
    reviewers: [{ login: "maya", state: "approved" }],
    mergeable: "blocked",
    mergeStateStatus: "BLOCKED",
    reviewDecision: "REVIEW_REQUIRED",
    blockingReasons: ["Review required"],
    mergeMethod: "squash",
    mergeCommitSha: null,
    detailStatus: "fresh",
    detailError: null,
    files: [
      {
        path: "src/lib.rs",
        additions: 4,
        deletions: 1,
        patch: "+ok",
        patchStatus: "ready",
      },
      {
        path: "big.bin",
        additions: 0,
        deletions: 0,
        patch: null,
        patchStatus: "too_large",
      },
      {
        path: "photo.png",
        additions: 0,
        deletions: 0,
        patch: null,
        patchStatus: "binary",
      },
      {
        path: "missing.rs",
        additions: 0,
        deletions: 0,
        patch: null,
        patchStatus: "missing",
      },
    ],
    checks: [
      {
        name: "lint",
        status: "passed",
        durationMs: 12000,
        logUrl: "https://example.test/lint",
      },
      {
        name: "test",
        status: "failed",
        durationMs: 134000,
        logUrl: "https://example.test/test",
      },
      {
        name: "e2e",
        status: "pending",
        durationMs: 80000,
        logUrl: "https://example.test/e2e",
      },
    ],
    reviews: [
      {
        author: "maya",
        kind: "review",
        body: "Looks good",
        createdAt: Date.parse("2026-11-07T13:00:00Z"),
        state: "APPROVED",
      },
    ],
    comments: [
      {
        author: "lin",
        kind: "comment",
        body: "Will follow up",
        createdAt: Date.parse("2026-11-07T13:10:00Z"),
        state: null,
      },
    ],
    linkedIssues: [
      { issueId: 128, label: "#128 · 残句处理", linkKind: "closing" },
    ],
    readySupported: true,
    reviewSupported: true,
    supportedMergeMethods: ["squash", "merge", "rebase"],
    sourceBranchDeleted: null,
    ...patch,
  };
}

function setPageVisibility(value: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => value,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function setWindowFocused(focused: boolean): void {
  focusState.initial = focused;
  for (const listener of focusState.listeners) {
    listener(focused);
  }
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderDetail(
  onOpenIssue?: (issueId: number) => void,
): ReturnType<typeof render> {
  return render(
    <I18nProvider fixedLocale="zh">
      <ChangeRequestDetailPage
        number={132}
        projectId={4}
        provider="github"
        onBack={() => undefined}
        onOpenIssue={onOpenIssue}
      />
    </I18nProvider>,
  );
}

function sideElement(): HTMLElement {
  const side = document.querySelector(".change-request-detail__side");
  if (!(side instanceof HTMLElement)) {
    throw new Error("missing side");
  }
  return side;
}

describe("change request detail", () => {
  beforeEach(() => {
    focusState.initial = true;
    focusState.listeners.clear();
    setPageVisibility("visible");
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    getDetailMock.mockReset();
    openUrlMock.mockReset();
    markReadyMock.mockReset();
    requestReviewMock.mockReset();
    closeRequestMock.mockReset();
    mergeRequestMock.mockReset();
    getDetailMock.mockResolvedValue(detail());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens overview without outer tabs or sync chrome", async () => {
    renderDetail();
    await flush();
    expect(screen.getByRole("heading", { name: /#132/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "概览" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("tab", { name: /Issues/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Pull requests/ })).toBeNull();
    expect(screen.queryByText("已同步")).toBeNull();
    expect(screen.queryByRole("button", { name: "刷新" })).toBeNull();
    expect(screen.getByText("lin")).toBeInTheDocument();
    expect(screen.getByText("2 个提交")).toBeInTheDocument();
  });

  it("hides commit count when the host omitted it", async () => {
    getDetailMock.mockResolvedValue(detail({ commitCount: null }));
    renderDetail();
    await flush();
    expect(screen.queryByText("0 个提交")).toBeNull();
  });

  it("shows tab counts and keeps zero counts unlabeled", async () => {
    getDetailMock.mockResolvedValue(
      detail({
        files: Array.from({ length: 12 }, (_, index) => ({
          path: `file-${index}.ts`,
          additions: 1,
          deletions: 0,
          patch: "+ok",
          patchStatus: "ready",
        })),
        checks: [],
        reviews: [],
        comments: [],
      }),
    );
    renderDetail();
    await flush();
    expect(screen.getByRole("tab", { name: "变更 12" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "检查" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "检查 0" })).toBeNull();
  });

  it("does not invent reviewers or labels", async () => {
    getDetailMock.mockResolvedValue(detail({ reviewers: [], labels: [] }));
    renderDetail();
    await flush();
    expect(screen.queryByText("审阅者")).toBeNull();
    expect(screen.queryByText("标签")).toBeNull();
  });

  it("lists every linked issue and opens the matching issue detail", async () => {
    const onOpenIssue = vi.fn();
    getDetailMock.mockResolvedValue(
      detail({
        linkedIssues: [
          { issueId: 12, label: "#12 · 本地标题", linkKind: "branch" },
          { issueId: 128, label: "#128 · 残句处理", linkKind: "closing" },
          { issueId: 7, label: "#7 · 完成流程", linkKind: "closing" },
        ],
      }),
    );
    renderDetail(onOpenIssue);
    await flush();
    expect(
      screen.getByRole("button", { name: "#128 · 残句处理" }),
    ).toHaveTextContent("#128 · 残句处理");
    expect(
      screen.getByRole("button", { name: "#7 · 完成流程" }),
    ).toHaveTextContent("#7 · 完成流程");
    expect(
      screen.getByRole("button", { name: "#12 · 本地标题" }),
    ).toHaveTextContent("#12 · 本地标题");
    expect(screen.queryByText(/GH #|GL #/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "#128 · 残句处理" }));
    expect(onOpenIssue).toHaveBeenCalledWith(128);
    fireEvent.click(screen.getByRole("button", { name: "#7 · 完成流程" }));
    expect(onOpenIssue).toHaveBeenCalledWith(7);
    fireEvent.click(screen.getByRole("button", { name: "#12 · 本地标题" }));
    expect(onOpenIssue).toHaveBeenCalledWith(12);
  });

  it("uses host blocking reasons instead of a check-failure sentence", async () => {
    renderDetail();
    await flush();
    expect(screen.getByText("Review required")).toBeInTheDocument();
    expect(screen.queryByText(/1 个检查失败/)).toBeNull();
    expect(screen.queryByText(/1 failed/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: "合并 Pull Request" }),
    ).toBeDisabled();
    expect(screen.queryByLabelText("合并后删除源分支")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "标记就绪" }));
    fireEvent.click(screen.getByRole("button", { name: "请求审阅" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(getDetailMock).toHaveBeenCalledTimes(1);
    expect(markReadyMock).not.toHaveBeenCalled();
    expect(requestReviewMock).not.toHaveBeenCalled();
    expect(closeRequestMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "在 GitHub 打开" }));
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/acme/redwhisk/pull/132",
    );
    expect(
      screen.getAllByRole("button", { name: "在 GitHub 打开" }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "在 GitHub 中处理" }),
    ).toBeNull();
    expect(
      screen
        .getByRole("heading", { name: "概要" })
        .compareDocumentPosition(screen.getByRole("heading", { name: "合并" })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("hides the merge button after merge", async () => {
    getDetailMock.mockResolvedValue(
      detail({
        state: "merged",
        mergeCommitSha: "9f3c2a1",
        blockingReasons: [],
      }),
    );
    renderDetail();
    await flush();
    expect(screen.getByText("已合并")).toBeInTheDocument();
    expect(screen.queryByText("已合并到 main")).toBeNull();
    expect(screen.queryByText(/9f3c2a1/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "合并" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "合并 Pull Request" }),
    ).toBeNull();
  });

  it("shows 已合并 in the summary and omits the merge panel", async () => {
    getDetailMock.mockResolvedValue(
      detail({
        state: "merged",
        targetBranch: "main",
        mergeCommitSha: "abc123",
      }),
    );
    renderDetail();
    await flush();
    const side = document.querySelector(".change-request-detail__side");
    if (!(side instanceof HTMLElement)) {
      throw new Error("missing side");
    }
    const summary = within(side)
      .getByRole("heading", { name: "概要" })
      .closest("section");
    if (summary == null) {
      throw new Error("missing summary");
    }
    expect(within(summary).getByText("已合并")).toBeInTheDocument();
    expect(within(summary).queryByText("merged")).toBeNull();
    expect(within(side).queryByRole("heading", { name: "合并" })).toBeNull();
    expect(within(side).queryByText("已合并到 main")).toBeNull();
    expect(within(side).queryByText("abc123")).toBeNull();
  });

  it("shows Chinese labels for open, closed, and draft", async () => {
    getDetailMock.mockResolvedValue(detail({ state: "open" }));
    const openView = renderDetail();
    await flush();
    expect(screen.getByText("打开")).toBeInTheDocument();
    expect(screen.queryByText("open")).toBeNull();
    openView.unmount();

    getDetailMock.mockResolvedValue(detail({ state: "closed" }));
    const closedView = renderDetail();
    await flush();
    expect(screen.getByText("已关闭")).toBeInTheDocument();
    expect(screen.queryByText("closed")).toBeNull();
    closedView.unmount();

    getDetailMock.mockResolvedValue(detail({ state: "draft" }));
    renderDetail();
    await flush();
    expect(screen.getByText("草稿")).toBeInTheDocument();
    expect(screen.queryByText("draft")).toBeNull();
  });

  it("shows English labels for open, closed, draft, and merged", async () => {
    const cases = [
      ["open", "Open"],
      ["closed", "Closed"],
      ["draft", "Draft"],
      ["merged", "Merged"],
    ] as const;
    for (const [state, label] of cases) {
      getDetailMock.mockResolvedValue(detail({ state }));
      const view = render(
        <I18nProvider fixedLocale="en">
          <ChangeRequestDetailPage
            number={132}
            projectId={4}
            provider="github"
            onBack={() => undefined}
          />
        </I18nProvider>,
      );
      await flush();
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByText(state)).toBeNull();
      view.unmount();
    }
  });

  it("shows an unknown merge state as itself", async () => {
    getDetailMock.mockResolvedValue(detail({ state: "weird" }));
    renderDetail();
    await flush();
    expect(screen.getByText("weird")).toBeInTheDocument();
    expect(screen.queryByText("已合并")).toBeNull();
  });

  it("keeps the merge card beside the summary when the request is open", async () => {
    renderDetail();
    await flush();
    const side = sideElement();
    expect(
      within(side).getByRole("heading", { name: "概要" }),
    ).toBeInTheDocument();
    expect(
      within(side).getByRole("heading", { name: "合并" }),
    ).toBeInTheDocument();
  });

  it("keeps the merge card when the request is closed", async () => {
    getDetailMock.mockResolvedValue(detail({ state: "closed" }));
    renderDetail();
    await flush();
    expect(
      within(sideElement()).getByRole("heading", { name: "合并" }),
    ).toBeInTheDocument();
  });

  it("keeps the merge card when the request is a draft", async () => {
    getDetailMock.mockResolvedValue(detail({ state: "draft" }));
    renderDetail();
    await flush();
    expect(
      within(sideElement()).getByRole("heading", { name: "合并" }),
    ).toBeInTheDocument();
  });

  it("renders ready diffs and host fallbacks for other patch states", async () => {
    renderDetail();
    await flush();
    fireEvent.click(screen.getByRole("tab", { name: "变更 4" }));
    expect(screen.getByText("+ok")).toBeInTheDocument();
    expect(screen.getByText("diff 太大，无法在这里显示。")).toBeInTheDocument();
    expect(screen.getByText("这是二进制文件。")).toBeInTheDocument();
    expect(screen.getByText("没有补丁。")).toBeInTheDocument();
    expect(screen.queryByText("GIT binary patch")).toBeNull();
  });

  it("sorts checks as failed, running, then passed", async () => {
    renderDetail();
    await flush();
    fireEvent.click(screen.getByRole("tab", { name: "检查 3" }));
    const names = [...document.querySelectorAll(".change-request-check-row p")]
      .map((node) => node.textContent)
      .filter((text) => text === "test" || text === "e2e" || text === "lint");
    expect(names).toEqual(["test", "e2e", "lint"]);
    expect(screen.getByText("1 个失败")).toBeInTheDocument();
  });

  it("shows read-only discussion without an input", async () => {
    renderDetail();
    await flush();
    fireEvent.click(screen.getByRole("tab", { name: "讨论 2" }));
    expect(screen.getByText("maya")).toBeInTheDocument();
    expect(screen.getByText("review")).toBeInTheDocument();
    expect(screen.getByText("APPROVED")).toBeInTheDocument();
    expect(screen.getByText("comment")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows an error and host link when no snapshot exists", async () => {
    getDetailMock.mockResolvedValue(
      detail({
        detailStatus: "unavailable",
        detailError: "offline",
        files: [],
        checks: [],
        reviews: [],
        comments: [],
        body: "",
      }),
    );
    renderDetail();
    await flush();
    expect(
      screen.getByText("无法加载详情。仍可打开宿主。"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "在 GitHub 打开" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "在 GitHub 打开" }));
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/acme/redwhisk/pull/132",
    );
  });

  it("refreshes every 30 seconds while visible and focused, without overlapping", async () => {
    let resolveLoad: (value: ChangeRequestDetail) => void = () => undefined;
    getDetailMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    renderDetail();
    await flush();
    expect(getDetailMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getDetailMock).toHaveBeenCalledTimes(1);
    resolveLoad(detail());
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getDetailMock).toHaveBeenCalledTimes(2);
  });

  it("does not refresh while hidden or blurred", async () => {
    renderDetail();
    await flush();
    expect(getDetailMock).toHaveBeenCalledTimes(1);
    setPageVisibility("hidden");
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getDetailMock).toHaveBeenCalledTimes(1);
    setWindowFocused(false);
    await flush();
    setPageVisibility("visible");
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getDetailMock).toHaveBeenCalledTimes(1);
  });

  it("marks a draft ready only after the host detail comes back", async () => {
    let resolveReady: (value: ChangeRequestDetail) => void = () => undefined;
    markReadyMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReady = resolve;
        }),
    );
    getDetailMock.mockResolvedValue(detail({ state: "draft" }));
    renderDetail();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "标记就绪" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("草稿")).toBeInTheDocument();
    expect(markReadyMock).toHaveBeenCalledTimes(1);
    resolveReady(detail({ state: "open", title: "Ready window" }));
    await flush();
    expect(screen.getByText("打开")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Ready window/ }),
    ).toBeInTheDocument();
  });

  it("keeps the draft and does not retry when marking ready fails", async () => {
    markReadyMock.mockRejectedValue({
      code: "FORGE_UNAVAILABLE",
      message: "Credentials expired.",
      reason: "credentialExpired",
    });
    getDetailMock.mockResolvedValue(detail({ state: "draft" }));
    renderDetail();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "标记就绪" }));
    await flush();

    expect(markReadyMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("登录已过期");
    expect(screen.getByText("草稿")).toBeInTheDocument();
  });

  it("disables unsupported ready and review actions without calling the host", async () => {
    getDetailMock.mockResolvedValue(
      detail({ state: "draft", readySupported: false, reviewSupported: false }),
    );
    renderDetail();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "标记就绪" }));
    fireEvent.click(screen.getByRole("button", { name: "请求审阅" }));

    expect(screen.getByRole("button", { name: "标记就绪" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "请求审阅" })).toBeDisabled();
    expect(markReadyMock).not.toHaveBeenCalled();
    expect(requestReviewMock).not.toHaveBeenCalled();
  });

  it("requests review from a single reviewer field and ignores a blank value", async () => {
    requestReviewMock.mockResolvedValue(
      detail({
        reviewers: [
          { login: "maya", state: "approved" },
          { login: "lin", state: "requested" },
        ],
      }),
    );
    renderDetail();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "请求审阅" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "请求审阅" }));
    expect(requestReviewMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("请填写审阅者");

    fireEvent.change(within(dialog).getByLabelText("审阅者"), {
      target: { value: "lin" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "请求审阅" }));
    await flush();

    expect(requestReviewMock).toHaveBeenCalledTimes(1);
    expect(requestReviewMock).toHaveBeenCalledWith(
      expect.objectContaining({ reviewer: "lin", number: 132 }),
    );
  });

  it("does not close when confirmation is cancelled", async () => {
    renderDetail();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("关闭后不会合并。");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(closeRequestMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("打开")).toBeInTheDocument();
  });

  it("replaces the detail with closed, not merged, after close is confirmed", async () => {
    closeRequestMock.mockResolvedValue(detail({ state: "closed" }));
    renderDetail();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "确认关闭" }));
    await flush();

    expect(closeRequestMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("已关闭")).toBeInTheDocument();
    expect(screen.queryByText("merged")).toBeNull();
    expect(screen.getByRole("button", { name: "标记就绪" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "请求审阅" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
  });

  it("shows that mergeability is still being calculated", async () => {
    getDetailMock.mockResolvedValue(
      detail({ mergeable: null, blockingReasons: [], checks: [] }),
    );
    renderDetail();
    await flush();
    expect(screen.getAllByText("正在计算").length).toBeGreaterThan(0);
    expect(screen.queryByText("不可合并")).toBeNull();
    expect(
      screen.getByRole("button", { name: "合并 Pull Request" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "合并 Pull Request" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mergeRequestMock).not.toHaveBeenCalled();
  });

  it("treats a blank or unknown mergeable value as still calculating", async () => {
    for (const mergeable of ["", "UNKNOWN"]) {
      getDetailMock.mockResolvedValue(
        detail({ mergeable, blockingReasons: [], checks: [] }),
      );
      const view = renderDetail();
      await flush();
      expect(screen.getAllByText("正在计算").length).toBeGreaterThan(0);
      expect(screen.queryByText("不可合并")).toBeNull();
      expect(
        screen.getByRole("button", { name: "合并 Pull Request" }),
      ).toBeDisabled();
      view.unmount();
    }
  });

  it("lists every blocking reason and keeps merge disabled", async () => {
    getDetailMock.mockResolvedValue(
      detail({
        mergeable: "MERGEABLE",
        blockingReasons: ["test (ubuntu-latest) 失败", "需要 1 个批准"],
      }),
    );
    renderDetail();
    await flush();
    expect(screen.getByText("test (ubuntu-latest) 失败")).toBeInTheDocument();
    expect(screen.getByText("需要 1 个批准")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "合并 Pull Request" }),
    ).toBeDisabled();
  });

  it("lets a MERGEABLE request open the merge dialog even when checks failed", async () => {
    getDetailMock.mockResolvedValue(
      detail({ mergeable: "MERGEABLE", blockingReasons: [] }),
    );
    renderDetail();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "合并 Pull Request" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("radio", { name: "压缩合并" }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("checkbox", { name: "合并后删除源分支" }),
    ).toBeChecked();
    expect(
      within(dialog).queryByText("把 2 个提交压成 1 个，历史更干净。"),
    ).toBeNull();
    expect(within(dialog).queryByText("保留分支拓扑。")).toBeNull();
    expect(
      within(dialog).queryByText("线性历史，不产生 merge commit。"),
    ).toBeNull();
    expect(dialog.textContent ?? "").not.toMatch(/admin|auto|force/i);
  });

  it("shows only the clicked merge option help", async () => {
    getDetailMock.mockResolvedValue(
      detail({ mergeable: "MERGEABLE", blockingReasons: [], commitCount: 2 }),
    );
    renderDetail();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "合并 Pull Request" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "压缩合并 的说明" }),
    );
    expect(
      within(dialog).getByText("把 2 个提交压成 1 个，历史更干净。"),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("保留分支拓扑。")).toBeNull();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "创建合并提交 的说明" }),
    );
    expect(within(dialog).getByText("保留分支拓扑。")).toBeInTheDocument();
    expect(
      within(dialog).queryByText("把 2 个提交压成 1 个，历史更干净。"),
    ).toBeNull();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "变基合并 的说明" }),
    );
    expect(
      within(dialog).getByText("线性历史，不产生 merge commit。"),
    ).toBeInTheDocument();
  });

  it("uses a generic squash help sentence when the commit count is missing", async () => {
    getDetailMock.mockResolvedValue(
      detail({
        mergeable: "MERGEABLE",
        blockingReasons: [],
        commitCount: null,
      }),
    );
    renderDetail();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "合并 Pull Request" }));
    fireEvent.click(screen.getByRole("button", { name: "压缩合并 的说明" }));
    expect(
      screen.getByText("把多个提交压成 1 个，历史更干净。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/2 个/)).toBeNull();
  });

  it("disables a merge method the host does not support", async () => {
    getDetailMock.mockResolvedValue(
      detail({
        mergeable: "MERGEABLE",
        blockingReasons: [],
        supportedMergeMethods: ["squash", "merge"],
      }),
    );
    renderDetail();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "合并 Pull Request" }));
    expect(screen.getByRole("radio", { name: "变基合并" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "压缩合并" })).toBeEnabled();
  });

  it("enables GitLab merge only when the host says mergeable", async () => {
    getDetailMock.mockResolvedValue(
      detail({
        provider: "gitlab",
        mergeable: "mergeable",
        blockingReasons: [],
        checks: [],
      }),
    );
    renderDetail();
    await flush();
    expect(
      screen.getByRole("button", { name: "合并 Merge Request" }),
    ).toBeEnabled();
  });

  it("keeps merge disabled when the host reports a conflict", async () => {
    getDetailMock.mockResolvedValue(
      detail({
        mergeable: "CONFLICTING",
        blockingReasons: [],
        checks: [
          {
            name: "lint",
            status: "passed",
            durationMs: 1,
            logUrl: null,
          },
        ],
      }),
    );
    renderDetail();
    await flush();
    expect(
      screen.getByRole("button", { name: "合并 Pull Request" }),
    ).toBeDisabled();
    expect(mergeRequestMock).not.toHaveBeenCalled();
  });

  it("merges with squash and deletes the source branch by default", async () => {
    mergeRequestMock.mockResolvedValue(
      detail({
        state: "merged",
        mergeable: "MERGEABLE",
        blockingReasons: [],
        mergeMethod: "squash",
        mergeCommitSha: "9f3c2a1",
        targetBranch: "main",
        sourceBranchDeleted: false,
      }),
    );
    getDetailMock.mockResolvedValue(
      detail({ mergeable: "MERGEABLE", blockingReasons: [] }),
    );
    renderDetail();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "合并 Pull Request" }));
    fireEvent.click(screen.getByRole("button", { name: "合并" }));
    await flush();
    expect(mergeRequestMock).toHaveBeenCalledTimes(1);
    expect(mergeRequestMock).toHaveBeenCalledWith({
      projectId: 4,
      provider: "github",
      number: 132,
      method: "squash",
      deleteSourceBranch: true,
    });
    expect(screen.getByText("已合并")).toBeInTheDocument();
    expect(screen.queryByText("已合并到 main")).toBeNull();
    expect(screen.queryByText("Squash and merge")).toBeNull();
    expect(screen.queryByText("9f3c2a1")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByLabelText("合并后删除源分支")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "合并 Pull Request" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "标记就绪" })).toBeNull();
    expect(screen.queryByRole("button", { name: "请求审阅" })).toBeNull();
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
    expect(screen.queryByText("源分支已删除")).toBeNull();
  });

  it("omits source branch deletion when the box is unchecked", async () => {
    mergeRequestMock.mockResolvedValue(
      detail({ state: "merged", mergeable: "MERGEABLE", blockingReasons: [] }),
    );
    getDetailMock.mockResolvedValue(
      detail({ mergeable: "MERGEABLE", blockingReasons: [] }),
    );
    renderDetail();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "合并 Pull Request" }));
    fireEvent.click(screen.getByLabelText("合并后删除源分支"));
    fireEvent.click(screen.getByRole("button", { name: "合并" }));
    await flush();
    expect(mergeRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ deleteSourceBranch: false }),
    );
  });

  it("shows the host merge error and does not mark the request merged", async () => {
    mergeRequestMock.mockRejectedValue({
      code: "FORGE_UNAVAILABLE",
      message: "The change request action failed.",
      reason: "changeRequestActionFailed",
    });
    getDetailMock.mockResolvedValue(
      detail({ mergeable: "MERGEABLE", blockingReasons: [] }),
    );
    renderDetail();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "合并 Pull Request" }));
    fireEvent.click(screen.getByRole("button", { name: "合并" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("变更请求操作失败。");
    expect(screen.getByText("打开")).toBeInTheDocument();
    expect(screen.queryByText("merged")).toBeNull();
    expect(mergeRequestMock).toHaveBeenCalledTimes(1);
  });

  it("does not keep source branch deletion after the merge card is gone", async () => {
    getDetailMock.mockResolvedValue(
      detail({
        state: "merged",
        mergeMethod: "squash",
        mergeCommitSha: "9f3c2a1",
        blockingReasons: [],
        sourceBranchDeleted: true,
      }),
    );
    renderDetail();
    await flush();
    expect(screen.queryByText("源分支已删除")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "合并 Pull Request" }),
    ).toBeNull();
  });

  it("does not render the merge dialog before the detail arrives", async () => {
    getDetailMock.mockImplementation(() => new Promise(() => undefined));
    renderDetail();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("正在计算")).toBeNull();
  });

  it("列表行先显示标题", () => {
    getDetailMock.mockImplementation(() => new Promise(() => undefined));
    render(
      <I18nProvider fixedLocale="zh">
        <ChangeRequestDetailPage
          number={10}
          projectId={4}
          provider="github"
          listRow={{
            number: 10,
            title: "排行榜小程序",
            url: "https://github.com/acme/redwhisk/pull/10",
            provider: "github",
            state: "merged",
          }}
          onBack={() => undefined}
        />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("heading", { name: "#10 · 排行榜小程序" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "在 GitHub 打开" }),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回列表" })).toBeNull();
    expect(screen.getByText("正在加载详情")).toBeInTheDocument();
    expect(screen.queryByText("概要")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "在 GitHub 打开" }));
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/acme/redwhisk/pull/10",
    );
    expect(screen.queryByRole("tab")).toBeNull();
    const section = document.querySelector(".change-request-detail");
    expect(section?.firstElementChild?.tagName).toBe("HEADER");
    expect(section?.querySelector(":scope > p")).toBeNull();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("正在加载详情");
    expect(status.closest(".change-request-detail__loading")).not.toBeNull();
  });

  it("uses the GitLab name from the list row while detail is loading", () => {
    getDetailMock.mockImplementation(() => new Promise(() => undefined));
    render(
      <I18nProvider fixedLocale="zh">
        <ChangeRequestDetailPage
          number={10}
          projectId={4}
          provider="gitlab"
          listRow={{
            number: 10,
            title: "排行榜小程序",
            url: "https://gitlab.com/acme/redwhisk/-/merge_requests/10",
            provider: "gitlab",
            state: "open",
          }}
          onBack={() => undefined}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "在 GitLab 打开" }));
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://gitlab.com/acme/redwhisk/-/merge_requests/10",
    );
    expect(screen.queryByRole("button", { name: "在 GitHub 打开" })).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("does not invent a title without a list row", async () => {
    let resolveLoad: (value: ChangeRequestDetail) => void = () => undefined;
    getDetailMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    renderDetail();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByText("概要")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    const section = document.querySelector(".change-request-detail");
    expect(section?.querySelector(":scope > p")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("正在加载详情");
    expect(
      screen.getByRole("status").closest(".change-request-detail__loading"),
    ).not.toBeNull();
    resolveLoad(detail({ number: 132, title: "Remote issue sync" }));
    await flush();
    expect(
      screen.getByRole("heading", { name: "#132 · Remote issue sync" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("正在加载详情")).toBeNull();
  });

  it("matches the issue detail header and page surfaces", async () => {
    let resolveLoad: (value: ChangeRequestDetail) => void = () => undefined;
    getDetailMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    render(
      <I18nProvider fixedLocale="zh">
        <ChangeRequestDetailPage
          number={10}
          projectId={4}
          provider="github"
          listRow={{
            number: 10,
            title: "排行榜小程序",
            url: "https://github.com/acme/redwhisk/pull/10",
            provider: "github",
            state: "open",
          }}
          onBack={() => undefined}
        />
      </I18nProvider>,
    );

    const loadingPage = document.querySelector(".change-request-detail");
    expect(loadingPage).toHaveClass("issue-page", "issue-page--fullscreen");
    const loadingHeader = screen
      .getByRole("heading", { name: "#10 · 排行榜小程序" })
      .closest("header");
    expect(loadingHeader).toHaveClass(
      "issue-surface-header",
      "issue-surface-header--fullscreen",
    );
    expect(
      loadingHeader?.querySelector(".issue-detail-heading"),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "返回" })).toHaveClass(
      "issues-button",
    );
    const loadingBody = loadingPage?.querySelector(
      ":scope > .issue-page__body",
    );
    expect(loadingBody).toHaveClass(
      "issue-page__body",
      "issue-page__body--fullscreen",
    );
    expect(loadingBody?.previousElementSibling).toBe(loadingHeader);

    resolveLoad(detail({ number: 10, title: "排行榜小程序" }));
    await flush();

    const loadedPage = document.querySelector(".change-request-detail");
    expect(loadedPage).toHaveClass("issue-page", "issue-page--fullscreen");
    const loadedHeader = screen
      .getByRole("heading", { name: "#10 · 排行榜小程序" })
      .closest("header");
    expect(loadedHeader).toHaveClass(
      "issue-surface-header",
      "issue-surface-header--fullscreen",
    );
    expect(loadedHeader?.querySelector(".issue-detail-heading")).not.toBeNull();
    expect(screen.getByRole("button", { name: "返回" })).toHaveClass(
      "issues-button",
    );
    const loadedBody = loadedPage?.querySelector(":scope > .issue-page__body");
    expect(loadedBody).toHaveClass(
      "issue-page__body",
      "issue-page__body--fullscreen",
    );
    expect(loadedBody?.previousElementSibling).toBe(loadedHeader);
  });

  it("puts merge facts in the side summary instead of under the title", async () => {
    getDetailMock.mockResolvedValue(
      detail({
        number: 10,
        title: "排行榜小程序",
        state: "merged",
        sourceBranch: "issue-14-rumengling",
        targetBranch: "main",
        authorLogin: "kafka0102",
        commitCount: 12,
        additions: 2582,
        deletions: 118,
        mergeCommitSha: "abc123",
        blockingReasons: [],
      }),
    );
    renderDetail();
    await flush();
    const header = screen
      .getByRole("heading", { name: "#10 · 排行榜小程序" })
      .closest("header");
    expect(header).not.toHaveTextContent("合并状态");
    expect(header).not.toHaveTextContent("kafka0102");
    expect(header).not.toHaveTextContent("12 个提交");
    expect(header).not.toHaveTextContent("issue-14-rumengling");
    expect(header).not.toHaveTextContent("+2582");
    const summary = screen
      .getByRole("heading", { name: "概要" })
      .closest("section");
    const text = summary?.textContent ?? "";
    let cursor = -1;
    for (const label of [
      "合并状态：",
      "分支：",
      "提交人：",
      "提交：",
      "变更：",
    ]) {
      const index = text.indexOf(label);
      expect(index).toBeGreaterThan(cursor);
      cursor = index;
    }
    expect(text).toContain("已合并");
    expect(text).not.toContain("merged");
    expect(text).toContain("issue-14-rumengling → main");
    expect(text).toContain("kafka0102");
    expect(text).toContain("12 个提交");
    expect(text).toContain("+2582 −118");
    expect(screen.queryByRole("heading", { name: "合并" })).toBeNull();
    expect(screen.queryByText("已合并到 main")).toBeNull();
    expect(screen.queryByText("abc123")).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "在 GitHub 打开" }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "在 GitHub 中查看" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "在 GitHub 中处理" }),
    ).toBeNull();
  });

  it("uses english summary labels and a back name", async () => {
    getDetailMock.mockResolvedValue(
      detail({
        state: "merged",
        sourceBranch: "issue-14-rumengling",
        targetBranch: "main",
        authorLogin: "kafka0102",
        commitCount: 12,
        additions: 2582,
        deletions: 118,
      }),
    );
    render(
      <I18nProvider fixedLocale="en">
        <ChangeRequestDetailPage
          number={132}
          projectId={4}
          provider="github"
          onBack={() => undefined}
        />
      </I18nProvider>,
    );
    await flush();
    for (const label of [
      "Merge status:",
      "Branches:",
      "Author:",
      "Commits:",
      "Changes:",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Merged")).toBeInTheDocument();
    expect(screen.queryByText("merged")).toBeNull();
    expect(screen.getByText("issue-14-rumengling → main")).toBeInTheDocument();
    expect(screen.getByText("kafka0102")).toBeInTheDocument();
    expect(screen.getByText("12 commits")).toBeInTheDocument();
    expect(screen.getByText("+2582 −118")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to list" })).toBeNull();
    expect(screen.queryByText("Back to list")).toBeNull();
    const header = screen
      .getByRole("heading", { name: "#132 · Remote issue sync" })
      .closest("header");
    expect(header).not.toHaveTextContent("kafka0102");
    expect(header).not.toHaveTextContent("12 commits");
  });

  it("omits empty summary rows and keeps a one-sided diff", async () => {
    getDetailMock.mockResolvedValue(detail({ authorLogin: null }));
    const noAuthor = renderDetail();
    await flush();
    expect(screen.queryByText("提交人：")).toBeNull();
    expect(screen.getByText("提交：")).toBeInTheDocument();
    expect(screen.getByText("变更：")).toBeInTheDocument();
    noAuthor.unmount();

    getDetailMock.mockResolvedValue(detail({ commitCount: null }));
    const noCommits = renderDetail();
    await flush();
    expect(screen.queryByText("提交：")).toBeNull();
    expect(screen.queryByText("0 个提交")).toBeNull();
    expect(screen.getByText("提交人：")).toBeInTheDocument();
    noCommits.unmount();

    getDetailMock.mockResolvedValue(
      detail({ additions: null, deletions: null }),
    );
    const noDiff = renderDetail();
    await flush();
    expect(screen.queryByText("变更：")).toBeNull();
    expect(screen.queryByText("+0 −0")).toBeNull();
    noDiff.unmount();

    getDetailMock.mockResolvedValue(detail({ additions: 3, deletions: null }));
    renderDetail();
    await flush();
    expect(screen.getByText("变更：")).toBeInTheDocument();
    expect(screen.getByText("+3 −0")).toBeInTheDocument();
  });

  it("names the back control 返回 and calls onBack", async () => {
    const onBack = vi.fn();
    render(
      <I18nProvider fixedLocale="zh">
        <ChangeRequestDetailPage
          number={132}
          projectId={4}
          provider="github"
          onBack={onBack}
        />
      </I18nProvider>,
    );
    await flush();
    const back = screen.getByRole("button", { name: "返回" });
    expect(back.querySelector("svg")).not.toBeNull();
    expect(back).not.toHaveTextContent("返回列表");
    expect(screen.queryByText("返回列表")).toBeNull();
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("change request detail styles", () => {
  it("sets fullscreen detail titles to 18px and leaves activity and card titles at 16px", () => {
    const rules = cssRules(
      readFileSync(
        resolve(process.cwd(), "src/shared/styles/issues-board.css"),
        "utf8",
      ),
    );
    const fullscreenSelector =
      ".issue-surface-header--fullscreen .issue-surface-header__title";
    const activitySelector =
      ".issue-surface-header--activity .issue-surface-header__title";
    const cardSelector =
      ".issue-surface-header--card .issue-surface-header__title";
    const fullscreen = rules.filter((rule) =>
      splitSelectors(rule.selector).includes(fullscreenSelector),
    );
    expect(fullscreen).toHaveLength(1);
    expect(declaration(fullscreen[0]?.body ?? "", "font-size")).toBe("18px");
    expect(declaration(fullscreen[0]?.body ?? "", "line-height")).toBe("1.25");
    expect(splitSelectors(fullscreen[0]?.selector ?? "")).not.toContain(
      activitySelector,
    );
    expect(splitSelectors(fullscreen[0]?.selector ?? "")).not.toContain(
      cardSelector,
    );

    const activity = ruleWithSelector(rules, activitySelector);
    const card = ruleWithSelector(rules, cardSelector);
    expect(declaration(activity.body, "font-size")).toBe("16px");
    expect(declaration(activity.body, "line-height")).toBe("1.25");
    expect(declaration(card.body, "font-size")).toBe("16px");
    expect(declaration(card.body, "line-height")).toBe("1.25");
    expect(activity).not.toBe(fullscreen[0]);
    expect(card).not.toBe(fullscreen[0]);
    expect(
      declaration(
        ruleWithSelector(rules, ".issue-surface-header__title").body,
        "font-weight",
      ),
    ).toBe("650");
  });

  it("sets the change request title to 18px above the activity heading", () => {
    const rules = cssRules(
      readFileSync(
        resolve(process.cwd(), "src/shared/styles/change-request-detail.css"),
        "utf8",
      ),
    );
    const shell = cssRules(
      readFileSync(
        resolve(process.cwd(), "src/shared/styles/workbench-shell.css"),
        "utf8",
      ),
    );
    const activityHeading = ruleWithSelector(shell, ".activity-surface h2");
    expect(declaration(activityHeading.body, "font-size")).toBe("22px");
    const title = rules.find((rule) =>
      splitSelectors(rule.selector).some(
        (selector) =>
          selector.includes(".change-request-detail__heading") &&
          selector.includes("h2") &&
          declaration(rule.body, "font-size") === "18px",
      ),
    );
    expect(title).toBeDefined();
    const titleSelector = splitSelectors(title?.selector ?? "").find(
      (selector) =>
        selector.includes(".change-request-detail__heading") &&
        selector.includes("h2"),
    );
    expect(titleSelector).toBeTruthy();
    expect(specificityBeats(titleSelector ?? "", ".activity-surface h2")).toBe(
      true,
    );
    expect(declaration(title?.body ?? "", "line-height")).toBe("1.25");
    expect(declaration(title?.body ?? "", "font-weight")).toBe("650");
    expect(declaration(title?.body ?? "", "letter-spacing")).toBe("0");
  });

  it("paints the merged status chip with muted background in dark theme", () => {
    const rules = cssRules(
      readFileSync(
        resolve(process.cwd(), "src/shared/styles/change-request-detail.css"),
        "utf8",
      ),
    );
    const dark = rules.find((rule) =>
      splitSelectors(rule.selector).some(
        (selector) =>
          selector.includes('[data-theme="dark"]') &&
          selector.includes(".change-request-state-chip--merged"),
      ),
    );
    expect(dark).toBeDefined();
    expect(declaration(dark?.body ?? "", "background")).toBe(
      "var(--color-merged-muted)",
    );
    expect(declaration(dark?.body ?? "", "color")).toBe("var(--color-merged)");
    expect(declaration(dark?.body ?? "", "background")).not.toBe(
      "var(--color-merged)",
    );
    expect(declaration(dark?.body ?? "", "color")).not.toBe("#fff");
  });

  it("keeps the merged status chip on a merged background with white text", () => {
    const rules = cssRules(
      readFileSync(
        resolve(process.cwd(), "src/shared/styles/change-request-detail.css"),
        "utf8",
      ),
    );
    const light = rules.find((rule) =>
      splitSelectors(rule.selector).some(
        (selector) =>
          selector.includes(".change-request-state-chip--merged") &&
          !selector.includes("data-theme"),
      ),
    );
    expect(light).toBeDefined();
    expect(declaration(light?.body ?? "", "background")).toBe(
      "var(--color-merged)",
    );
    expect(declaration(light?.body ?? "", "color")).toBe("#fff");
  });
});

function specificityBeats(selector: string, other: string): boolean {
  const left = specificityOf(selector);
  const right = specificityOf(other);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return (left[index] ?? 0) > (right[index] ?? 0);
    }
  }
  return false;
}

function specificityOf(selector: string): [number, number, number] {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
  const withoutIds = selector.replace(/#[\w-]+/g, "");
  const classes = withoutIds.match(/(\.[\w-]+|\[[^\]]+\])/g)?.length ?? 0;
  const withoutClasses = withoutIds.replace(/(\.[\w-]+|\[[^\]]+\])/g, "");
  const elements = withoutClasses.match(/[a-zA-Z][\w-]*/g)?.length ?? 0;
  return [ids, classes, elements];
}

function cssRules(css: string): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  for (const match of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selector = match[1]?.trim() ?? "";
    if (selector.length === 0) {
      continue;
    }
    rules.push({ selector, body: match[2] ?? "" });
  }
  return rules;
}

function splitSelectors(selector: string): string[] {
  return selector.split(",").map((part) => part.trim());
}

function ruleWithSelector(
  rules: Array<{ selector: string; body: string }>,
  selector: string,
): { selector: string; body: string } {
  const found = rules.find((rule) =>
    splitSelectors(rule.selector).includes(selector),
  );
  if (found == null) {
    throw new Error(`missing rule ${selector}`);
  }
  return found;
}

function declaration(body: string, property: string): string {
  const match = body.match(new RegExp(`${property}\\s*:\\s*([^;]+);`));
  return match?.[1]?.trim() ?? "";
}
