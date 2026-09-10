import { describe, expect, it, vi } from "vitest";
import type { TreeApi } from "react-arborist";

import type { WorkspaceFileTreeNode } from "./workspace-commands";
import {
  readFileTreeScrollOffset,
  resetFileTreeScrollOffsetCacheForTests,
  restoreFileTreeScrollOffset,
  writeFileTreeScrollOffset,
} from "./file-tree-scroll-offset";

describe("file-tree-scroll-offset", () => {
  it("reads back the last written offset for a cache key", () => {
    resetFileTreeScrollOffsetCacheForTests();
    writeFileTreeScrollOffset("/repo", 240);
    writeFileTreeScrollOffset("/other", 80);

    expect(readFileTreeScrollOffset("/repo")).toBe(240);
    expect(readFileTreeScrollOffset("/other")).toBe(80);
    expect(readFileTreeScrollOffset("/missing")).toBe(0);
  });

  it("clears cached offsets in tests", () => {
    writeFileTreeScrollOffset("/repo", 240);
    resetFileTreeScrollOffsetCacheForTests();
    expect(readFileTreeScrollOffset("/repo")).toBe(0);
  });

  it("restores pixel offset through the arborist list api", () => {
    const scrollTo = vi.fn();
    const treeApi = {
      list: { current: { scrollTo } },
      listEl: { current: { scrollHeight: 1200, clientHeight: 400 } },
    } as unknown as TreeApi<WorkspaceFileTreeNode>;

    expect(restoreFileTreeScrollOffset(treeApi, 360)).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith(360);
  });

  it("keeps restore pending when the list is not ready or too short", () => {
    expect(restoreFileTreeScrollOffset(undefined, 120)).toBe(false);

    const shortTreeApi = {
      list: { current: { scrollTo: vi.fn() } },
      listEl: { current: { scrollHeight: 200, clientHeight: 180 } },
    } as unknown as TreeApi<WorkspaceFileTreeNode>;
    expect(restoreFileTreeScrollOffset(shortTreeApi, 120)).toBe(false);

    const readyWithoutListEl = {
      list: { current: { scrollTo: vi.fn() } },
      listEl: { current: null },
    } as unknown as TreeApi<WorkspaceFileTreeNode>;
    expect(restoreFileTreeScrollOffset(readyWithoutListEl, 120)).toBe(true);
    expect(restoreFileTreeScrollOffset(readyWithoutListEl, 0)).toBe(true);
  });
});
