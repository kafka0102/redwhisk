import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";

import { I18nProvider } from "../../shared/i18n/i18n";
import { ChangeRequestDetailPage } from "./change-request-detail";
import {
  closeChangeRequest,
  getProjectChangeRequest,
  markChangeRequestReady,
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
    linkedIssues: [{ issueId: 128, label: "GH #128", linkKind: "closing" }],
    readySupported: true,
    reviewSupported: true,
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
          { issueId: 12, label: "#12", linkKind: "branch" },
          { issueId: 128, label: "GH #128", linkKind: "closing" },
        ],
      }),
    );
    renderDetail(onOpenIssue);
    await flush();
    expect(screen.getByRole("button", { name: "#12" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GH #128" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "GH #128" }));
    expect(onOpenIssue).toHaveBeenCalledWith(128);
    fireEvent.click(screen.getByRole("button", { name: "#12" }));
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
    expect(screen.getByLabelText("合并后删除源分支")).toBeDisabled();
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
    expect(screen.getByText("已合并到 main")).toBeInTheDocument();
    expect(screen.getByText(/9f3c2a1/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "合并 Pull Request" }),
    ).toBeNull();
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
    fireEvent.click(
      screen.getAllByRole("button", { name: "在 GitHub 打开" })[0],
    );
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
    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(markReadyMock).toHaveBeenCalledTimes(1);
    resolveReady(detail({ state: "open", title: "Ready window" }));
    await flush();
    expect(screen.getByText("open")).toBeInTheDocument();
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
    expect(screen.getByText("draft")).toBeInTheDocument();
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
    expect(screen.getByText("open")).toBeInTheDocument();
  });

  it("replaces the detail with closed, not merged, after close is confirmed", async () => {
    closeRequestMock.mockResolvedValue(detail({ state: "closed" }));
    renderDetail();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "确认关闭" }));
    await flush();

    expect(closeRequestMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("closed")).toBeInTheDocument();
    expect(screen.queryByText("merged")).toBeNull();
  });
});
