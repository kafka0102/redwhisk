import type { Terminal } from "@xterm/xterm";

/**
 * xterm FitAddon 只能放下整数行：可用高度对 cell 高度取模后会在宿主底部
 * 留下 0..(cellHeight-1)px 空白。该空白紧贴状态栏时，会表现为「终端内容与
 * 常用命令栏」之间随窗口高度变化的缝隙。
 *
 * 返回应压缩掉的底部余量；调用方把 terminal 高度设为 available - inset，
 * 再由宿主 flex 底对齐，把余量留在顶部。
 */
export function computeTerminalBottomInset(
  availableHeight: number,
  cellHeight: number,
): number {
  if (
    !Number.isFinite(availableHeight) ||
    !Number.isFinite(cellHeight) ||
    availableHeight <= 0 ||
    cellHeight <= 0
  ) {
    return 0;
  }

  const rows = Math.max(1, Math.floor(availableHeight / cellHeight));
  return Math.max(0, availableHeight - rows * cellHeight);
}

interface TerminalCoreRenderDimensions {
  _core?: {
    _renderService?: {
      dimensions?: {
        css?: {
          cell?: {
            height?: number;
          };
        };
      };
    };
  };
}

export function readTerminalCellHeight(terminal: Terminal): number | null {
  const height = (terminal as unknown as TerminalCoreRenderDimensions)._core
    ?._renderService?.dimensions?.css?.cell?.height;
  if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) {
    return null;
  }

  return height;
}

/**
 * fit 之后调用：把 .xterm 高度收成整数行像素。宿主需 `justify-content: flex-end`
 * 才能把余量留在顶部、内容贴齐底部状态栏。
 */
export function applyTerminalBottomInset(
  terminal: Terminal,
  host: HTMLElement,
): number {
  const element = terminal.element;
  if (!element) {
    return 0;
  }

  const cellHeight = readTerminalCellHeight(terminal);
  if (cellHeight == null) {
    element.style.height = "";
    return 0;
  }

  const availableHeight = host.clientHeight;
  const inset = computeTerminalBottomInset(availableHeight, cellHeight);
  const contentHeight = Math.max(0, availableHeight - inset);
  element.style.height = contentHeight > 0 ? `${contentHeight}px` : "";
  return inset;
}

export function clearTerminalBottomInset(terminal: Terminal): void {
  if (terminal.element) {
    terminal.element.style.height = "";
  }
}
