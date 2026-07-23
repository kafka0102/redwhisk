import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installKeepWindowFullscreenOnEscape,
  type FullscreenWindowLike,
} from "./keep-window-fullscreen-on-escape";

describe("installKeepWindowFullscreenOnEscape", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reasserts fullscreen after Escape when the window leaves fullscreen", async () => {
    vi.useFakeTimers();
    let isFullscreen = true;
    const resizedHandlers: Array<() => void> = [];
    const currentWindow: FullscreenWindowLike = {
      isFullscreen: vi.fn(async () => isFullscreen),
      setFullscreen: vi.fn(async (next) => {
        isFullscreen = next;
      }),
      onResized: vi.fn(async (handler) => {
        resizedHandlers.push(() => handler({}));
        return () => {
          // no-op unlisten for test
        };
      }),
    };

    const target = new EventTarget();
    const now = 1_000;
    const uninstall = installKeepWindowFullscreenOnEscape({
      getWindow: () => currentWindow,
      target,
      now: () => now,
      reassertDelaysMs: [0, 50],
      escapeGuardMs: 500,
      setTimeoutFn: (handler, delayMs) =>
        window.setTimeout(handler, delayMs) as unknown as number,
      clearTimeoutFn: (timeoutId) => window.clearTimeout(timeoutId),
    });

    await vi.waitFor(() =>
      expect(currentWindow.isFullscreen).toHaveBeenCalled(),
    );

    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await vi.waitFor(() =>
      expect(currentWindow.isFullscreen).toHaveBeenCalledTimes(2),
    );

    isFullscreen = false;
    resizedHandlers[0]?.();
    await vi.waitFor(() =>
      expect(currentWindow.setFullscreen).toHaveBeenCalledWith(true),
    );
    expect(isFullscreen).toBe(true);

    uninstall();
  });

  it("does not reassert fullscreen when Escape is pressed outside fullscreen", async () => {
    let isFullscreen = false;
    const currentWindow: FullscreenWindowLike = {
      isFullscreen: vi.fn(async () => isFullscreen),
      setFullscreen: vi.fn(async (next) => {
        isFullscreen = next;
      }),
    };

    const target = new EventTarget();
    const uninstall = installKeepWindowFullscreenOnEscape({
      getWindow: () => currentWindow,
      target,
      reassertDelaysMs: [0],
    });

    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(currentWindow.setFullscreen).not.toHaveBeenCalled();
    uninstall();
  });

  it("allows intentional fullscreen exit after the escape guard expires", async () => {
    vi.useFakeTimers();
    let isFullscreen = true;
    const resizedHandlers: Array<() => void> = [];
    const currentWindow: FullscreenWindowLike = {
      isFullscreen: vi.fn(async () => isFullscreen),
      setFullscreen: vi.fn(async (next) => {
        isFullscreen = next;
      }),
      onResized: vi.fn(async (handler) => {
        resizedHandlers.push(() => handler({}));
        return () => undefined;
      }),
    };

    let now = 0;
    const target = new EventTarget();
    const uninstall = installKeepWindowFullscreenOnEscape({
      getWindow: () => currentWindow,
      target,
      now: () => now,
      reassertDelaysMs: [0],
      escapeGuardMs: 100,
      setTimeoutFn: (handler, delayMs) =>
        window.setTimeout(handler, delayMs) as unknown as number,
      clearTimeoutFn: (timeoutId) => window.clearTimeout(timeoutId),
    });

    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await vi.waitFor(() =>
      expect(currentWindow.isFullscreen).toHaveBeenCalled(),
    );

    now = 1_000;
    isFullscreen = false;
    resizedHandlers[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(currentWindow.setFullscreen).not.toHaveBeenCalled();
    uninstall();
  });
});
