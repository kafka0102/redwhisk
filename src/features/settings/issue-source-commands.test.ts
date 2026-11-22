import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../shared/commands/command-client", () => ({
  invokeCommand: vi.fn(),
}));

import { invokeCommand } from "../../shared/commands/command-client";
import { updateProjectIssueSourceSettings } from "./issue-source-commands";

const invokeMock = vi.mocked(invokeCommand);

describe("issue source commands", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("wraps display mode updates in the command input payload", async () => {
    const response = {
      projectId: 4,
      issueSourceMode: "local" as const,
      issueDisplayMode: "list" as const,
      issueSyncScope: "all_open" as const,
      issueSyncLabel: null,
      issueSyncEnabled: false,
      issueSyncIntervalSeconds: 90,
      issueWritebackCloseOnComplete: false,
      issueWritebackCloseOnPrMerge: false,
      issueWritebackComment: false,
      issueCreateSource: "local" as const,
      localIssueCount: 0,
      remoteIssueCount: 0,
      connection: {
        provider: null,
        hostUrl: null,
        repoPath: null,
        login: null,
        cliInstalled: false,
        cliAuthenticated: false,
        authStatus: "unknown" as const,
        checkedAt: 1,
      },
    };
    invokeMock.mockResolvedValueOnce(response);

    await expect(
      updateProjectIssueSourceSettings({
        projectId: 4,
        issueDisplayMode: "list",
      }),
    ).resolves.toEqual(response);
    expect(invokeMock).toHaveBeenCalledWith(
      "update_project_issue_source_settings",
      {
        input: {
          projectId: 4,
          issueDisplayMode: "list",
        },
      },
    );
  });
});
