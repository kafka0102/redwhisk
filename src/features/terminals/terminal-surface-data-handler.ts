import type { Terminal } from "@xterm/xterm";

interface TerminalInputWriter {
  push: (data: string) => void;
}

interface TerminalImeFilter {
  filterData: (data: string) => string | null;
}

/** 把 xterm 按键交给输入写入器。只读回放与 restore 回放期间直接丢掉。 */
export function installTerminalSurfaceDataHandler(input: {
  disableInput: boolean;
  inputWriter: TerminalInputWriter;
  isSuppressed: () => boolean;
  imeInputGuard: TerminalImeFilter | null;
  terminal: Terminal;
}): { dispose: () => void } {
  return input.terminal.onData((data) => {
    if (input.disableInput || input.isSuppressed()) {
      return;
    }
    if (input.imeInputGuard) {
      const filtered = input.imeInputGuard.filterData(data);
      if (filtered === null) {
        return;
      }
      input.inputWriter.push(filtered);
      return;
    }
    input.inputWriter.push(data);
  });
}
