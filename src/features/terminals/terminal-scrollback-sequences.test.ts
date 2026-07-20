import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { writeTerminalHistory } from "./terminal-history-writer";

/**
 * 诊断环：复现「终端有时只能看到最近一屏、无法上滚看更早输出；
 * 过一会输出刷新后又恢复」的机制。
 *
 * 用户症状对应 xterm 的 buffer 状态：
 * - active.type === "alternate" 且 baseY === 0 → 无法上滚（TUI 备用屏）
 * - active.type === "normal" 且 baseY > 0 → 可上滚
 *
 * Codex CLI 二进制包含 EnterAlternateScreen / CSI ?1049h / CSI 3J。
 */

function mountTerminal(options?: ConstructorParameters<typeof Terminal>[0]): {
  terminal: Terminal;
  host: HTMLDivElement;
} {
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
    scrollback: 10_000,
    scrollOnEraseInDisplay: true,
    ...options,
  });
  terminal.open(host);
  return { terminal, host };
}

function writeSync(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    terminal.write(data, () => resolve());
  });
}

function fillLines(count: number, prefix = "LINE"): string {
  return Array.from(
    { length: count },
    (_, i) => `${prefix}-${String(i).padStart(4, "0")}\r\n`,
  ).join("");
}

describe("terminal scrollback control sequences", () => {
  let terminal: Terminal | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    terminal?.dispose();
    terminal = null;
    host?.remove();
    host = null;
  });

  it("normal long output creates scrollback", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    await writeSync(terminal, fillLines(80));

    expect(terminal.buffer.active.baseY).toBeGreaterThan(0);
    expect(terminal.buffer.active.type).toBe("normal");
  });

  it("CSI ?1049h alternate screen removes scroll capability (user symptom)", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    await writeSync(terminal, fillLines(60, "SHELL"));
    const normalBaseY = terminal.buffer.normal.baseY;
    expect(normalBaseY).toBeGreaterThan(0);

    await writeSync(
      terminal,
      "\x1b[?1049h\x1b[H\x1b[2J" + fillLines(20, "CODEX"),
    );

    expect(terminal.buffer.active.type).toBe("alternate");
    expect(terminal.buffer.active.baseY).toBe(0);
    expect(terminal.buffer.normal.baseY).toBe(normalBaseY);
  });

  it("CSI ?1049l leaves alternate screen and restores scrollback", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    await writeSync(terminal, fillLines(60, "SHELL"));
    await writeSync(
      terminal,
      "\x1b[?1049h\x1b[H\x1b[2J" + fillLines(15, "CODEX"),
    );
    expect(terminal.buffer.active.type).toBe("alternate");

    await writeSync(terminal, "\x1b[?1049l");
    expect(terminal.buffer.active.type).toBe("normal");
    expect(terminal.buffer.active.baseY).toBeGreaterThan(0);
  });

  it("legacy CSI ?47h also enters non-scrollable alternate screen", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    await writeSync(terminal, fillLines(40, "SHELL"));
    await writeSync(terminal, "\x1b[?47h" + fillLines(10, "TUI"));
    expect(terminal.buffer.active.type).toBe("alternate");
    expect(terminal.buffer.active.baseY).toBe(0);
  });

  it("split CSI alternate-enter across chunk boundaries still enters alt screen", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    await writeSync(terminal, fillLines(40, "SHELL"));
    await writeSync(terminal, "\x1b[?");
    await writeSync(terminal, "1049h\x1b[H\x1b[2J" + fillLines(8, "SPLIT"));
    expect(terminal.buffer.active.type).toBe("alternate");
    expect(terminal.buffer.active.baseY).toBe(0);
  });

  it("history restore while log ends inside alt screen stays non-scrollable", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    const log =
      fillLines(50, "SHELL") +
      "\x1b[?1049h\x1b[H\x1b[2J" +
      fillLines(12, "CODEX");

    await writeTerminalHistory(terminal, log, () => {});

    expect(terminal.buffer.active.type).toBe("alternate");
    expect(terminal.buffer.active.baseY).toBe(0);
  });

  it("history restore after alt screen exit is scrollable again", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    const log =
      fillLines(50, "SHELL") +
      "\x1b[?1049h\x1b[H\x1b[2J" +
      fillLines(12, "CODEX") +
      "\x1b[?1049l" +
      fillLines(30, "AFTER");

    await writeTerminalHistory(terminal, log, () => {});
    expect(terminal.buffer.active.type).toBe("normal");
    expect(terminal.buffer.active.baseY).toBeGreaterThan(0);
  });

  it("ED clear with scrollOnEraseInDisplay keeps scrollback on normal buffer", async () => {
    const mounted = mountTerminal({ scrollOnEraseInDisplay: true });
    terminal = mounted.terminal;
    host = mounted.host;

    await writeSync(terminal, fillLines(50, "OLD"));
    const before = terminal.buffer.active.baseY;
    expect(before).toBeGreaterThan(0);

    await writeSync(terminal, "\x1b[H\x1b[2J" + fillLines(5, "NEW"));
    expect(terminal.buffer.active.type).toBe("normal");
    expect(terminal.buffer.active.baseY).toBeGreaterThanOrEqual(before);
  });

  it("CSI 3J erase saved lines can wipe scrollback content", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    await writeSync(terminal, fillLines(50, "OLD"));
    expect(terminal.buffer.active.baseY).toBeGreaterThan(0);

    await writeSync(terminal, "\x1b[3J\x1b[H\x1b[2J" + fillLines(5, "NEW"));
    const bufferText: string[] = [];
    for (let y = 0; y < terminal.buffer.active.length; y += 1) {
      bufferText.push(
        terminal.buffer.active.getLine(y)?.translateToString(true) ?? "",
      );
    }
    const joined = bufferText.join("\n");
    expect(joined).not.toContain("OLD-0000");
    expect(joined).toContain("NEW-0000");
  });

  it("synchronized update + alt screen enter is non-scrollable", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    await writeSync(terminal, fillLines(50, "SHELL"));
    await writeSync(
      terminal,
      "\x1b[?2026h\x1b[?1049h\x1b[H\x1b[2J" +
        fillLines(18, "CODEX") +
        "\x1b[?2026l",
    );
    expect(terminal.buffer.active.type).toBe("alternate");
    expect(terminal.buffer.active.baseY).toBe(0);
  });

  it("missing 1049l leaves session stuck non-scrollable across redraws", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    await writeSync(terminal, fillLines(40, "SHELL"));
    await writeSync(
      terminal,
      "\x1b[?1049h\x1b[H\x1b[2J" + fillLines(10, "CODEX"),
    );
    await writeSync(terminal, "\x1b[H\x1b[2J" + fillLines(10, "REDRAW"));
    expect(terminal.buffer.active.type).toBe("alternate");
    expect(terminal.buffer.active.baseY).toBe(0);
  });
});
