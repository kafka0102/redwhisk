import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";

import { healTerminalViewport } from "./terminal-surface-live-handlers";

const MAX_WEBGL_RECOVER_ATTEMPTS = 3;
const WEBGL_RECOVER_DELAY_MS = 250;

export interface TerminalWebglSession {
  dispose: () => void;
  getAddon: () => WebglAddon | null;
}

/**
 * 挂载 WebGL 渲染并在 context loss 后有限次重建。
 * dispose addon 时 xterm 会回退到默认 canvas renderer。
 */
export function createTerminalWebglSession(
  terminal: Terminal,
  options: {
    isCurrent: () => boolean;
  },
): TerminalWebglSession {
  let addon: WebglAddon | null = null;
  let recoverTimer: number | null = null;
  let recoverAttempts = 0;
  let disposed = false;

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
          recoverAttempts >= MAX_WEBGL_RECOVER_ATTEMPTS ||
          recoverTimer !== null
        ) {
          return;
        }
        recoverAttempts += 1;
        recoverTimer = window.setTimeout(() => {
          recoverTimer = null;
          if (disposed || !options.isCurrent()) {
            return;
          }
          addon = attach();
          healTerminalViewport(terminal);
        }, WEBGL_RECOVER_DELAY_MS);
      });
      terminal.loadAddon(next);
      return next;
    } catch {
      return null;
    }
  };

  addon = attach();

  return {
    getAddon: () => addon,
    dispose: () => {
      disposed = true;
      if (recoverTimer !== null) {
        window.clearTimeout(recoverTimer);
        recoverTimer = null;
      }
      addon?.dispose();
      addon = null;
    },
  };
}
