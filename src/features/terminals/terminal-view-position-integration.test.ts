import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import type { TFunction } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  persistMeasuredTerminalViewport,
  persistTerminalViewPosition,
} from "./terminal-history-writer";
import { TerminalLivePipeline } from "./terminal-live-pipeline";
import { createTerminalSurfaceLiveHandlers } from "./terminal-surface-live-handlers";
import { syncTerminalSurfaceSize } from "./terminal-surface-size";
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
 * - 项目终端：隐藏期间 sequence 前进则滚到最新；
 * - Agent 会话终端看当前 Turn：正在运行则切回滚到底（序号未变仍不重写）；不在运行且序号前进时只追加 tail、不 reset，viewport 停在离开前。
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
 * Agent TUI 传入「当前 Turn 是否正在运行」；项目终端不传。
 */
function createTerminalSurface(
  transport: TerminalTransport,
  terminal: FakeTerminal,
  options?: { isTurnRunning?: boolean },
) {
  const handlers = createTerminalSurfaceLiveHandlers({
    clearStatusMessage: vi.fn(),
    setInputSuppressed: vi.fn(),
    showStatusMessage: vi.fn(),
    t: ((key: string) => key) as unknown as TFunction,
    terminal: terminal as unknown as Terminal,
    transportKey: VIEW_KEY,
  });
  const pipeline =
    options && "isTurnRunning" in options
      ? new TerminalLivePipeline(transport, handlers, {
          isTurnRunning: options.isTurnRunning,
        })
      : new TerminalLivePipeline(transport, handlers);

  const persistViewState = (
    host: { width: number; height: number } = { width: 80, height: 24 },
  ) => {
    persistMeasuredTerminalViewport({
      viewKey: VIEW_KEY,
      sequence: pipeline.getLatestSequence(),
      reportedViewportY: terminal.viewportY,
      hostWidth: host.width,
      hostHeight: host.height,
    });
  };

  return {
    pipeline,
    isTurnRunning: options?.isTurnRunning === true,
    show: () => pipeline.becomeVisible(),
    hide: async (host?: { width: number; height: number }) => {
      persistViewState(host);
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

  it("当前 Turn 不在运行时隐藏期间有新输出仍停在离开前的视口", async () => {
    let sequence = LIVE_SEQUENCE;
    const tail = "new-tail\r\n";
    const transport = createTransport(sequence);
    transport.readSnapshot = vi.fn(async () => ({
      snapshot: sequence === LIVE_SEQUENCE ? HISTORY : tail,
      isActive: true,
    }));
    transport.restore = vi.fn(async () => ({
      sequence,
      chunks: [],
      isComplete: true,
      isActive: true,
    }));
    const terminal = createFakeTerminal();
    const isTurnRunning = false;
    const surface = createTerminalSurface(transport, terminal, {
      isTurnRunning,
    });

    await surface.show();
    terminal.viewportY = USER_VIEWPORT_Y;

    expect(terminal.buffer.active.viewportY).toBe(3);
    expect(terminal.buffer.active.baseY).toBe(40);
    expect(surface.isTurnRunning).toBe(false);
    expect(surface.pipeline.getLatestSequence()).toBe(5);
    expect(terminal.writes).toEqual([HISTORY]);

    await surface.hide();

    sequence = NEW_SEQUENCE;
    expect(surface.pipeline.getLatestSequence()).toBe(5);
    expect(sequence).toBe(6);
    expect(terminal.writes).toEqual([HISTORY]);

    const resetCallsBeforeReturn = terminal.reset.mock.calls.length;

    await surface.show();

    expect(surface.pipeline.getLatestSequence()).toBe(6);
    expect(terminal.reset).toHaveBeenCalledTimes(resetCallsBeforeReturn);
    expect(terminal.writes).toEqual([HISTORY, tail]);
    expect(terminal.buffer.active.viewportY).toBe(3);
    expect(terminal.buffer.active.viewportY).not.toBe(0);
    expect(terminal.buffer.active.viewportY).not.toBe(40);
  });

  it("当前 Turn 不在运行且序号未变时不重写缓冲区并停在离开前的视口", async () => {
    const terminal = createFakeTerminal();
    const surface = createTerminalSurface(
      createTransport(LIVE_SEQUENCE),
      terminal,
      { isTurnRunning: false },
    );

    await surface.show();
    terminal.viewportY = USER_VIEWPORT_Y;
    const writesBeforeReturn = terminal.write.mock.calls.length;
    const resetsBeforeReturn = terminal.reset.mock.calls.length;
    await surface.hide();
    await surface.show();

    expect(surface.isTurnRunning).toBe(false);
    expect(surface.pipeline.getLatestSequence()).toBe(LIVE_SEQUENCE);
    expect(terminal.write).toHaveBeenCalledTimes(writesBeforeReturn);
    expect(terminal.reset).toHaveBeenCalledTimes(resetsBeforeReturn);
    expect(terminal.buffer.active.viewportY).toBe(3);
    expect(terminal.buffer.active.viewportY).not.toBe(0);
    expect(terminal.buffer.active.viewportY).not.toBe(40);
  });

  it("当前 Turn 不在运行时卸载重挂载后回放仍停在离开前的视口", async () => {
    persistTerminalViewPosition(VIEW_KEY, LIVE_SEQUENCE, USER_VIEWPORT_Y);
    const terminal = createFakeTerminal();
    const surface = createTerminalSurface(
      createTransport(NEW_SEQUENCE),
      terminal,
      { isTurnRunning: false },
    );

    await surface.show();

    expect(terminal.reset).toHaveBeenCalled();
    expect(terminal.buffer.active.viewportY).toBe(3);
    expect(terminal.buffer.active.viewportY).not.toBe(0);
    expect(terminal.buffer.active.viewportY).not.toBe(BASE_Y);
  });

  it("当前 Turn 正在运行时序号未变仍滚到底且不重写缓冲区", async () => {
    const terminal = createFakeTerminal();
    const surface = createTerminalSurface(
      createTransport(LIVE_SEQUENCE),
      terminal,
      { isTurnRunning: true },
    );

    await surface.show();
    terminal.viewportY = USER_VIEWPORT_Y;
    const writesBeforeReturn = terminal.write.mock.calls.length;
    const resetsBeforeReturn = terminal.reset.mock.calls.length;
    await surface.hide();
    await surface.show();

    expect(surface.isTurnRunning).toBe(true);
    expect(terminal.write).toHaveBeenCalledTimes(writesBeforeReturn);
    expect(terminal.reset).toHaveBeenCalledTimes(resetsBeforeReturn);
    expect(terminal.buffer.active.viewportY).toBe(BASE_Y);
    expect(terminal.buffer.active.viewportY).not.toBe(3);
  });

  it("当前 Turn 正在运行时隐藏期间序号前进仍滚到底", async () => {
    let sequence = LIVE_SEQUENCE;
    const transport = createTransport(sequence);
    transport.restore = vi.fn(async () => ({
      sequence,
      chunks: [],
      isComplete: true,
      isActive: true,
    }));
    const terminal = createFakeTerminal();
    const surface = createTerminalSurface(transport, terminal, {
      isTurnRunning: true,
    });

    await surface.show();
    terminal.viewportY = USER_VIEWPORT_Y;
    await surface.hide();
    sequence = NEW_SEQUENCE;
    await surface.show();

    expect(surface.pipeline.getLatestSequence()).toBe(NEW_SEQUENCE);
    expect(terminal.buffer.active.viewportY).toBe(BASE_Y);
    expect(terminal.buffer.active.viewportY).not.toBe(3);
  });

  it("人还停在页面上时即使当前 Turn 正在运行也不把视口拽到底", async () => {
    const terminal = createFakeTerminal();
    const surface = createTerminalSurface(
      createTransport(LIVE_SEQUENCE),
      terminal,
      { isTurnRunning: true },
    );

    await surface.show();
    const scrollsAfterShow = terminal.scrollToBottom.mock.calls.length;
    terminal.viewportY = USER_VIEWPORT_Y;
    surface.pipeline.handleOutput({
      sequence: NEW_SEQUENCE,
      data: "eA==",
    });

    expect(terminal.buffer.active.viewportY).toBe(3);
    expect(terminal.buffer.active.viewportY).not.toBe(BASE_Y);
    expect(terminal.scrollToBottom).toHaveBeenCalledTimes(scrollsAfterShow);
  });

  it("隐藏期间不 fit、不写 xterm，零高度不把 viewport 3 写成 0", async () => {
    const hiddenFit = vi.fn();
    syncTerminalSurfaceSize({
      host: { offsetWidth: 0, offsetHeight: 0 } as HTMLElement,
      terminal: {} as Terminal,
      fitAddon: {
        fit: hiddenFit,
        proposeDimensions: vi.fn(),
      } as unknown as FitAddon,
      isStillMounted: () => true,
      showResizeError: vi.fn(),
      resize: vi.fn(async () => undefined),
      t: ((key: string) => key) as unknown as TFunction,
    });
    expect(hiddenFit).not.toHaveBeenCalled();

    const visibleFit = vi.fn();
    syncTerminalSurfaceSize({
      host: { offsetWidth: 80, offsetHeight: 24 } as HTMLElement,
      terminal: {} as Terminal,
      fitAddon: {
        fit: visibleFit,
        proposeDimensions: vi.fn(() => ({ rows: 24, cols: 80 })),
      } as unknown as FitAddon,
      isStillMounted: () => true,
      showResizeError: vi.fn(),
      resize: vi.fn(async () => undefined),
      t: ((key: string) => key) as unknown as TFunction,
    });
    expect(visibleFit).toHaveBeenCalledTimes(1);

    const terminal = createFakeTerminal();
    const surface = createTerminalSurface(
      createTransport(LIVE_SEQUENCE),
      terminal,
    );
    await surface.show();
    terminal.viewportY = USER_VIEWPORT_Y;
    await surface.hide();
    expect(peekTerminalViewState(VIEW_KEY)?.viewportY).toBe(3);

    terminal.viewportY = 0;
    await surface.hide({ width: 0, height: 0 });
    expect(peekTerminalViewState(VIEW_KEY)?.viewportY).toBe(3);

    const writesWhileHidden = terminal.write.mock.calls.length;
    surface.pipeline.handleOutput({ sequence: 99, data: "eA==" });
    expect(terminal.write).toHaveBeenCalledTimes(writesWhileHidden);
  });
});
