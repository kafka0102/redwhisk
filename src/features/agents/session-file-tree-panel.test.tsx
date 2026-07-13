import { describe, expect, it } from "vitest";

import { FileTreePanel } from "../../shared/workspace/file-tree-panel";
import { SessionFileTreePanel } from "./session-file-tree-panel";

describe("SessionFileTreePanel", () => {
  it("re-exports the shared FileTreePanel for agents consumers", () => {
    expect(SessionFileTreePanel).toBe(FileTreePanel);
  });
});
