/**
 * mouse reporting 开启时，xterm 会把滚轮交给应用，本地 scrollback 被吞掉。
 * Shift+滚轮改为滚动 xterm buffer（对齐常见终端），不引入可配置项。
 */

const DEFAULT_LINES_PER_NOTCH = 3;

export interface TerminalShiftWheelScrollTarget {
  scrollLines: (amount: number) => void;
  buffer: { active: { baseY: number } };
}

/**
 * @returns 需滚动的 `scrollLines` 量；`null` 表示不拦截，交回 xterm/应用。
 */
export function resolveShiftWheelScrollLines(
  deltaY: number,
  shiftKey: boolean,
  baseY: number,
  linesPerNotch: number = DEFAULT_LINES_PER_NOTCH,
): number | null {
  if (!shiftKey || deltaY === 0 || baseY <= 0) {
    return null;
  }
  const direction = deltaY > 0 ? 1 : -1;
  return direction * linesPerNotch;
}

/**
 * 供 `terminal.attachCustomWheelEventHandler`：返回 `false` 表示已处理，xterm 不再转发。
 */
export function createTerminalShiftWheelScrollHandler(
  terminal: TerminalShiftWheelScrollTarget,
  linesPerNotch: number = DEFAULT_LINES_PER_NOTCH,
): (event: WheelEvent) => boolean {
  return (event: WheelEvent): boolean => {
    const amount = resolveShiftWheelScrollLines(
      event.deltaY,
      event.shiftKey,
      terminal.buffer.active.baseY,
      linesPerNotch,
    );
    if (amount === null) {
      return true;
    }
    terminal.scrollLines(amount);
    event.preventDefault();
    return false;
  };
}
