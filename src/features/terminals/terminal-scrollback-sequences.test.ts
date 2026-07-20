import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { writeTerminalHistory } from "./terminal-history-writer";

/**
 * 用户更正：故障时并非 alternate/fullscreen。
 * 在 normal buffer 上锁定能复现「只能看最近一屏、无法上滚；输出刷新后恢复」的路径。
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

function snapshotBuffer(terminal: Terminal): {
  type: string;
  baseY: number;
  viewportY: number;
  length: number;
  canScroll: boolean;
} {
  const active = terminal.buffer.active;
  return {
    type: active.type,
    baseY: active.baseY,
    viewportY: active.viewportY,
    length: active.length,
    canScroll: active.baseY > 0,
  };
}

function bufferContains(terminal: Terminal, needle: string): boolean {
  const parts: string[] = [];
  for (let y = 0; y < terminal.buffer.active.length; y += 1) {
    parts.push(terminal.buffer.active.getLine(y)?.translateToString(true) ?? "");
  }
  return parts.join("\n").includes(needle);
}

/** In-place TUI redraw on normal buffer: CUP home + rewrite rows (no alt-screen). */
function inPlaceRedraw(lines: string[]): string {
  let out = "\x1b[H";
  for (let i = 0; i < lines.length; i += 1) {
    out += `${lines[i]}\x1b[K`;
    if (i < lines.length - 1) {
      out += "\r\n";
    }
  }
  return out;
}

describe("terminal scrollback without alternate screen", () => {
  let terminal: Terminal | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    terminal?.dispose();
    terminal = null;
    host?.remove();
    host = null;
  });

  it("baseline: long normal output is scrollable", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;
    await writeSync(terminal, fillLines(80));
    expect(snapshotBuffer(terminal).type).toBe("normal");
    expect(snapshotBuffer(terminal).canScroll).toBe(true);
  });

  it("in-place viewport redraw never grows scrollback (normal-buffer symptom)", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    await writeSync(terminal, fillLines(5, "SHELL"));
    expect(snapshotBuffer(terminal).baseY).toBe(0);

    for (let frame = 0; frame < 30; frame += 1) {
      const rows = Array.from(
        { length: 20 },
        (_, i) => `FRAME-${frame}-ROW-${String(i).padStart(2, "0")}`,
      );
      await writeSync(terminal, inPlaceRedraw(rows));
    }

    const snap = snapshotBuffer(terminal);
    expect(snap.type).toBe("normal");
    expect(snap.canScroll).toBe(false);
    expect(snap.baseY).toBe(0);
    expect(bufferContains(terminal, "FRAME-29-ROW-00")).toBe(true);
  });

  it("after in-place redraw, line-mode overflow restores scroll", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    for (let frame = 0; frame < 5; frame += 1) {
      const rows = Array.from({ length: 20 }, (_, i) => `F${frame}-R${i}`);
      await writeSync(terminal, inPlaceRedraw(rows));
    }
    expect(snapshotBuffer(terminal).baseY).toBe(0);

    await writeSync(terminal, fillLines(40, "STREAM"));
    expect(snapshotBuffer(terminal).type).toBe("normal");
    expect(snapshotBuffer(terminal).canScroll).toBe(true);
  });

  it("shell history remains scrollable after in-place TUI frames", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    await writeSync(terminal, fillLines(80, "SHELL"));
    expect(snapshotBuffer(terminal).canScroll).toBe(true);
    expect(bufferContains(terminal, "SHELL-0000")).toBe(true);

    for (let frame = 0; frame < 10; frame += 1) {
      const rows = Array.from({ length: 20 }, (_, i) => `TUI-${frame}-${i}`);
      await writeSync(terminal, inPlaceRedraw(rows));
    }

    const snap = snapshotBuffer(terminal);
    expect(snap.type).toBe("normal");
    // pure in-place rewrite should NOT wipe prior scrollback
    expect(snap.canScroll).toBe(true);
    expect(bufferContains(terminal, "SHELL-0000")).toBe(true);
  });

  it("CSI 3J after shell history removes ability to reach earlier output", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    await writeSync(terminal, fillLines(80, "SHELL"));
    expect(snapshotBuffer(terminal).canScroll).toBe(true);

    await writeSync(terminal, "\x1b[3J");
    for (let frame = 0; frame < 5; frame += 1) {
      const rows = Array.from({ length: 20 }, (_, i) => `TUI-${frame}-${i}`);
      await writeSync(terminal, inPlaceRedraw(rows));
    }

    const snap = snapshotBuffer(terminal);
    expect(snap.type).toBe("normal");
    expect(bufferContains(terminal, "SHELL-0000")).toBe(false);
    expect(snap.baseY).toBe(0);
  });

  it("history rewrite with short tail collapses scrollable history", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;
    await writeSync(terminal, fillLines(120, "LIVE"));
    expect(snapshotBuffer(terminal).canScroll).toBe(true);

    await writeTerminalHistory(terminal, fillLines(20, "TAIL"), () => {});
    const snap = snapshotBuffer(terminal);
    expect(snap.type).toBe("normal");
    expect(bufferContains(terminal, "LIVE-0000")).toBe(false);
    expect(snap.baseY).toBe(0);
  });

  it("replaying log of in-place frames leaves only final screen (no scroll)", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    let log = fillLines(5, "SHELL");
    for (let frame = 0; frame < 20; frame += 1) {
      const rows = Array.from(
        { length: 20 },
        (_, i) => `FRAME-${frame}-ROW-${String(i).padStart(2, "0")}`,
      );
      log += inPlaceRedraw(rows);
    }

    await writeTerminalHistory(terminal, log, () => {});
    const snap = snapshotBuffer(terminal);
    expect(snap.type).toBe("normal");
    expect(snap.baseY).toBe(0);
    expect(bufferContains(terminal, "FRAME-19-ROW-00")).toBe(true);
  });

  it("scrollOnEraseInDisplay keeps scrollback across CSI 2J redraws", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;
    await writeSync(terminal, fillLines(60, "OLD"));
    const before = snapshotBuffer(terminal).baseY;
    for (let i = 0; i < 5; i += 1) {
      await writeSync(terminal, `\x1b[H\x1b[2J` + fillLines(10, `DRAW${i}`));
    }
    const snap = snapshotBuffer(terminal);
    expect(snap.type).toBe("normal");
    expect(snap.baseY).toBeGreaterThanOrEqual(before);
  });


  it("RED: short shell prompt is destroyed by full-screen in-place CUP redraw", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    // Typical first-terminal state: only a few prompt lines, still within one screen.
    await writeSync(
      terminal,
      "user@host project % \r\nuser@host project % codex\r\n",
    );
    expect(snapshotBuffer(terminal).type).toBe("normal");
    expect(snapshotBuffer(terminal).baseY).toBe(0);
    expect(bufferContains(terminal, "user@host project %")).toBe(true);

    // Codex-like full viewport redraw from home without alt-screen.
    for (let frame = 0; frame < 10; frame += 1) {
      const rows = Array.from(
        { length: 24 },
        (_, i) => `CODEX-UI-${frame}-${String(i).padStart(2, "0")}`,
      );
      await writeSync(terminal, inPlaceRedraw(rows));
    }

    const snap = snapshotBuffer(terminal);
    expect(snap.type).toBe("normal");
    expect(snap.baseY).toBe(0);
    expect(snap.canScroll).toBe(false);
    // USER SYMPTOM: cannot reach pre-codex shell output
    expect(bufferContains(terminal, "user@host project %")).toBe(false);
    expect(bufferContains(terminal, "CODEX-UI-9-00")).toBe(true);
  });

  it("after short-shell wipe, line-mode stream restores scroll but not shell", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    await writeSync(terminal, "prompt % codex\r\n");
    await writeSync(
      terminal,
      inPlaceRedraw(
        Array.from({ length: 24 }, (_, i) => `UI-${i}`),
      ),
    );
    expect(bufferContains(terminal, "prompt %")).toBe(false);
    expect(snapshotBuffer(terminal).baseY).toBe(0);

    await writeSync(terminal, fillLines(40, "STREAM"));
    expect(snapshotBuffer(terminal).canScroll).toBe(true);
    expect(bufferContains(terminal, "prompt %")).toBe(false);
    expect(bufferContains(terminal, "STREAM-0000")).toBe(true);
  });

  it("long shell already in scrollback survives full-screen in-place redraw", async () => {
    const mounted = mountTerminal();
    terminal = mounted.terminal;
    host = mounted.host;

    await writeSync(terminal, fillLines(80, "SHELL"));
    await writeSync(
      terminal,
      inPlaceRedraw(
        Array.from({ length: 24 }, (_, i) => `UI-${i}`),
      ),
    );
    expect(snapshotBuffer(terminal).type).toBe("normal");
    expect(snapshotBuffer(terminal).canScroll).toBe(true);
    expect(bufferContains(terminal, "SHELL-0000")).toBe(true);
  });

});
