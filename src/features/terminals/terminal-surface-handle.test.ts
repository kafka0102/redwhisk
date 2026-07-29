import { describe, expect, it, vi } from "vitest";

import { createTerminalSurfaceHandle } from "./terminal-surface-handle";

describe("createTerminalSurfaceHandle", () => {
  it("scrolls to bottom and focuses the terminal when available", () => {
    const scrollToBottom = vi.fn();
    const focus = vi.fn();
    const handle = createTerminalSurfaceHandle(
      () =>
        ({
          scrollToBottom,
          focus,
        }) as never,
    );

    handle.focus();

    expect(scrollToBottom).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("no-ops when the terminal is not ready", () => {
    const handle = createTerminalSurfaceHandle(() => null);
    expect(() => {
      handle.focus();
    }).not.toThrow();
  });
});
