import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { getProjectIssueSourceSettings } from "../settings/issue-source-commands";
import { IssuesActivity } from "./issues-activity";
import { resetIssuePageStateCacheForTests } from "./issues-activity-cache";
import { listIssues, type IssueRecord } from "./issue-commands";
import { getIssueSyncStatus, syncProjectIssues } from "./issue-mirror-commands";

const focusListeners = vi.hoisted(() => new Set<(focused: boolean) => void>());

vi.mock("../../shared/window/use-window-focus", async () => {
  const React = await import("react");
  return {
    useWindowFocus: () => {
      const [focused, setFocused] = React.useState(true);
      React.useEffect(() => {
        const listener = (next: boolean) => {
          setFocused(next);
        };
        focusListeners.add(listener);
        return () => {
          focusListeners.delete(listener);
        };
      }, []);
      return focused;
    },
  };
});

vi.mock("./issue-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./issue-commands")>();
  return { ...actual, listIssues: vi.fn() };
});

vi.mock("./issue-mirror-commands", () => ({
  ISSUE_SYNC_CHANGED_EVENT: "issue-sync-changed",
  getIssueSyncStatus: vi.fn(),
  syncProjectIssues: vi.fn(),
}));

vi.mock("../settings/issue-source-commands", () => ({
  getProjectIssueSourceSettings: vi.fn(),
}));

vi.mock("../settings/settings-commands", () => ({
  isGlobalLabelOverridden: () => false,
  listProjectLabels: vi.fn(async () => ({ labels: [] })),
  listSavedAgentSkills: vi.fn(async () => ({ skills: [] })),
}));

vi.mock("../agents/agent-session-commands", () => ({
  listAgentProfiles: vi.fn(async () => ({ profiles: [] })),
  listAgentSessions: vi.fn(async () => ({ sessions: [] })),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

const listIssuesMock = vi.mocked(listIssues);
const syncProjectIssuesMock = vi.mocked(syncProjectIssues);
const getIssueSyncStatusMock = vi.mocked(getIssueSyncStatus);
const getProjectIssueSourceSettingsMock = vi.mocked(
  getProjectIssueSourceSettings,
);

function boardIssue(id: number): IssueRecord {
  return {
    id,
    number: id,
    projectId: 1,
    title: "Local issue",
    description: "",
    attachments: [],
    labels: [],
    status: "backlog",
    linkedSessionId: null,
    linkedSessionStatus: null,
    linkedSessionAttention: null,
    linkedSessionLogPath: null,
    linkedSessionLatestOutput: null,
    linkedSessionAgentProfileId: null,
    linkedSessionDisplayMode: null,
    linkedSessionProviderSessionId: null,
    linkedSessionAgentType: null,
    createdAt: 1,
    updatedAt: 1,
    statusChangedAt: 1,
  };
}

function setWindowFocused(focused: boolean): void {
  for (const listener of focusListeners) {
    listener(focused);
  }
}

function setPageVisibility(value: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => value,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("issue auto sync gate", () => {
  beforeEach(() => {
    focusListeners.clear();
    resetIssuePageStateCacheForTests();
    setPageVisibility("visible");
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    listIssuesMock.mockReset();
    syncProjectIssuesMock.mockReset();
    getIssueSyncStatusMock.mockReset();
    getProjectIssueSourceSettingsMock.mockReset();
    listIssuesMock.mockResolvedValue({
      issues: [boardIssue(12)],
      statusTotals: { backlog: 1, running: 0, review: 0, completed: 0 },
    });
    getIssueSyncStatusMock.mockResolvedValue({
      lastSyncedAt: null,
      syncError: null,
    });
    getProjectIssueSourceSettingsMock.mockResolvedValue({
      projectId: 1,
      issueSourceMode: "mixed",
      issueSyncScope: "all_open",
      issueSyncLabel: null,
      issueSyncEnabled: true,
      issueSyncIntervalSeconds: 90,
      issueWritebackCloseOnComplete: false,
      issueWritebackCloseOnPrMerge: false,
      issueWritebackComment: false,
      issueCreateSource: "local",
      connection: {
        provider: "github",
        hostUrl: "https://github.com",
        repoPath: "acme/redwhisk",
        login: "octocat",
        cliInstalled: true,
        cliAuthenticated: true,
        authStatus: "ready",
        checkedAt: 1,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("syncs immediately, then every 90 seconds, and pauses while hidden or blurred", async () => {
    syncProjectIssuesMock.mockResolvedValue({ outcome: "synced" });
    render(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={1} />
      </I18nProvider>,
    );
    await flush();
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(89_000);
    });
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(2);

    act(() => {
      setPageVisibility("hidden");
    });
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(2);
    act(() => {
      setPageVisibility("visible");
    });
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(3);

    act(() => {
      setWindowFocused(false);
    });
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(3);
    act(() => {
      setWindowFocused(true);
    });
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(4);
  });

  it("backs off after automatic failures and lets a manual refresh run immediately", async () => {
    syncProjectIssuesMock.mockResolvedValue({ outcome: "cache_failed" });
    render(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={1} />
      </I18nProvider>,
    );
    await flush();
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(170_000);
    });
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(360_000);
    });
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(4);
    syncProjectIssuesMock.mockResolvedValue({ outcome: "synced" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(720_000);
    });
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(5);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(89_000);
    });
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(5);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(6);
  });

  it("does not increase the delay past 900 seconds", async () => {
    syncProjectIssuesMock.mockResolvedValue({ outcome: "credential_expired" });
    render(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={1} />
      </I18nProvider>,
    );
    await flush();
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000);
    });
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(360_000);
    });
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(720_000);
    });
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(899_000);
    });
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(5);
  });

  it("does not start auto sync for local mode", async () => {
    getProjectIssueSourceSettingsMock.mockResolvedValue({
      projectId: 1,
      issueSourceMode: "local",
      issueSyncScope: "all_open",
      issueSyncLabel: null,
      issueSyncEnabled: true,
      issueSyncIntervalSeconds: 90,
      issueWritebackCloseOnComplete: false,
      issueWritebackCloseOnPrMerge: false,
      issueWritebackComment: false,
      issueCreateSource: "local",
      connection: {
        provider: "gitlab",
        hostUrl: "https://gitlab.example.com/",
        repoPath: "acme/redwhisk",
        login: "octocat",
        cliInstalled: true,
        cliAuthenticated: true,
        authStatus: "ready",
        checkedAt: 1,
      },
    });
    render(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={1} />
      </I18nProvider>,
    );
    await flush();
    await flush();
    expect(syncProjectIssuesMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(syncProjectIssuesMock).not.toHaveBeenCalled();
  });

  it("starts the existing auto sync timer for remote mode", async () => {
    getProjectIssueSourceSettingsMock.mockResolvedValue({
      projectId: 1,
      issueSourceMode: "remote",
      issueSyncScope: "all_open",
      issueSyncLabel: null,
      issueSyncEnabled: true,
      issueSyncIntervalSeconds: 90,
      issueWritebackCloseOnComplete: false,
      issueWritebackCloseOnPrMerge: false,
      issueWritebackComment: false,
      issueCreateSource: "local",
      connection: {
        provider: "gitlab",
        hostUrl: "https://gitlab.example.com/",
        repoPath: "acme/redwhisk",
        login: "octocat",
        cliInstalled: true,
        cliAuthenticated: true,
        authStatus: "ready",
        checkedAt: 1,
      },
    });
    syncProjectIssuesMock.mockResolvedValue({ outcome: "synced" });
    render(
      <I18nProvider fixedLocale="zh">
        <IssuesActivity projectId={1} />
      </I18nProvider>,
    );
    await flush();
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(89_000);
    });
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flush();
    expect(syncProjectIssuesMock).toHaveBeenCalledTimes(2);
  });
});
