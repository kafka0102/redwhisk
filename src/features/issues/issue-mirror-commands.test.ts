import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../shared/commands/command-client", () => ({
  invokeCommand: vi.fn(),
}));

import { invokeCommand } from "../../shared/commands/command-client";
import { getIssueSyncStatus, syncProjectIssues } from "./issue-mirror-commands";

const invokeMock = vi.mocked(invokeCommand);

describe("issue mirror commands", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("calls sync and status with projectId", async () => {
    invokeMock.mockResolvedValueOnce({ outcome: "synced" });
    await expect(syncProjectIssues(4)).resolves.toEqual({ outcome: "synced" });
    expect(invokeMock).toHaveBeenCalledWith("sync_project_issues", {
      projectId: 4,
    });

    invokeMock.mockResolvedValueOnce({
      lastSyncedAt: 1_762_340_400_000,
      syncError: "cache_failed",
    });
    await expect(getIssueSyncStatus(4)).resolves.toEqual({
      lastSyncedAt: 1_762_340_400_000,
      syncError: "cache_failed",
    });
    expect(invokeMock).toHaveBeenCalledWith("get_issue_sync_status", {
      projectId: 4,
    });
  });
});
