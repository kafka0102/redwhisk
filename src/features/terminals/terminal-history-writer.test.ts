import { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeTerminalHistory } from "./terminal-history-writer";

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
    };

    await expect(
      writeTerminalHistory(brokenTerminal, "data", (suppressed) => {
        inputSuppressed = suppressed;
      }),
    ).rejects.toThrow("write failed");

    expect(inputSuppressed).toBe(false);
  });
});
