import type { Terminal } from "@xterm/xterm";

export interface TerminalSurfaceHandle {
  focus: () => void;
}

export function createTerminalSurfaceHandle(
  getTerminal: () => Terminal | null,
): TerminalSurfaceHandle {
  return {
    focus: () => {
      const terminal = getTerminal();
      if (!terminal) {
        return;
      }
      terminal.scrollToBottom();
      terminal.focus();
    },
  };
}
