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
    },
    onPendingDropped: () => {
      deps.showStatusMessage(
        "restore",
        "Terminal restore is taking longer than expected. Older live output was dropped while waiting for restore.",
      );
    },
  };
}
