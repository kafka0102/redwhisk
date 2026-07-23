/**
 * 在系统/原生全屏下，macOS 等会把 ESC 当作「退出全屏」。
 * 本模块在检测到 ESC 且当时处于全屏时，于窗口尺寸变化后把全屏重新拉回。
 *
 * 故意不 stopPropagation / preventDefault：应用内对话框、终端 TUI 等仍需收到 ESC。
 */

import { getCurrentWindow } from "@tauri-apps/api/window";

export interface FullscreenWindowLike {
  isFullscreen: () => Promise<boolean>;
  setFullscreen: (fullscreen: boolean) => Promise<void>;
  onResized?: (handler: (event: unknown) => void) => Promise<() => void>;
}

export interface KeepWindowFullscreenOnEscapeOptions {
  getWindow?: () => FullscreenWindowLike;
  target?: EventTarget;
  now?: () => number;
  reassertDelaysMs?: readonly number[];
  escapeGuardMs?: number;
  setTimeoutFn?: (handler: () => void, delayMs: number) => number;
  clearTimeoutFn?: (timeoutId: number) => void;
}

const DEFAULT_REASSERT_DELAYS_MS = [0, 80, 320] as const;
const DEFAULT_ESCAPE_GUARD_MS = 1_200;

export function installKeepWindowFullscreenOnEscape(
  options: KeepWindowFullscreenOnEscapeOptions = {},
): () => void {
  const getWindow = options.getWindow ?? (() => getCurrentWindow());
  const target = options.target ?? document;
  const now = options.now ?? Date.now;
  const reassertDelaysMs =
    options.reassertDelaysMs ?? DEFAULT_REASSERT_DELAYS_MS;
  const escapeGuardMs = options.escapeGuardMs ?? DEFAULT_ESCAPE_GUARD_MS;
  const setTimeoutFn =
    options.setTimeoutFn ??
    ((handler, delayMs) => window.setTimeout(handler, delayMs));
  const clearTimeoutFn =
    options.clearTimeoutFn ?? ((timeoutId) => window.clearTimeout(timeoutId));

  let lastKnownFullscreen = false;
  let escapeGuardUntil = 0;
  const timeoutIds = new Set<number>();
  let disposed = false;
  let unlistenResized: (() => void) | undefined;

  const clearScheduled = (): void => {
    for (const timeoutId of timeoutIds) {
      clearTimeoutFn(timeoutId);
    }
    timeoutIds.clear();
  };

  const readIsFullscreen = async (): Promise<boolean> => {
    try {
      const currentWindow = getWindow();
      if (typeof currentWindow.isFullscreen !== "function") {
        return false;
      }
      return await currentWindow.isFullscreen();
    } catch {
      return false;
    }
  };

  const writeFullscreen = async (fullscreen: boolean): Promise<void> => {
    try {
      const currentWindow = getWindow();
      if (typeof currentWindow.setFullscreen !== "function") {
        return;
      }
      await currentWindow.setFullscreen(fullscreen);
    } catch {
      // 权限不足或非桌面环境时静默忽略。
    }
  };

  const refreshFullscreenState = async (): Promise<boolean> => {
    lastKnownFullscreen = await readIsFullscreen();
    return lastKnownFullscreen;
  };

  const reassertFullscreenIfNeeded = async (): Promise<void> => {
    if (disposed || now() > escapeGuardUntil) {
      await refreshFullscreenState();
      return;
    }

    const isFullscreen = await readIsFullscreen();
    if (isFullscreen) {
      lastKnownFullscreen = true;
      return;
    }

    await writeFullscreen(true);
    lastKnownFullscreen = await readIsFullscreen();
  };

  const scheduleReassert = (): void => {
    for (const delayMs of reassertDelaysMs) {
      const timeoutId = setTimeoutFn(() => {
        timeoutIds.delete(timeoutId);
        void reassertFullscreenIfNeeded();
      }, delayMs);
      timeoutIds.add(timeoutId);
    }
  };

  const onKeyDown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) {
      return;
    }
    if (event.key !== "Escape" && event.code !== "Escape") {
      return;
    }

    void (async () => {
      const isFullscreen = (await readIsFullscreen()) || lastKnownFullscreen;
      if (!isFullscreen) {
        return;
      }

      lastKnownFullscreen = true;
      escapeGuardUntil = now() + escapeGuardMs;
      scheduleReassert();
    })();
  };

  target.addEventListener("keydown", onKeyDown, true);
  void refreshFullscreenState();

  const currentWindow = getWindow();
  if (typeof currentWindow.onResized === "function") {
    void currentWindow
      .onResized(() => {
        void reassertFullscreenIfNeeded();
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlistenResized = unlisten;
      })
      .catch(() => {
        // 测试 mock 或不支持 onResized 时忽略。
      });
  }

  return () => {
    disposed = true;
    target.removeEventListener("keydown", onKeyDown, true);
    unlistenResized?.();
    clearScheduled();
  };
}
