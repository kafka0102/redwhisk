import { describe, expect, it } from "vitest";

import {
  appendUniqueCommitsByHash,
  commitHistoryRefreshLimit,
  COMMIT_HISTORY_LOAD_MORE_THRESHOLD_PX,
  isNearScrollBottom,
} from "./commit-history-pagination";
import type { WorkspaceCommitRecord } from "./workspace-commands";

function makeCommit(hash: string): WorkspaceCommitRecord {
  return {
    hash,
    shortHash: hash.slice(0, 6),
    message: `msg ${hash}`,
    authorName: "Alice",
    committedAt: 0,
    files: [],
    isPushed: false,
    pushedTo: null,
    isCreatedInWorktree: false,
  };
}

describe("isNearScrollBottom", () => {
  it("returns false when the container is not laid out yet", () => {
    expect(
      isNearScrollBottom({
        scrollHeight: 0,
        clientHeight: 100,
        scrollTop: 0,
      }),
    ).toBe(false);
  });

  it("returns true when content is shorter than the viewport", () => {
    expect(
      isNearScrollBottom({
        scrollHeight: 40,
        clientHeight: 200,
        scrollTop: 0,
      }),
    ).toBe(true);
  });

  it("returns true within the threshold of the bottom", () => {
    expect(
      isNearScrollBottom({
        scrollHeight: 500,
        clientHeight: 200,
        scrollTop: 500 - 200 - (COMMIT_HISTORY_LOAD_MORE_THRESHOLD_PX - 1),
      }),
    ).toBe(true);
  });

  it("returns false when farther than the threshold from the bottom", () => {
    expect(
      isNearScrollBottom({
        scrollHeight: 500,
        clientHeight: 200,
        scrollTop: 500 - 200 - (COMMIT_HISTORY_LOAD_MORE_THRESHOLD_PX + 1),
      }),
    ).toBe(false);
  });
});

describe("commitHistoryRefreshLimit", () => {
  it("uses the page size when nothing is loaded yet", () => {
    expect(commitHistoryRefreshLimit(0)).toBe(50);
  });

  it("keeps the loaded window when larger than one page", () => {
    expect(commitHistoryRefreshLimit(150)).toBe(150);
  });
});

describe("appendUniqueCommitsByHash", () => {
  it("appends only unseen hashes and preserves order", () => {
    const existing = [makeCommit("a"), makeCommit("b")];
    const next = [makeCommit("b"), makeCommit("c")];
    expect(appendUniqueCommitsByHash(existing, next)).toEqual([
      makeCommit("a"),
      makeCommit("b"),
      makeCommit("c"),
    ]);
  });

  it("returns the original reference when every hash is already present", () => {
    const existing = [makeCommit("a")];
    const next = [makeCommit("a")];
    expect(appendUniqueCommitsByHash(existing, next)).toBe(existing);
  });
});
