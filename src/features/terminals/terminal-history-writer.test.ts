import { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  writeTerminalHistory,
  writeTerminalHistoryPreservingView,
} from "./terminal-history-writer";
import {
  clearTerminalViewStatesForTests,
  saveTerminalViewState,
} from "./terminal-view-state";

/**
 * 反馈环：复现「restore 回放含终端查询的历史 → onData 应答被写回 PTY」的症状。
 * 未抑制时写入会产出应答；经 writeTerminalHistory 抑制后 write 不得被调用。
 */
describe("writeTerminalHistory", () => {
  let terminal: Terminal | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    terminal?.dispose();
    terminal = null;
    host?.remove();
    host = null;
  });

  function mountTerminal(): Terminal {
    host = document.createElement("div");
    host.style.width = "800px";
    host.style.height = "400px";
    document.body.appendChild(host);

    terminal = new Terminal({ cols: 80, rows: 24 });
    terminal.open(host);
    return terminal;
  }

  it("documents that replaying capability queries fires onData answers", async () => {
    const term = mountTerminal();
    const answers: string[] = [];
    term.onData((data) => {
      answers.push(data);
    });

    await new Promise<void>((resolve) => {
      term.write("\x1b[6n\x1b[0c\x1b]11;?\x07", () => {
        resolve();
      });
    });

    // 这就是 bug 的触发机制：历史里的查询被 xterm 再应答。
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.join("")).toMatch(/R|\?.*c|rgb:/);
  });

  it("suppresses xterm query responses from being forwarded as PTY input", async () => {
    const term = mountTerminal();
    const ptyWrites: string[] = [];
    let inputSuppressed = false;

    term.onData((data) => {
      if (inputSuppressed) {
        return;
      }
      ptyWrites.push(data);
    });

    // 与 SSH / 远程 shell 常见能力探测一致：DSR、DA1、OSC 颜色、DECRQSS
    const historyWithQueries =
      "prompt$ ls\r\n" +
      "\x1b[6n" +
      "\x1b[0c" +
      "\x1b]10;?\x07" +
      "\x1b]11;?\x07" +
      "\x1b]12;?\x07" +
      "\x1bP$qm\x1b\\";

    await writeTerminalHistory(term, historyWithQueries, (suppressed) => {
      inputSuppressed = suppressed;
    });

    expect(inputSuppressed).toBe(false);
    expect(ptyWrites).toEqual([]);
  });

  it("forwards onData to PTY again after history restore completes", async () => {
    const term = mountTerminal();
    const ptyWrites: string[] = [];
    let inputSuppressed = false;

    term.onData((data) => {
      if (inputSuppressed) {
        return;
      }
      ptyWrites.push(data);
    });

    await writeTerminalHistory(term, "ready\r\n", (suppressed) => {
      inputSuppressed = suppressed;
    });

    // 用户按键（模拟）应恢复转发
    term.input("x");
    expect(ptyWrites).toContain("x");
  });

  it("does not leave input suppressed when write throws before callback", async () => {
    let inputSuppressed = false;
    const brokenTerminal = {
      reset: vi.fn(),
      write: vi.fn(() => {
        throw new Error("write failed");
      }),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn(),
      buffer: { active: { baseY: 0 } },
    };

    await expect(
      writeTerminalHistory(brokenTerminal, "data", (suppressed) => {
        inputSuppressed = suppressed;
      }),
    ).rejects.toThrow("write failed");

    expect(inputSuppressed).toBe(false);
  });

  it("scrolls to bottom by default after history write", async () => {
    const term = mountTerminal();
    const scrollToBottom = vi.spyOn(term, "scrollToBottom");
    const scrollToLine = vi.spyOn(term, "scrollToLine");

    await writeTerminalHistory(term, "line-1\r\nline-2\r\n", () => undefined);

    expect(scrollToBottom).toHaveBeenCalledTimes(1);
    expect(scrollToLine).not.toHaveBeenCalled();
  });

  it("restores viewport when restoreViewportY is provided", async () => {
    const scrollToBottom = vi.fn();
    const scrollToLine = vi.fn();
    const fakeTerminal = {
      reset: vi.fn(),
      write: vi.fn((_data: string, callback?: () => void) => {
        callback?.();
      }),
      scrollToBottom,
      scrollToLine,
      buffer: { active: { baseY: 40 } },
    };

    await writeTerminalHistory(fakeTerminal, "history", () => undefined, {
      restoreViewportY: 12,
    });

    expect(scrollToBottom).not.toHaveBeenCalled();
    expect(scrollToLine).toHaveBeenCalledWith(12);
  });

  it("clamps restoreViewportY to baseY", async () => {
    const scrollToLine = vi.fn();
    const fakeTerminal = {
      reset: vi.fn(),
      write: vi.fn((_data: string, callback?: () => void) => {
        callback?.();
      }),
      scrollToBottom: vi.fn(),
      scrollToLine,
      buffer: { active: { baseY: 5 } },
    };

    await writeTerminalHistory(fakeTerminal, "history", () => undefined, {
      restoreViewportY: 99,
    });

    expect(scrollToLine).toHaveBeenCalledWith(5);
  });
});

describe("writeTerminalHistoryPreservingView", () => {
  afterEach(() => {
    clearTerminalViewStatesForTests();
  });

  it("restores viewport when sequence is unchanged", async () => {
    saveTerminalViewState("term-a", { sequence: 8, viewportY: 4 });
    const scrollToBottom = vi.fn();
    const scrollToLine = vi.fn();
    const fakeTerminal = {
      reset: vi.fn(),
      write: vi.fn((_data: string, callback?: () => void) => {
        callback?.();
      }),
      scrollToBottom,
      scrollToLine,
      buffer: { active: { baseY: 20, viewportY: 20 } },
    };

    await writeTerminalHistoryPreservingView(
      fakeTerminal,
      "history",
      () => undefined,
      "term-a",
      8,
    );

    expect(scrollToLine).toHaveBeenCalledWith(4);
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("scrolls to bottom when sequence advanced", async () => {
    saveTerminalViewState("term-a", { sequence: 8, viewportY: 4 });
    const scrollToBottom = vi.fn();
    const scrollToLine = vi.fn();
    const fakeTerminal = {
      reset: vi.fn(),
      write: vi.fn((_data: string, callback?: () => void) => {
        callback?.();
      }),
      scrollToBottom,
      scrollToLine,
      buffer: { active: { baseY: 20, viewportY: 20 } },
    };

    await writeTerminalHistoryPreservingView(
      fakeTerminal,
      "history",
      () => undefined,
      "term-a",
      12,
    );

    expect(scrollToBottom).toHaveBeenCalledTimes(1);
    expect(scrollToLine).not.toHaveBeenCalled();
  });
});
