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
    onRestoreIncomplete: () => {
      deps.showStatusMessage(
        "restore",
        "Terminal restore snapshot is incomplete. Showing log tail; live output continues below.",
      );
    },
    onRestoreError: (error) => {
      deps.showStatusMessage("restore", getCommandErrorMessage(error, deps.t));
    },
    onInactive: () => {
      deps.clearStatusMessage("inactive");
    },
    onLiveReady: () => {
      if (deps.getStatusSource() === "restore") {
        deps.clearStatusMessage("restore");
      }
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
