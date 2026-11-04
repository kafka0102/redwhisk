import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installTerminalSurfaceDataHandler } from "./terminal-surface-data-handler";
import { shouldDropLeakedMouseReport } from "./terminal-mouse-tracking";

/**
 * 截图症状：休眠后 SSH 被拆掉（Can't assign requested address），
 * 全动作鼠标追踪（DECSET 1003 + SGR 1006）没被关掉。
 * 指针一动，xterm 就把 `\x1b[<35;col;rowM` 写进本地 shell。
 * zsh 吃掉 CSI 前缀后留下 `35;4;22M`，`;` 再被当成命令分隔符。
 */

const SGR_MOTION = "\x1b[<35;4;22M";
const SGR_PRESS = "\x1b[<0;17;31M";
const SGR_RELEASE = "\x1b[<0;17;31m";

function mountTerminal(): { terminal: Terminal; host: HTMLDivElement } {
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

  const host = document.createElement("div");
  host.style.width = "800px";
  host.style.height = "480px";
  document.body.appendChild(host);
  const terminal = new Terminal({
    cols: 80,
    rows: 24,
    convertEol: false,
  });
  terminal.open(host);
  return { terminal, host };
}

function writeSync(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    terminal.write(data, () => resolve());
  });
}

describe("leaked any-event mouse tracking", () => {
  const opened: Array<{ terminal: Terminal; host: HTMLDivElement }> = [];

  afterEach(() => {
    for (const entry of opened.splice(0)) {
      entry.terminal.dispose();
      entry.host.remove();
    }
  });

  it("does not forward shell-buffer SGR mouse reports into the PTY", async () => {
    const mounted = mountTerminal();
    opened.push(mounted);
    const pushed: string[] = [];
    installTerminalSurfaceDataHandler({
      disableInput: false,
      imeInputGuard: null,
      inputWriter: { push: (data) => pushed.push(data) },
      isSuppressed: () => false,
      terminal: mounted.terminal,
    });

    await writeSync(mounted.terminal, "\x1b[?1003h\x1b[?1006h");
    expect(mounted.terminal.buffer.active.type).toBe("normal");
    expect(mounted.terminal.modes.mouseTrackingMode).toBe("any");

    expect(
      shouldDropLeakedMouseReport(
        mounted.terminal,
        `${SGR_MOTION}${SGR_PRESS}${SGR_RELEASE}`,
      ),
    ).toBe(true);

    mounted.terminal.input(SGR_MOTION, true);

    expect(pushed).toEqual([]);
    expect(mounted.terminal.modes.mouseTrackingMode).toBe("none");

    mounted.terminal.input("echo ok\r", true);
    expect(pushed).toEqual(["echo ok\r"]);
  });

  it("still forwards mouse reports while a TUI owns the alternate screen", async () => {
    const mounted = mountTerminal();
    opened.push(mounted);
    const pushed: string[] = [];
    installTerminalSurfaceDataHandler({
      disableInput: false,
      imeInputGuard: null,
      inputWriter: { push: (data) => pushed.push(data) },
      isSuppressed: () => false,
      terminal: mounted.terminal,
    });

    await writeSync(mounted.terminal, "\x1b[?1049h\x1b[?1003h\x1b[?1006h");
    expect(mounted.terminal.buffer.active.type).toBe("alternate");

    mounted.terminal.input(SGR_MOTION, true);

    expect(pushed).toEqual([SGR_MOTION]);
    expect(mounted.terminal.modes.mouseTrackingMode).toBe("any");
  });

  it("still forwards keystrokes and click-only tracking on the normal buffer", async () => {
    const mounted = mountTerminal();
    opened.push(mounted);
    const pushed: string[] = [];
    installTerminalSurfaceDataHandler({
      disableInput: false,
      imeInputGuard: null,
      inputWriter: { push: (data) => pushed.push(data) },
      isSuppressed: () => false,
      terminal: mounted.terminal,
    });

    await writeSync(mounted.terminal, "\x1b[?1002h\x1b[?1006h");
    expect(mounted.terminal.modes.mouseTrackingMode).toBe("drag");

    mounted.terminal.input("ls\r", true);
    mounted.terminal.input(SGR_PRESS, true);

    expect(pushed).toEqual(["ls\r", SGR_PRESS]);
    expect(mounted.terminal.modes.mouseTrackingMode).toBe("drag");
  });
});
