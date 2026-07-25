import { describe, expect, it, vi } from "vitest";

import { createTerminalSurfaceLiveHandlers } from "./terminal-surface-live-handlers";

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("createTerminalSurfaceLiveHandlers", () => {
  it("does not show inplace scroll hint after CUP-heavy live writes", async () => {
    const showStatusMessage = vi.fn();
    const clearStatusMessage = vi.fn();
    let writeCallback: (() => void) | undefined;
    const terminal = {
      write: vi.fn((_bytes: Uint8Array, cb?: () => void) => {
        writeCallback = cb;
      }),
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
});
