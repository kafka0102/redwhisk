import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { ChangeRequestPanel } from "./change-request-panel";
import {
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
  listProjectChangeRequests: vi.fn(),
  syncProjectChangeRequests: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

const listMock = vi.mocked(listProjectChangeRequests);
const syncMock = vi.mocked(syncProjectChangeRequests);

function response(): ChangeRequestListResponse {
  return {
    rows: [
      {
        id: 1,
        number: 132,
        title: "Kept",
        url: "https://github.com/acme/redwhisk/pull/132",
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
      reviewRequested: 0,
      createdByMe: 0,
      allOpen: 1,
      recentlyMerged: 0,
    },
    pullRequestRefs: [],
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
    listenMock.mockReset();
    listenMock.mockResolvedValue(vi.fn());
    listMock.mockResolvedValue(response());
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
});
