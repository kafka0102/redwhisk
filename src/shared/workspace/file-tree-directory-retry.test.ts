import { describe, expect, it } from "vitest";

import {
  clearFileTreeDirectoryLoadFailure,
  dueFileTreeDirectoryRetryPaths,
  markFileTreeDirectoryLoadFailed,
  type FileTreeDirectoryRetryQueue,
} from "./file-tree-directory-retry";

describe("file-tree-directory-retry", () => {
  it("backs off per directory and only reports due paths of the requested workspace", () => {
    const queue: FileTreeDirectoryRetryQueue = new Map();
    markFileTreeDirectoryLoadFailed(queue, "1::/tmp/a::src", "src", 0);
    markFileTreeDirectoryLoadFailed(queue, "1::/tmp/a::lib", "lib", 0);
    markFileTreeDirectoryLoadFailed(queue, "1::/tmp/b::src", "src", 0);

    // 首次失败 1s 后才到期，且不跨工作区串台。
    expect(dueFileTreeDirectoryRetryPaths(queue, "1::/tmp/a", 999)).toEqual([]);
    expect(
      dueFileTreeDirectoryRetryPaths(queue, "1::/tmp/a", 1_000).sort(),
    ).toEqual(["lib", "src"]);
    expect(dueFileTreeDirectoryRetryPaths(queue, "1::/tmp/b", 1_000)).toEqual([
      "src",
    ]);

    // 同一目录再次失败 → 退避翻倍到 2s。
    markFileTreeDirectoryLoadFailed(queue, "1::/tmp/a::src", "src", 1_000);
    expect(dueFileTreeDirectoryRetryPaths(queue, "1::/tmp/a", 2_999)).toEqual([
      "lib",
    ]);
    expect(
      dueFileTreeDirectoryRetryPaths(queue, "1::/tmp/a", 3_000).sort(),
    ).toEqual(["lib", "src"]);

    // 成功加载后清掉该目录的重试记录。
    clearFileTreeDirectoryLoadFailure(queue, "1::/tmp/a::src");
    expect(dueFileTreeDirectoryRetryPaths(queue, "1::/tmp/a", 30_000)).toEqual([
      "lib",
    ]);
  });

  it("caps the backoff delay at 30s", () => {
    const queue: FileTreeDirectoryRetryQueue = new Map();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      markFileTreeDirectoryLoadFailed(queue, "1::/tmp/a::src", "src", 0);
    }

    expect(dueFileTreeDirectoryRetryPaths(queue, "1::/tmp/a", 29_999)).toEqual(
      [],
    );
    expect(dueFileTreeDirectoryRetryPaths(queue, "1::/tmp/a", 30_000)).toEqual([
      "src",
    ]);
  });
});
