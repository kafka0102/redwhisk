import type { TFunction } from "i18next";
import type { Terminal } from "@xterm/xterm";

import { writeTerminalHistoryPreservingView } from "./terminal-history-writer";
import type { TerminalLivePipelineCallbacks } from "./terminal-live-pipeline";
import { getCommandErrorMessage } from "../../shared/commands/command-error";

type StatusSource =
  | "boot"
  | "input"
  | "inactive"
  | "output"
  | "poll"
  | "resize"
  | "restore";

export interface TerminalSurfaceLiveHandlerDeps {
  clearStatusMessage: (source?: StatusSource) => void;
  setInputSuppressed: (suppressed: boolean) => void;
  showStatusMessage: (source: StatusSource, message: string) => void;
  t: TFunction;
  terminal: Terminal;
  transportKey: string | number;
}

/** 长会话 TUI 高频重绘后，周期性重建 WebGL 字形图集，避免纹理损坏导致「看起来乱码、复制却正常」。 */
export const TERMINAL_WEBGL_ATLAS_HEAL_EVERY_BYTES = 512 * 1024;

/**
 * 强制终端可见区域按当前 buffer 重绘。
 * WebGL 在 bulk write / display:none→显示 / 系统休眠恢复 后可能保留损坏的字形纹理；
 * clearTextureAtlas 是 xterm 官方针对纹理损坏的恢复手段，再配合 refresh 拉回画面。
 */
export function healTerminalViewport(terminal: Terminal): void {
  terminal.clearTextureAtlas();
  const bottom = Math.max(0, terminal.rows - 1);
  terminal.refresh(0, bottom);
}

export function createTerminalSurfaceLiveHandlers(
  deps: TerminalSurfaceLiveHandlerDeps,
): TerminalLivePipelineCallbacks {
  let liveBytesSinceHeal = 0;

  return {
    writeBytes: (bytes) => {
      try {
        deps.terminal.write(bytes);
        liveBytesSinceHeal += bytes.byteLength;
        if (liveBytesSinceHeal >= TERMINAL_WEBGL_ATLAS_HEAL_EVERY_BYTES) {
          liveBytesSinceHeal = 0;
          healTerminalViewport(deps.terminal);
        }
      } catch (error) {
        deps.showStatusMessage("output", getCommandErrorMessage(error, deps.t));
      }
    },
    writeHistory: async (text, meta) => {
      await writeTerminalHistoryPreservingView(
        deps.terminal,
        text,
        deps.setInputSuppressed,
        String(deps.transportKey),
        meta.restoreSequence,
      );
      liveBytesSinceHeal = 0;
      healTerminalViewport(deps.terminal);
    },
    onRestoreError: (error) => {
      deps.showStatusMessage("restore", getCommandErrorMessage(error, deps.t));
    },
    onInactive: () => {
      deps.clearStatusMessage("inactive");
    },
    onLiveReady: () => {
      // 不限定 source：切 session 后 ref 可能已被清空，但仍需去掉粘住的 restore 文案。
      deps.clearStatusMessage();
      // 跳过 rewrite 的 re-visible 路径也依赖这里把 WebGL 纹理刷回来。
      liveBytesSinceHeal = 0;
      healTerminalViewport(deps.terminal);
    },
    onPendingDropped: () => {
      deps.showStatusMessage(
        "restore",
        "Terminal restore is taking longer than expected. Older live output was dropped while waiting for restore.",
      );
    },
  };
}
