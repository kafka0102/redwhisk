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

function refreshTerminalViewport(terminal: Terminal): void {
  // WebGL 在 bulk write / display:none→显示 后可能不主动重绘；
  // 空闲 shell 无后续 live 帧时会出现“空白，按回车才看见”的假象。
  const bottom = Math.max(0, terminal.rows - 1);
  terminal.refresh(0, bottom);
}

export function createTerminalSurfaceLiveHandlers(
  deps: TerminalSurfaceLiveHandlerDeps,
): TerminalLivePipelineCallbacks {
  return {
    writeBytes: (bytes) => {
      try {
        deps.terminal.write(bytes);
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
      refreshTerminalViewport(deps.terminal);
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
      refreshTerminalViewport(deps.terminal);
    },
    onPendingDropped: () => {
      deps.showStatusMessage(
        "restore",
        "Terminal restore is taking longer than expected. Older live output was dropped while waiting for restore.",
      );
    },
  };
}
