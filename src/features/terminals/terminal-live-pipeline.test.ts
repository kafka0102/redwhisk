import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  encodeBytesToBase64,
  TerminalLivePipeline,
} from "./terminal-live-pipeline";
import type { TerminalTransport } from "./terminal-types";

function createTransport(
  overrides: Partial<TerminalTransport> = {},
): TerminalTransport {
  return {
    readSnapshot: vi.fn(async () => ({
      snapshot: "history-tail",
      isActive: true,
    })),
    resize: vi.fn(async () => undefined),
    restore: vi.fn(async () => ({
      sequence: 10,
      chunks: [],
      isComplete: true,
      isActive: true,
    })),
    setLiveSubscription: vi.fn(async () => undefined),
    subscribeOutput: vi.fn(async () => () => undefined),
    write: vi.fn(async () => undefined),
    ...overrides,
  };
}

function textToBase64(text: string): string {
  return encodeBytesToBase64(new TextEncoder().encode(text));
}

describe("TerminalLivePipeline", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback): number => {
        callback(0);
        return 1;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queues live output during catch-up and only writes after history + sequence", async () => {
    const writes: string[] = [];
    let resolveRestore!: (value: {
      sequence: number;
      chunks: number[][];
      isComplete: boolean;
      isActive: boolean;
    }) => void;
    const restoreGate = new Promise<{
      sequence: number;
      chunks: number[][];
      isComplete: boolean;
      isActive: boolean;
    }>((resolve) => {
      resolveRestore = resolve;
    });

    const transport = createTransport({
      restore: vi.fn(() => restoreGate),
      readSnapshot: vi.fn(async () => ({
        snapshot: "from-log",
        isActive: true,
      })),
    });

    const pipeline = new TerminalLivePipeline(transport, {
      writeBytes: (bytes) => {
        writes.push(new TextDecoder().decode(bytes));
      },
      writeHistory: (text) => {
        writes.push(`history:${text}`);
      },
      onRestoreError: vi.fn(),
      onInactive: vi.fn(),
      onLiveReady: vi.fn(),
      onPendingDropped: vi.fn(),
    });

    const visiblePromise = pipeline.becomeVisible();
    // 等 setLiveSubscription / restore 挂起
    await Promise.resolve();
    expect(pipeline.getPhase()).toBe("catchingUp");

    pipeline.handleOutput({
      sequence: 11,
      data: textToBase64("live-after"),
    });
    // catch-up 期间不得写 live
    expect(writes).toEqual([]);

    resolveRestore({
      sequence: 10,
      chunks: [],
      isComplete: true,
      isActive: true,
    });
    await visiblePromise;

    expect(pipeline.getPhase()).toBe("live");
    expect(writes[0]).toBe("history:from-log");
    expect(writes.slice(1).join("")).toContain("live-after");
    expect(transport.setLiveSubscription).toHaveBeenCalledWith(true);
  });

  it("awaits writeHistory before flushing live output", async () => {
    const writes: string[] = [];
    let resolveHistory!: () => void;
    const historyGate = new Promise<void>((resolve) => {
      resolveHistory = resolve;
    });
    let historyStarted!: () => void;
    const historyStartedGate = new Promise<void>((resolve) => {
      historyStarted = resolve;
    });

    const transport = createTransport({
      readSnapshot: vi.fn(async () => ({
        snapshot: "from-log",
        isActive: true,
      })),
    });

    const pipeline = new TerminalLivePipeline(transport, {
      writeBytes: (bytes) => {
        writes.push(new TextDecoder().decode(bytes));
      },
      writeHistory: async (text) => {
        writes.push(`history-start:${text}`);
        historyStarted();
        await historyGate;
        writes.push(`history-end:${text}`);
      },
      onRestoreError: vi.fn(),
      onInactive: vi.fn(),
      onLiveReady: vi.fn(),
      onPendingDropped: vi.fn(),
    });

    const visiblePromise = pipeline.becomeVisible();
    await historyStartedGate;

    pipeline.handleOutput({
      sequence: 11,
      data: textToBase64("live-after"),
    });

    // history 未完成前不得写 live
    expect(writes).toEqual(["history-start:from-log"]);

    resolveHistory();
    await visiblePromise;

    expect(writes[0]).toBe("history-start:from-log");
    expect(writes[1]).toBe("history-end:from-log");
    expect(writes.slice(2).join("")).toContain("live-after");
  });

  it("drops output while idle and catch-up from log on re-visible", async () => {
    const writes: string[] = [];
    const transport = createTransport();
    const pipeline = new TerminalLivePipeline(transport, {
      writeBytes: (bytes) => {
        writes.push(new TextDecoder().decode(bytes));
      },
      writeHistory: (text) => {
        writes.push(`history:${text}`);
      },
      onRestoreError: vi.fn(),
      onInactive: vi.fn(),
      onLiveReady: vi.fn(),
      onPendingDropped: vi.fn(),
    });

    pipeline.handleOutput({
      sequence: 1,
      data: textToBase64("ignored"),
    });
    expect(writes).toEqual([]);

    await pipeline.becomeVisible();
    expect(writes[0]).toBe("history:history-tail");
  });

  it("ignores live sequences already covered by restore head", async () => {
    const liveWrites: string[] = [];
    const transport = createTransport({
      restore: vi.fn(async () => ({
        sequence: 5,
        chunks: [],
        isComplete: true,
        isActive: true,
      })),
    });
    const pipeline = new TerminalLivePipeline(transport, {
      writeBytes: (bytes) => {
        liveWrites.push(new TextDecoder().decode(bytes));
      },
      writeHistory: vi.fn(),
      onRestoreError: vi.fn(),
      onInactive: vi.fn(),
      onLiveReady: vi.fn(),
      onPendingDropped: vi.fn(),
    });

    await pipeline.becomeVisible();
    pipeline.handleOutput({ sequence: 5, data: textToBase64("old") });
    pipeline.handleOutput({ sequence: 6, data: textToBase64("new") });

    expect(liveWrites.join("")).toBe("new");
    expect(liveWrites.join("")).not.toContain("old");
  });

  it("unsubscribes and clears buffers when hidden", async () => {
    const transport = createTransport();
    const pipeline = new TerminalLivePipeline(transport, {
      writeBytes: vi.fn(),
      writeHistory: vi.fn(),
      onRestoreError: vi.fn(),
      onInactive: vi.fn(),
      onLiveReady: vi.fn(),
      onPendingDropped: vi.fn(),
    });

    await pipeline.becomeVisible();
    await pipeline.becomeHidden();

    expect(pipeline.getPhase()).toBe("idle");
    expect(transport.setLiveSubscription).toHaveBeenLastCalledWith(false);

    pipeline.handleOutput({
      sequence: 99,
      data: textToBase64("after-hide"),
    });
  });

  it("enters live ready even when restore snapshot is incomplete", async () => {
    const onLiveReady = vi.fn();
    const transport = createTransport({
      restore: vi.fn(async () => ({
        sequence: 7,
        chunks: [],
        isComplete: false,
        isActive: true,
      })),
    });
    const pipeline = new TerminalLivePipeline(transport, {
      writeBytes: vi.fn(),
      writeHistory: vi.fn(),
      onRestoreError: vi.fn(),
      onInactive: vi.fn(),
      onLiveReady,
      onPendingDropped: vi.fn(),
    });

    await pipeline.becomeVisible();

    expect(pipeline.getPhase()).toBe("live");
    expect(pipeline.getLatestSequence()).toBe(7);
    expect(onLiveReady).toHaveBeenCalledTimes(1);
  });

  it("passes restoreSequence to writeHistory", async () => {
    const metas: Array<{ restoreSequence: number }> = [];
    const transport = createTransport({
      restore: vi.fn(async () => ({
        sequence: 42,
        chunks: [],
        isComplete: true,
        isActive: true,
      })),
    });
    const pipeline = new TerminalLivePipeline(transport, {
      writeBytes: vi.fn(),
      writeHistory: (_text, meta) => {
        metas.push(meta);
      },
      onRestoreError: vi.fn(),
      onInactive: vi.fn(),
      onLiveReady: vi.fn(),
      onPendingDropped: vi.fn(),
    });

    await pipeline.becomeVisible();

    expect(metas).toEqual([{ restoreSequence: 42 }]);
    expect(pipeline.getLatestSequence()).toBe(42);
  });
});
