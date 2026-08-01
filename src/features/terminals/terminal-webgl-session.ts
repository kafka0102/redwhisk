import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";

import { healTerminalViewport } from "./terminal-surface-live-handlers";

const MAX_WEBGL_RECOVER_ATTEMPTS = 3;
const WEBGL_RECOVER_DELAY_MS = 250;

export interface TerminalWebglSession {
  dispose: () => void;
  getAddon: () => WebglAddon | null;
  /** 仅可见终端挂载 WebGL；隐藏时卸下，避免多实例共享字形 atlas 串扰。 */
  setActive: (active: boolean) => void;
  /** 强制 dispose + 重建（休眠恢复 / 疑似纹理损坏）。 */
  recreate: () => void;
  isActive: () => boolean;
}

/**
 * 管理终端 WebGL 渲染生命周期。
 *
 * 关键约束：
 * - `@xterm/addon-webgl` 的 CharAtlasCache 会按字体/主题/DPR **跨 Terminal 共享**
 *   同一份 texture atlas。隐藏 tab 若仍挂着 WebGL，任一实例清 atlas 或 GPU
 *   纹理损坏会让同配置的所有终端一起花屏（「一个乱、全家乱」）。
 * - dispose addon 后 xterm 回退默认 canvas renderer，不参与共享 atlas。
 * - 因此默认不挂载；仅 `setActive(true)` 时挂载，隐藏时卸下。
 */
export function createTerminalWebglSession(
  terminal: Terminal,
  options: {
    isCurrent: () => boolean;
    initiallyActive?: boolean;
  },
): TerminalWebglSession {
  let addon: WebglAddon | null = null;
  let recoverTimer: number | null = null;
  let recoverAttempts = 0;
  let disposed = false;
  let wantActive = false;

  const clearRecoverTimer = (): void => {
    if (recoverTimer !== null) {
      window.clearTimeout(recoverTimer);
      recoverTimer = null;
    }
  };

  const detach = (): void => {
    clearRecoverTimer();
    addon?.dispose();
    addon = null;
  };

  const attach = (): WebglAddon | null => {
    try {
      const next = new WebglAddon();
      next.onContextLoss(() => {
        next.dispose();
        if (addon === next) {
          addon = null;
        }
        if (
          disposed ||
          !wantActive ||
          recoverAttempts >= MAX_WEBGL_RECOVER_ATTEMPTS ||
          recoverTimer !== null
        ) {
          return;
        }
        recoverAttempts += 1;
        recoverTimer = window.setTimeout(() => {
          recoverTimer = null;
          if (disposed || !wantActive || !options.isCurrent()) {
            return;
          }
          addon = attach();
          if (addon) {
            healTerminalViewport(terminal);
          }
        }, WEBGL_RECOVER_DELAY_MS);
      });
      terminal.loadAddon(next);
      return next;
    } catch {
      return null;
    }
  };

  const setActive = (active: boolean): void => {
    if (disposed) {
      return;
    }
    wantActive = active;
    if (!active) {
      detach();
      return;
    }
    if (addon !== null || !options.isCurrent()) {
      return;
    }
    recoverAttempts = 0;
    addon = attach();
    if (addon) {
      healTerminalViewport(terminal);
    }
  };

  const recreate = (): void => {
    if (disposed || !wantActive || !options.isCurrent()) {
      return;
    }
    detach();
    recoverAttempts = 0;
    addon = attach();
    if (addon) {
      healTerminalViewport(terminal);
    }
  };

  if (options.initiallyActive) {
    setActive(true);
  }

  return {
    getAddon: () => addon,
    isActive: () => wantActive && addon !== null,
    setActive,
    recreate,
    dispose: () => {
      disposed = true;
      wantActive = false;
      detach();
    },
  };
}
