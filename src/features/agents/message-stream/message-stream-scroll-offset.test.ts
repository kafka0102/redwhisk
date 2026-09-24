import { beforeEach, describe, expect, it } from "vitest";

import {
  clearMessageStreamScrollOffset,
  readMessageStreamScrollOffset,
  resetMessageStreamScrollOffsetCacheForTests,
  writeMessageStreamScrollOffset,
} from "./message-stream-scroll-offset";

beforeEach(() => {
  resetMessageStreamScrollOffsetCacheForTests();
});

describe("message-stream-scroll-offset", () => {
  it("未记录时返回 null", () => {
    expect(readMessageStreamScrollOffset(1)).toBeNull();
  });

  it("写入后可读回，负数按 0 处理", () => {
    writeMessageStreamScrollOffset(1, 320);
    expect(readMessageStreamScrollOffset(1)).toBe(320);

    writeMessageStreamScrollOffset(1, -12);
    expect(readMessageStreamScrollOffset(1)).toBe(0);
  });

  it("按 session 隔离，同 session 以后写入为准", () => {
    writeMessageStreamScrollOffset(1, 10);
    writeMessageStreamScrollOffset(2, 20);
    writeMessageStreamScrollOffset(1, 30);

    expect(readMessageStreamScrollOffset(1)).toBe(30);
    expect(readMessageStreamScrollOffset(2)).toBe(20);
  });

  it("清除后返回 null", () => {
    writeMessageStreamScrollOffset(1, 320);
    clearMessageStreamScrollOffset(1);

    expect(readMessageStreamScrollOffset(1)).toBeNull();
  });
});
