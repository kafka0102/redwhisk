import type { TFunction } from "i18next";
import type { Terminal } from "@xterm/xterm";

import { writeTerminalHistoryPreservingView } from "./terminal-history-writer";
import {
  createInPlaceTuiCupTracker,
  resolveInPlaceTuiScrollHintAction,
} from "./terminal-inplace-tui-hint";
import type { TerminalLivePipelineCallbacks } from "./terminal-live-pipeline";
import { getCommandErrorMessage } from "../../shared/commands/command-error";

type StatusSource =
  | "boot"
  | "input"
  | "inactive"
  | "inplace"
  | "output"
  | "poll"
  | "resize"
  | "restore";

export interface TerminalSurfaceLiveHandlerDeps {
  clearStatusMessage: (source?: StatusSource) => void;
  getIsDisposed: () => boolean;
  getStatusSource: () => StatusSource | null;
  inPlaceHintMessage: string;
  setInputSuppressed: (suppressed: boolean) => void;
  showStatusMessage: (source: StatusSource, message: string) => void;
  t: TFunction;
  terminal: Terminal;
  transportKey: string | number;
}

export function createTerminalSurfaceLiveHandlers(
  deps: TerminalSurfaceLiveHandlerDeps,
): TerminalLivePipelineCallbacks {
  const cupTracker = createInPlaceTuiCupTracker();

  const refreshInPlaceScrollHint = (): void => {
    if (deps.getIsDisposed()) {
      return;
    }
    const action = resolveInPlaceTuiScrollHintAction(
      deps.getStatusSource(),
      deps.terminal.buffer.active.baseY,
      cupTracker.getScore(),
    );
    if (action.type === "show") {
      deps.showStatusMessage("inplace", deps.inPlaceHintMessage);
      return;
    }
    if (action.type === "clear") {
      deps.clearStatusMessage(action.source);
    }
  };

  return {
    writeBytes: (bytes) => {
      try {
        cupTracker.observe(bytes);
        deps.terminal.write(bytes, () => {
          refreshInPlaceScrollHint();
        });
      } catch (error) {
        deps.showStatusMessage("output", getCommandErrorMessage(error, deps.t));
      }
    },
    writeHistory: async (text, meta) => {
      cupTracker.observe(new TextEncoder().encode(text));
      await writeTerminalHistoryPreservingView(
        deps.terminal,
        text,
        deps.setInputSuppressed,
        String(deps.transportKey),
        meta.restoreSequence,
      );
      refreshInPlaceScrollHint();
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
      refreshInPlaceScrollHint();
    },
    onPendingDropped: () => {
      deps.showStatusMessage(
        "restore",
        "Terminal restore is taking longer than expected. Older live output was dropped while waiting for restore.",
      );
    },
  };
}
