import { describe, expect, it } from "vitest";

import {
  formatCommitChangeTabLabel,
  getChangeTabLabel,
  type SessionWorkspaceChangeTab,
} from "./session-workspace-types";

describe("session workspace change tab labels", () => {
  it("formats multi-diff tab label as short hash plus subject", () => {
    expect(formatCommitChangeTabLabel("abcdef1", "feat: open changes")).toBe(
      "abcdef1 feat: open changes",
    );
  });

  it("falls back to short hash when subject is empty", () => {
    expect(formatCommitChangeTabLabel("abcdef1", "   ")).toBe("abcdef1");
  });

  it("getChangeTabLabel uses multi label or single file name", () => {
    const multi: SessionWorkspaceChangeTab = {
      mode: "multi",
      label: "abc subject",
      commitHash: "abc",
      multiDiff: { commitHash: "abc", files: [] },
    };
    const single: SessionWorkspaceChangeTab = {
      mode: "file",
      fileName: "a.ts",
      filePath: "src/a.ts",
      change: {
        fileName: "a.ts",
        filePath: "src/a.ts",
        oldPath: null,
        kind: "modified",
        status: "M",
      },
      diff: null,
      isLoading: false,
      errorMessage: null,
    };
    expect(getChangeTabLabel(multi)).toBe("abc subject");
    expect(getChangeTabLabel(single)).toBe("a.ts");
  });
});
