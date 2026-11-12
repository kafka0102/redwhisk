import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import type { TFunction } from "i18next";

import { getCommandErrorMessage } from "../../shared/commands/command-error";
import {
  applyTerminalBottomInset,
  clearTerminalBottomInset,
} from "./terminal-fit-inset";

/** 隐藏或零高度时不 fit，避免 0×0 把 PTY 缩成退化尺寸。 */
export function shouldFitTerminalHost(width: number, height: number): boolean {
  return width > 0 && height > 0;
}

export function syncTerminalSurfaceSize(input: {
  host: HTMLElement;
  terminal: Terminal;
  fitAddon: FitAddon;
  isStillMounted: () => boolean;
  showResizeError: (message: string) => void;
  resize: (rows: number, cols: number) => Promise<void>;
  t: TFunction;
}): void {
  // 宿主被 hidden（切到其他 workspace tab 时 pane 变为 display:none，
  // ResizeObserver 仍会以 0×0 尺寸回调）时跳过重算：否则 FitAddon 会用残留
  // cell 尺寸 + 0 容器算出退化值（cols=2/rows=1），既触发 xterm 重排，又把
  // PTY 缩成 1×2 引发 SIGWINCH 让 shell 重绘，逐次覆盖掉最后一行输出。
  if (!shouldFitTerminalHost(input.host.offsetWidth, input.host.offsetHeight)) {
    return;
  }

  try {
    clearTerminalBottomInset(input.terminal);
    input.fitAddon.fit();
    applyTerminalBottomInset(input.terminal, input.host);
  } catch (error) {
    const message = getCommandErrorMessage(error, input.t);
    window.setTimeout(() => {
      if (!input.isStillMounted()) {
        return;
      }
      input.showResizeError(message);
    }, 0);
    return;
  }

  const dimensions = input.fitAddon.proposeDimensions();
  if (!dimensions) {
    return;
  }

  void input.resize(dimensions.rows, dimensions.cols).catch(() => {
    // Resize failures should not tear down terminal rendering.
  });
}
