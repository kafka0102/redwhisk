import { describe, expect, it, vi } from "vitest";

import {
  TERMINAL_WEBGL_ATLAS_HEAL_EVERY_BYTES,
  createTerminalSurfaceLiveHandlers,
  healTerminalViewport,
} from "./terminal-surface-live-handlers";

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("healTerminalViewport", () => {
  it("clears webgl texture atlas then refreshes the viewport", () => {
    const terminal = {
      clearTextureAtlas: vi.fn(),
      refresh: vi.fn(),
      rows: 24,
    };

    healTerminalViewport(terminal as never);

    expect(terminal.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(terminal.refresh).toHaveBeenCalledWith(0, 23);
  });
});

describe("createTerminalSurfaceLiveHandlers", () => {
  it("does not show inplace scroll hint after CUP-heavy live writes", async () => {
    const showStatusMessage = vi.fn();
    const clearStatusMessage = vi.fn();
    let writeCallback: (() => void) | undefined;
    const terminal = {
      write: vi.fn((_bytes: Uint8Array, cb?: () => void) => {
        writeCallback = cb;
      }),
      clearTextureAtlas: vi.fn(),
      refresh: vi.fn(),
      rows: 24,
      buffer: { active: { baseY: 0, viewportY: 0 } },
      reset: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn(),
    };

    const handlers = createTerminalSurfaceLiveHandlers({
      clearStatusMessage,
      setInputSuppressed: vi.fn(),
      showStatusMessage,
      t: ((key: string) => key) as never,
      terminal: terminal as never,
      transportKey: "session-1",
    });

    handlers.writeBytes(encode("\x1b[H\x1b[1;1H\x1b[H\x1b[H"));
    writeCallback?.();

    expect(showStatusMessage).not.toHaveBeenCalled();
    expect(
      showStatusMessage.mock.calls.some((call) => call[0] === "inplace"),
    ).toBe(false);
  });

  it("writes live bytes without depending on removed inplace hint deps", () => {
    const terminal = {
      write: vi.fn(),
      clearTextureAtlas: vi.fn(),
      refresh: vi.fn(),
      rows: 24,
      buffer: { active: { baseY: 5, viewportY: 5 } },
      reset: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn(),
    };
    const handlers = createTerminalSurfaceLiveHandlers({
      clearStatusMessage: vi.fn(),
      setInputSuppressed: vi.fn(),
      showStatusMessage: vi.fn(),
      t: ((key: string) => key) as never,
      terminal: terminal as never,
      transportKey: 1,
    });

    const bytes = encode("hello\r\n");
    handlers.writeBytes(bytes);
    expect(terminal.write).toHaveBeenCalledWith(bytes);
  });

  it("heals webgl atlas after enough live bytes accumulate", () => {
    const terminal = {
      write: vi.fn(),
      clearTextureAtlas: vi.fn(),
      refresh: vi.fn(),
      rows: 32,
      buffer: { active: { baseY: 0, viewportY: 0 } },
      reset: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn(),
    };
    const handlers = createTerminalSurfaceLiveHandlers({
      clearStatusMessage: vi.fn(),
      setInputSuppressed: vi.fn(),
      showStatusMessage: vi.fn(),
      t: ((key: string) => key) as never,
      terminal: terminal as never,
      transportKey: "heal",
    });

    const chunk = new Uint8Array(TERMINAL_WEBGL_ATLAS_HEAL_EVERY_BYTES);
    handlers.writeBytes(chunk);

    expect(terminal.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(terminal.refresh).toHaveBeenCalledWith(0, 31);
  });
});

it("heals terminal viewport after history write and live ready", async () => {
  const terminal = {
    write: vi.fn((_data: string, callback?: () => void) => {
      callback?.();
    }),
    reset: vi.fn(),
    scrollToBottom: vi.fn(),
    scrollToLine: vi.fn(),
    clearTextureAtlas: vi.fn(),
    refresh: vi.fn(),
    rows: 24,
    buffer: { active: { baseY: 0, viewportY: 0 } },
  };
  const handlers = createTerminalSurfaceLiveHandlers({
    clearStatusMessage: vi.fn(),
    setInputSuppressed: vi.fn(),
    showStatusMessage: vi.fn(),
    t: ((key: string) => key) as never,
    terminal: terminal as never,
    transportKey: "project:1:2",
  });

  await handlers.writeHistory("prompt$ ", { restoreSequence: 3 });
  expect(terminal.clearTextureAtlas).toHaveBeenCalledTimes(1);
  expect(terminal.refresh).toHaveBeenCalledWith(0, 23);

  handlers.onLiveReady();
  expect(terminal.clearTextureAtlas).toHaveBeenCalledTimes(2);
  expect(terminal.refresh).toHaveBeenCalledTimes(2);
});
