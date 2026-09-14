import type { TFunction } from "i18next";
import type { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { persistTerminalViewPosition } from "./terminal-history-writer";
import { TerminalLivePipeline } from "./terminal-live-pipeline";
import { createTerminalSurfaceLiveHandlers } from "./terminal-surface-live-handlers";
import {
  clearTerminalViewStatesForTests,
  peekTerminalViewState,
} from "./terminal-view-state";
import type { TerminalTransport } from "./terminal-types";

/**
 * Session 内嵌终端跨 Activity / Tab 切换的位置保持回归。
 *
 * 与 `terminal-history-writer.test.ts` 的缓存往返用例互补：那里只调用落缓存 / 回放两个端点，
 * 这里按 `TerminalSurface` 的装配方式组装「管道 + 表面回调 + 历史回放 + 视图状态缓存」，
 * 锁住端点两侧的接线本身：
 * - 隐藏 / 卸载时记录 viewportY 与 sequence（terminal-surface.tsx 的 persistViewState）；
 * - 再次可见时若 sequence 未变则跳过整段回放，xterm 缓冲区与滚动位置原样保留；
 * - 卸载后重新挂载（sequence 归零）回放历史，并按缓存 viewport 恢复；
 * - 隐藏期间有新输出（sequence 前进）按既有约定滚到最新。
 */
const VIEW_KEY = "terminal:42";
const HISTORY = "prompt$ ls\r\nsrc\r\n";
const LIVE_SEQUENCE = 5;
const NEW_SEQUENCE = 6;
const BASE_Y = 40;
const USER_VIEWPORT_Y = 3;

interface FakeTerminal {
  baseY: number;
  viewportY: number;
  rows: number;
  writes: string[];
  reset: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  scrollToBottom: ReturnType<typeof vi.fn>;
  scrollToLine: ReturnType<typeof vi.fn>;
  clearTextureAtlas: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  buffer: { active: { baseY: number; viewportY: number } };
}

function createFakeTerminal(): FakeTerminal {
  const terminal: FakeTerminal = {
    baseY: BASE_Y,
    viewportY: BASE_Y,
    rows: 24,
    writes: [],
    reset: vi.fn(() => {
      terminal.writes = [];
    }),
    write: vi.fn((data: string, callback?: () => void) => {
      terminal.writes.push(data);
      callback?.();
    }),
    scrollToBottom: vi.fn(() => {
      terminal.viewportY = terminal.baseY;
    }),
    scrollToLine: vi.fn((line: number) => {
      terminal.viewportY = line;
    }),
    clearTextureAtlas: vi.fn(),
    refresh: vi.fn(),
    buffer: {
      get active() {
        return { baseY: terminal.baseY, viewportY: terminal.viewportY };
      },
    },
  };
  return terminal;
}

function createTransport(sequence: number): TerminalTransport {
  return {
    readSnapshot: vi.fn(async () => ({ snapshot: HISTORY, isActive: true })),
    resize: vi.fn(async () => undefined),
    restore: vi.fn(async () => ({
      sequence,
      chunks: [],
      isComplete: true,
      isActive: true,
    })),
    setLiveSubscription: vi.fn(async () => undefined),
    subscribeOutput: vi.fn(async () => () => undefined),
    write: vi.fn(async () => undefined),
  };
}

/**
 * 照 `TerminalSurface` 的装配方式创建终端表面：
 * 可见 → `pipeline.becomeVisible()`；隐藏 / 卸载 → 先记录 viewport 与 sequence 再切换。
 */
function createTerminalSurface(
  transport: TerminalTransport,
  terminal: FakeTerminal,
) {
  const pipeline = new TerminalLivePipeline(
    transport,
    createTerminalSurfaceLiveHandlers({
      clearStatusMessage: vi.fn(),
      setInputSuppressed: vi.fn(),
      showStatusMessage: vi.fn(),
      t: ((key: string) => key) as unknown as TFunction,
      terminal: terminal as unknown as Terminal,
      transportKey: VIEW_KEY,
    }),
  );

  const persistViewState = () => {
    persistTerminalViewPosition(
      VIEW_KEY,
      pipeline.getLatestSequence(),
      terminal.viewportY,
    );
  };

  return {
    pipeline,
    show: () => pipeline.becomeVisible(),
    hide: async () => {
      persistViewState();
      await pipeline.becomeHidden();
    },
    unmount: () => {
      persistViewState();
      pipeline.dispose();
    },
  };
}

describe("Session 内嵌终端跨切换位置保持", () => {
  afterEach(() => {
    clearTerminalViewStatesForTests();
  });

  it("records viewport and sequence on hide, and keeps the scroll position when it becomes visible again with no new output", async () => {
    const terminal = createFakeTerminal();
    const surface = createTerminalSurface(
      createTransport(LIVE_SEQUENCE),
      terminal,
    );

    await surface.show();
    expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1);

    // 用户向上滚动阅读历史输出。
    terminal.viewportY = USER_VIEWPORT_Y;
    await surface.hide();
    expect(peekTerminalViewState(VIEW_KEY)).toEqual({
      sequence: LIVE_SEQUENCE,
      viewportY: USER_VIEWPORT_Y,
    });

    await surface.show();
    expect(terminal.viewportY).toBe(USER_VIEWPORT_Y);
    expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1);
    expect(terminal.scrollToLine).not.toHaveBeenCalled();
  });

  it("records viewport and sequence on unmount", async () => {
    const terminal = createFakeTerminal();
    const surface = createTerminalSurface(
      createTransport(LIVE_SEQUENCE),
      terminal,
    );

    await surface.show();
    terminal.viewportY = USER_VIEWPORT_Y;
    surface.unmount();

    expect(peekTerminalViewState(VIEW_KEY)).toEqual({
      sequence: LIVE_SEQUENCE,
      viewportY: USER_VIEWPORT_Y,
    });
  });

  it("restores the cached viewport when the surface is mounted again and no new output arrived", async () => {
    persistTerminalViewPosition(VIEW_KEY, LIVE_SEQUENCE, USER_VIEWPORT_Y);
    const terminal = createFakeTerminal();
    const surface = createTerminalSurface(
      createTransport(LIVE_SEQUENCE),
      terminal,
    );

    await surface.show();

    expect(terminal.scrollToLine).toHaveBeenCalledWith(USER_VIEWPORT_Y);
    expect(terminal.scrollToBottom).not.toHaveBeenCalled();
    expect(terminal.viewportY).toBe(USER_VIEWPORT_Y);
  });

  it("scrolls to the latest output when new output arrived while the surface was away", async () => {
    persistTerminalViewPosition(VIEW_KEY, LIVE_SEQUENCE, USER_VIEWPORT_Y);
    const terminal = createFakeTerminal();
    const surface = createTerminalSurface(
      createTransport(NEW_SEQUENCE),
      terminal,
    );

    await surface.show();

    expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1);
    expect(terminal.scrollToLine).not.toHaveBeenCalled();
    expect(terminal.viewportY).toBe(BASE_Y);
  });

  it("starts at the latest output when the surface is mounted for the first time", async () => {
    const terminal = createFakeTerminal();
    const surface = createTerminalSurface(
      createTransport(LIVE_SEQUENCE),
      terminal,
    );

    await surface.show();

    expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1);
    expect(terminal.scrollToLine).not.toHaveBeenCalled();
  });
});
