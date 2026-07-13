import { beforeEach, describe, expect, it, vi } from "vitest";

import { runIssueRunningExitHooks } from "./issue-running-exit-hooks";

vi.mock("../../shared/audio/notification-sound", () => ({
  playNotificationSound: vi.fn(),
}));

import { playNotificationSound } from "../../shared/audio/notification-sound";

const mockedPlayNotificationSound = vi.mocked(playNotificationSound);

function createContext(
  overrides: Partial<{
    targetStatus: "backlog" | "running" | "review" | "completed";
    notificationReminder: boolean;
  }> = {},
) {
  return {
    issueId: 42,
    projectId: 7,
    fromStatus: "running" as const,
    targetStatus: "review" as const,
    notificationReminder: true,
    ...overrides,
  };
}

describe("runIssueRunningExitHooks", () => {
  beforeEach(() => {
    mockedPlayNotificationSound.mockReset();
  });

  it("running -> review 且开启通知提醒时播放提示音", async () => {
    await runIssueRunningExitHooks(createContext());

    expect(mockedPlayNotificationSound).toHaveBeenCalledTimes(1);
  });

  it("通知提醒关闭时不播放提示音", async () => {
    await runIssueRunningExitHooks(
      createContext({ notificationReminder: false }),
    );

    expect(mockedPlayNotificationSound).not.toHaveBeenCalled();
  });

  it("目标状态为 completed 时不播放提示音", async () => {
    await runIssueRunningExitHooks(
      createContext({ targetStatus: "completed" }),
    );

    expect(mockedPlayNotificationSound).not.toHaveBeenCalled();
  });

  it("目标状态为 backlog 时不播放提示音", async () => {
    await runIssueRunningExitHooks(createContext({ targetStatus: "backlog" }));

    expect(mockedPlayNotificationSound).not.toHaveBeenCalled();
  });

  it("子钩子抛错时不向上抛出", async () => {
    mockedPlayNotificationSound.mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(
      runIssueRunningExitHooks(createContext()),
    ).resolves.toBeUndefined();
  });
});
