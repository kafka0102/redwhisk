import { beforeEach, describe, expect, it } from "vitest";

import {
  dismissSyncConfirm,
  formatSyncChangesLabel,
  isSyncConfirmDismissed,
  needsBranchSync,
  resolveSyncActions,
  resolveSyncConfirmDirection,
  shouldShowSyncChangesButton,
  SYNC_CONFIRM_DISMISSED_STORAGE_KEY,
} from "./sync-changes";

const labels = {
  behindOnly: (count: number) => `同步更改 ${count}↓`,
  aheadOnly: (count: number) => `同步更改 ${count}↑`,
  both: (behind: number, ahead: number) => `同步更改 ${behind}↓ ${ahead}↑`,
};

describe("sync-changes helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("needsBranchSync is true when ahead or behind is positive", () => {
    expect(needsBranchSync(null)).toBe(false);
    expect(needsBranchSync(undefined)).toBe(false);
    expect(
      needsBranchSync({ upstream: "origin/main", ahead: 0, behind: 0 }),
    ).toBe(false);
    expect(
      needsBranchSync({ upstream: "origin/main", ahead: 2, behind: 0 }),
    ).toBe(true);
    expect(
      needsBranchSync({ upstream: "origin/main", ahead: 0, behind: 3 }),
    ).toBe(true);
    expect(
      needsBranchSync({ upstream: "origin/main", ahead: 1, behind: 2 }),
    ).toBe(true);
  });

  it("formats three button label shapes", () => {
    expect(formatSyncChangesLabel({ ahead: 0, behind: 3 }, labels)).toBe(
      "同步更改 3↓",
    );
    expect(formatSyncChangesLabel({ ahead: 2, behind: 0 }, labels)).toBe(
      "同步更改 2↑",
    );
    expect(formatSyncChangesLabel({ ahead: 2, behind: 3 }, labels)).toBe(
      "同步更改 3↓ 2↑",
    );
    expect(formatSyncChangesLabel({ ahead: 0, behind: 0 }, labels)).toBeNull();
  });

  it("resolves pull / push / both action order", () => {
    expect(resolveSyncActions({ ahead: 0, behind: 2 })).toEqual(["pull"]);
    expect(resolveSyncActions({ ahead: 1, behind: 0 })).toEqual(["push"]);
    expect(resolveSyncActions({ ahead: 1, behind: 2 })).toEqual([
      "pull",
      "push",
    ]);
    expect(resolveSyncActions({ ahead: 0, behind: 0 })).toEqual([]);
    expect(resolveSyncConfirmDirection({ ahead: 1, behind: 2 })).toBe("both");
    expect(resolveSyncConfirmDirection({ ahead: 0, behind: 1 })).toBe("pull");
    expect(resolveSyncConfirmDirection({ ahead: 1, behind: 0 })).toBe("push");
  });

  it("shows sync button only for empty clean project root with sync need", () => {
    const base = {
      fileCount: 0,
      isLoading: false,
      hasError: false,
      isProjectRoot: true,
      branchSync: { upstream: "origin/main", ahead: 1, behind: 0 },
      hasSyncHandler: true,
    };
    expect(shouldShowSyncChangesButton(base)).toBe(true);
    expect(shouldShowSyncChangesButton({ ...base, isProjectRoot: false })).toBe(
      false,
    );
    expect(shouldShowSyncChangesButton({ ...base, fileCount: 1 })).toBe(false);
    expect(shouldShowSyncChangesButton({ ...base, isLoading: true })).toBe(
      false,
    );
    expect(shouldShowSyncChangesButton({ ...base, hasError: true })).toBe(
      false,
    );
    expect(
      shouldShowSyncChangesButton({
        ...base,
        branchSync: { upstream: "origin/main", ahead: 0, behind: 0 },
      }),
    ).toBe(false);
    expect(shouldShowSyncChangesButton({ ...base, branchSync: null })).toBe(
      false,
    );
    expect(
      shouldShowSyncChangesButton({ ...base, hasSyncHandler: false }),
    ).toBe(false);
  });

  it("reads and writes sync confirm dismissed preference", () => {
    expect(isSyncConfirmDismissed()).toBe(false);
    dismissSyncConfirm();
    expect(
      window.localStorage.getItem(SYNC_CONFIRM_DISMISSED_STORAGE_KEY),
    ).toBe("1");
    expect(isSyncConfirmDismissed()).toBe(true);
  });
});
