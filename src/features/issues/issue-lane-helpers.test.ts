import { describe, expect, it } from "vitest";

import type { IssueRecord } from "./issue-commands";
import {
  mergeIssues,
  sortIssuesByStatusChangedAtDesc,
} from "./issue-lane-helpers";

function makeIssue(overrides: Partial<IssueRecord>): IssueRecord {
  return {
    id: 1,
    number: 1,
    projectId: 1,
    title: "",
    description: "",
    attachments: [],
    labels: [],
    status: "backlog",
    linkedSessionId: null,
    linkedSessionStatus: null,
    linkedSessionAttention: null,
    linkedSessionLogPath: null,
    linkedSessionLatestOutput: null,
    createdAt: 0,
    updatedAt: 0,
    statusChangedAt: 0,
    ...overrides,
  };
}

describe("sortIssuesByStatusChangedAtDesc", () => {
  it("按 statusChangedAt 降序排序", () => {
    const issues = [
      makeIssue({ id: 1, statusChangedAt: 100 }),
      makeIssue({ id: 2, statusChangedAt: 300 }),
      makeIssue({ id: 3, statusChangedAt: 200 }),
    ];
    const sorted = sortIssuesByStatusChangedAtDesc(issues);
    expect(sorted.map((issue) => issue.id)).toEqual([2, 3, 1]);
  });

  it("statusChangedAt 相同时按 createdAt 降序", () => {
    const issues = [
      makeIssue({ id: 1, statusChangedAt: 500, createdAt: 400 }),
      makeIssue({ id: 2, statusChangedAt: 500, createdAt: 600 }),
    ];
    const sorted = sortIssuesByStatusChangedAtDesc(issues);
    expect(sorted.map((issue) => issue.id)).toEqual([2, 1]);
  });

  it("statusChangedAt 与 createdAt 都相同时按 id 降序兜底", () => {
    const issues = [
      makeIssue({ id: 1, statusChangedAt: 500, createdAt: 600 }),
      makeIssue({ id: 2, statusChangedAt: 500, createdAt: 600 }),
    ];
    const sorted = sortIssuesByStatusChangedAtDesc(issues);
    expect(sorted.map((issue) => issue.id)).toEqual([2, 1]);
  });

  it("返回新数组，不改原数组", () => {
    const issues = [
      makeIssue({ id: 1, statusChangedAt: 100 }),
      makeIssue({ id: 2, statusChangedAt: 300 }),
    ];
    sortIssuesByStatusChangedAtDesc(issues);
    expect(issues.map((issue) => issue.id)).toEqual([1, 2]);
  });
});

describe("mergeIssues", () => {
  it("按 statusChangedAt 降序合并并对重复 id 去重", () => {
    const current = [
      makeIssue({ id: 1, statusChangedAt: 100 }),
      makeIssue({ id: 2, statusChangedAt: 300 }),
    ];
    const next = [
      makeIssue({ id: 2, statusChangedAt: 300 }),
      makeIssue({ id: 3, statusChangedAt: 200 }),
    ];
    const merged = mergeIssues(current, next);
    expect(merged.map((issue) => issue.id)).toEqual([2, 3, 1]);
  });

  it("跨页合并后整体按 statusChangedAt 降序，交界处不被 id 重排", () => {
    // 已有页 statusChangedAt 100 / 90；新页含 200，应排到最前（非简单 append）。
    const current = [
      makeIssue({ id: 1, statusChangedAt: 100 }),
      makeIssue({ id: 2, statusChangedAt: 90 }),
    ];
    const next = [makeIssue({ id: 3, statusChangedAt: 200 })];
    const merged = mergeIssues(current, next);
    expect(merged.map((issue) => issue.id)).toEqual([3, 1, 2]);
  });
});
