import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";

import { I18nProvider } from "../../shared/i18n/i18n";
import { ChangeRequestPanel } from "./change-request-panel";
import {
  getProjectChangeRequest,
  listProjectChangeRequests,
  syncProjectChangeRequests,
  type ChangeRequestListResponse,
} from "./change-request-commands";

const focusState = vi.hoisted(() => ({
  initial: true,
  listeners: new Set<(focused: boolean) => void>(),
}));
const listenMock = vi.hoisted(() => vi.fn());

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

vi.mock("./change-request-commands", () => ({
  CHANGE_REQUEST_SYNC_CHANGED_EVENT: "change-request-sync-changed",
  getProjectChangeRequest: vi.fn(),
  listProjectChangeRequests: vi.fn(),
  syncProjectChangeRequests: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

const getDetailMock = vi.mocked(getProjectChangeRequest);
const listMock = vi.mocked(listProjectChangeRequests);
const syncMock = vi.mocked(syncProjectChangeRequests);
const openUrlMock = vi.mocked(openUrl);

function response(): ChangeRequestListResponse {
  return {
    rows: [
      {
        id: 1,
        number: 132,
        title: "Kept",
        url: "https://github.com/acme/redwhisk/pull/132",
        provider: "github",
        state: "open",
        authorLogin: "lin",
        sourceBranch: "feat/kept",
        targetBranch: "main",
        reviewDecision: "none",
        checksOk: 1,
        checksFailed: 0,
        checksPending: 0,
        remoteUpdatedAt: Date.parse("2026-11-07T14:00:00Z"),
        linkedIssues: [],
      },
    ],
    tabCount: 1,
    counts: {
      open: 1,
      closed: 0,
    },
    pullRequestRefs: [],
  };
}

function namedResponse(
  titles: string[],
  counts: { open: number; closed: number } = { open: 0, closed: 2 },
): ChangeRequestListResponse {
  return {
    rows: titles.map((title, index) => ({
      id: index + 1,
      number: index + 1,
      title,
      url: `https://github.com/acme/redwhisk/pull/${index + 1}`,
      provider: "github",
      state: "closed",
      authorLogin: "lin",
      sourceBranch: "feat/closed",
      targetBranch: "main",
      reviewDecision: "none",
      checksOk: 0,
      checksFailed: 0,
      checksPending: 0,
      remoteUpdatedAt: Date.parse("2026-11-07T14:00:00Z"),
      linkedIssues: [],
    })),
    tabCount: titles.length,
    counts,
    pullRequestRefs: [],
  };
}

function deferLists(): Array<{
  filter: string | undefined;
  resolve: (value: ChangeRequestListResponse) => void;
}> {
  const requests: Array<{
    filter: string | undefined;
    resolve: (value: ChangeRequestListResponse) => void;
  }> = [];
  listMock.mockImplementation((input) => {
    return new Promise((resolve) => {
      requests.push({ filter: input.filter, resolve });
    });
  });
  return requests;
}

function latestRequest(
  requests: Array<{
    filter: string | undefined;
    resolve: (value: ChangeRequestListResponse) => void;
  }>,
  filter: string,
): { resolve: (value: ChangeRequestListResponse) => void } {
  const matches = requests.filter((item) => item.filter === filter);
  const found = matches[matches.length - 1];
  if (found == null) {
    throw new Error(`missing ${filter} request`);
  }
  return found;
}

function renderLocalizedPanel(
  locale: "en" | "zh",
  provider: "github" | "gitlab",
): void {
  render(
    <I18nProvider fixedLocale={locale}>
      <ChangeRequestPanel
        projectId={4}
        sourceMode="remote"
        provider={provider}
      />
    </I18nProvider>,
  );
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

function renderPanel(
  sourceMode: "local" | "remote" | "mixed" | null,
): ReturnType<typeof render> {
  return render(
    <I18nProvider fixedLocale="en">
      <ChangeRequestPanel projectId={4} sourceMode={sourceMode} />
    </I18nProvider>,
  );
}

describe("change request auto sync", () => {
  beforeEach(() => {
    focusState.initial = true;
    focusState.listeners.clear();
    setPageVisibility("visible");
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    listMock.mockReset();
    syncMock.mockReset();
    getDetailMock.mockReset();
    openUrlMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(vi.fn());
    listMock.mockResolvedValue(response());
    getDetailMock.mockImplementation(() => new Promise(() => undefined));
    syncMock.mockResolvedValue({ outcome: "synced", errorCode: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not sync when the source mode is unknown, local, hidden, or blurred", async () => {
    const unknown = renderPanel(null);
    await flush();
    unknown.unmount();

    const local = renderPanel("local");
    await flush();
    local.unmount();

    setPageVisibility("hidden");
    const hidden = renderPanel("remote");
    await flush();
    hidden.unmount();
    setPageVisibility("visible");

    setWindowFocused(false);
    const blurred = renderPanel("remote");
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    blurred.unmount();

    expect(syncMock).not.toHaveBeenCalled();
  });

  it("requests the open filter by default", async () => {
    renderPanel("remote");
    await flush();
    expect(listMock).toHaveBeenCalledWith({
      projectId: 4,
      filter: "open",
    });
  });

  it("syncs every 60 seconds while visible and focused, without overlapping", async () => {
    let resolveSync: (value: {
      outcome: "synced";
      errorCode: null;
    }) => void = () => undefined;
    syncMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve;
        }),
    );
    renderPanel("remote");
    await flush();
    expect(syncMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(syncMock).toHaveBeenCalledTimes(1);

    resolveSync({ outcome: "synced", errorCode: null });
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(syncMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the existing list when sync fails", async () => {
    syncMock.mockResolvedValue({
      outcome: "cache_failed",
      errorCode: "cache_failed",
    });
    renderPanel("mixed");
    await flush();
    expect(screen.getByRole("heading", { name: "Kept" })).toBeInTheDocument();
    expect(
      screen.getByText("Sync failed. Cached issues kept."),
    ).toBeInTheDocument();
  });

  it("unsubscribes the sync event when the panel unmounts", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const view = renderPanel("remote");
    await flush();
    view.unmount();
    expect(unlisten).toHaveBeenCalled();
  });

  it("从行打开详情时顶栏使用该行标题", async () => {
    listMock.mockResolvedValue({
      rows: [
        {
          id: 10,
          number: 10,
          title: "排行榜小程序",
          url: "https://github.com/acme/redwhisk/pull/10",
          provider: "github",
          state: "merged",
          authorLogin: "kafka0102",
          sourceBranch: "issue-14-rumengling",
          targetBranch: "main",
          reviewDecision: "approved",
          checksOk: 2,
          checksFailed: 0,
          checksPending: 0,
          remoteUpdatedAt: Date.parse("2026-11-07T14:00:00Z"),
          linkedIssues: [],
        },
      ],
      tabCount: 1,
      counts: { open: 1, closed: 0 },
      pullRequestRefs: [],
    });
    render(
      <I18nProvider fixedLocale="zh">
        <ChangeRequestPanel projectId={4} sourceMode="remote" />
      </I18nProvider>,
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "排行榜小程序" }));
    await flush();

    expect(
      screen.getByRole("heading", { name: "#10 · 排行榜小程序" }),
    ).toBeInTheDocument();
    expect(screen.getByText("正在加载详情")).toBeInTheDocument();
    expect(getDetailMock).toHaveBeenCalledWith({
      projectId: 4,
      provider: "github",
      number: 10,
    });
    expect(screen.queryByRole("tab")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "在 GitHub 打开" }));
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/acme/redwhisk/pull/10",
    );
  });

  it("更早发出的空 Open 响应不会盖掉 Closed 的甲和乙", async () => {
    const requests: Array<{
      filter: string | undefined;
      resolve: (value: ChangeRequestListResponse) => void;
    }> = [];
    listMock.mockImplementation((input) => {
      return new Promise((resolve) => {
        requests.push({ filter: input.filter, resolve });
      });
    });
    let resolveSync: (value: {
      outcome: "synced";
      errorCode: null;
    }) => void = () => undefined;
    syncMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve;
        }),
    );

    render(
      <I18nProvider fixedLocale="zh">
        <ChangeRequestPanel
          projectId={4}
          sourceMode="remote"
          provider="github"
        />
      </I18nProvider>,
    );
    await flush();
    resolveSync({ outcome: "synced", errorCode: null });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: /Closed/ }));
    await flush();

    const closedIndex = requests.findIndex((item) => item.filter === "closed");
    const earlierOpens = requests.filter(
      (item, index) => item.filter === "open" && index < closedIndex,
    );
    const closedRequest = requests[closedIndex];
    const openRequest = earlierOpens[earlierOpens.length - 1];
    if (closedRequest == null || openRequest == null) {
      throw new Error("missing closed or earlier open request");
    }

    closedRequest.resolve(namedResponse(["甲", "乙"]));
    await flush();
    expect(screen.getByRole("heading", { name: "甲" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "乙" })).toBeInTheDocument();

    openRequest.resolve(namedResponse([]));
    await flush();
    expect(screen.getByRole("heading", { name: "甲" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "乙" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Closed/ })).toHaveTextContent(
      "2",
    );
    expect(
      screen.queryByText("没有关闭的 Pull request"),
    ).not.toBeInTheDocument();
  });

  it("Closed 最新响应为空时显示没有关闭的 Pull request", async () => {
    const requests = deferLists();
    syncMock.mockImplementation(() => new Promise(() => undefined));
    renderLocalizedPanel("zh", "github");
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Closed/ }));
    await flush();

    latestRequest(requests, "closed").resolve(
      namedResponse([], { open: 0, closed: 0 }),
    );
    await flush();

    expect(screen.getByRole("button", { name: /Closed/ })).toHaveTextContent(
      "0",
    );
    expect(screen.getByText("没有关闭的 Pull request")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "甲" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "乙" }),
    ).not.toBeInTheDocument();
  });

  it("GitLab 中文在没有关闭记录时显示没有关闭的 Merge request", async () => {
    const requests = deferLists();
    syncMock.mockImplementation(() => new Promise(() => undefined));
    renderLocalizedPanel("zh", "gitlab");
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Closed/ }));
    await flush();

    latestRequest(requests, "closed").resolve(
      namedResponse([], { open: 0, closed: 0 }),
    );
    await flush();

    expect(screen.getByText("没有关闭的 Merge request")).toBeInTheDocument();
    expect(
      screen.queryByText("没有关闭的 Pull request"),
    ).not.toBeInTheDocument();
  });

  it("shows No closed pull requests for an empty GitHub closed list", async () => {
    const requests = deferLists();
    syncMock.mockImplementation(() => new Promise(() => undefined));
    renderLocalizedPanel("en", "github");
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Closed/ }));
    await flush();

    latestRequest(requests, "closed").resolve(
      namedResponse([], { open: 0, closed: 0 }),
    );
    await flush();

    expect(screen.getByText("No closed pull requests")).toBeInTheDocument();
    expect(
      screen.queryByText("没有关闭的 Pull request"),
    ).not.toBeInTheDocument();
  });

  it("shows No closed merge requests for an empty GitLab closed list", async () => {
    const requests = deferLists();
    syncMock.mockImplementation(() => new Promise(() => undefined));
    renderLocalizedPanel("en", "gitlab");
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Closed/ }));
    await flush();

    latestRequest(requests, "closed").resolve(
      namedResponse([], { open: 0, closed: 0 }),
    );
    await flush();

    expect(screen.getByText("No closed merge requests")).toBeInTheDocument();
    expect(
      screen.queryByText("No closed pull requests"),
    ).not.toBeInTheDocument();
  });

  it("后返回的 Closed 响应不会盖掉 Open 的打开的", async () => {
    const requests = deferLists();
    syncMock.mockImplementation(() => new Promise(() => undefined));
    renderLocalizedPanel("zh", "github");
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Closed/ }));
    await flush();
    const closedRequest = latestRequest(requests, "closed");

    fireEvent.click(screen.getByRole("button", { name: /Open/ }));
    await flush();
    latestRequest(requests, "open").resolve(
      namedResponse(["打开的"], { open: 1, closed: 0 }),
    );
    await flush();

    closedRequest.resolve(namedResponse(["甲", "乙"]));
    await flush();

    expect(screen.getByRole("heading", { name: "打开的" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "甲" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "乙" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open/ })).toHaveTextContent("1");
  });

  it("同一个 Closed 筛选里后返回的旧响应不会盖掉甲和乙", async () => {
    const requests = deferLists();
    syncMock.mockImplementation(() => new Promise(() => undefined));
    renderLocalizedPanel("zh", "github");
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Closed/ }));
    await flush();
    const olderClosed = latestRequest(requests, "closed");

    fireEvent.click(screen.getByRole("button", { name: /Open/ }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Closed/ }));
    await flush();
    const newerClosed = latestRequest(requests, "closed");
    if (newerClosed === olderClosed) {
      throw new Error("missing a newer closed request");
    }

    newerClosed.resolve(namedResponse(["甲", "乙"]));
    await flush();
    olderClosed.resolve(namedResponse([], { open: 0, closed: 0 }));
    await flush();

    expect(screen.getByRole("heading", { name: "甲" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "乙" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Closed/ })).toHaveTextContent(
      "2",
    );
    expect(
      screen.queryByText("没有关闭的 Pull request"),
    ).not.toBeInTheDocument();
  });

  it("同步成功后按 Closed 刷新，旧的空 Open 响应不会清掉甲和乙", async () => {
    const requests = deferLists();
    const resolveSyncs: Array<
      (value: { outcome: "synced"; errorCode: null }) => void
    > = [];
    syncMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSyncs.push(resolve);
        }),
    );
    renderLocalizedPanel("zh", "github");
    await flush();
    const originalSync = resolveSyncs[0];
    const earlierOpen = requests.filter((item) => item.filter === "open");
    const openRequest = earlierOpen[earlierOpen.length - 1];
    if (originalSync == null || openRequest == null) {
      throw new Error("missing sync or earlier open request");
    }

    fireEvent.click(screen.getByRole("button", { name: /Closed/ }));
    await flush();
    latestRequest(requests, "closed").resolve(namedResponse(["甲", "乙"]));
    await flush();
    expect(screen.getByRole("heading", { name: "甲" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "乙" })).toBeInTheDocument();

    const requestCountBeforeSync = requests.length;
    originalSync({ outcome: "synced", errorCode: null });
    await flush();
    const refresh = requests[requestCountBeforeSync];
    if (refresh == null) {
      throw new Error("missing list refresh after sync");
    }
    expect(refresh.filter).toBe("closed");

    refresh.resolve(namedResponse(["甲", "乙"]));
    await flush();
    openRequest.resolve(namedResponse([], { open: 0, closed: 2 }));
    await flush();

    expect(screen.getByRole("heading", { name: "甲" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "乙" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Closed/ })).toHaveTextContent(
      "2",
    );
    expect(
      screen.queryByText("没有关闭的 Pull request"),
    ).not.toBeInTheDocument();
  });
});
