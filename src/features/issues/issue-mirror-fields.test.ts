import { describe, expect, it } from "vitest";

import type { IssueRecord } from "./issue-commands";
import { retainIssueMirrorFields, toBoardRecord } from "./issue-mirror-fields";

describe("retainIssueMirrorFields", () => {
  it("命令结果没有镜像字段时保留上一行的来源和远端编号", () => {
    const previous = toBoardRecord({
      id: 1,
      number: 12,
      projectId: 1,
      title: "原标题",
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
      source: "remote",
      provider: "github",
      externalNumber: 128,
    });
    const {
      source: _source,
      provider: _provider,
      externalNumber: _externalNumber,
      remoteState: _remoteState,
      remoteLabels: _remoteLabels,
      syncStatus: _syncStatus,
      remoteClosedWhileRunning: _remoteClosedWhileRunning,
      remoteReopened: _remoteReopened,
      pullRequestUrl: _pullRequestUrl,
      ...commandResult
    } = previous;

    const retained = retainIssueMirrorFields(
      previous,
      commandResult as IssueRecord,
    );

    expect(retained.source).toBe("remote");
    expect(retained.provider).toBe("github");
    expect(retained.externalNumber).toBe(128);
    expect(Object.prototype.hasOwnProperty.call(commandResult, "source")).toBe(
      false,
    );
  });
});
