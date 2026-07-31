/**
 * 把会话日志尾部回放到 xterm。
 *
 * 必须在写入期间抑制 onData→PTY 转发：日志里可能含有远程程序发出的 CSI/OSC 查询
 * （DSR / DA / 颜色查询 / DECRQSS 等）。xterm 处理这些序列时会通过 onData 产出应答；
 * 若把应答当作键盘输入写回 PTY，shell 会回显成乱码，并在每次页面切换 restore 时累积。
 */
import {
  peekTerminalViewState,
  resolveHistoryScrollViewportY,
  saveTerminalViewState,
} from "./terminal-view-state";

export interface WriteTerminalHistoryOptions {
  /**
   * 若给出，历史写完后滚到该行（用于「期间无新输出时保持原滚动位置」）。
   * 未给出时滚到底部。
   */
  restoreViewportY?: number | null;
}

export interface TerminalHistoryTarget {
  reset: () => void;
  write: (data: string, callback?: () => void) => void;
  scrollToBottom: () => void;
  scrollToLine: (line: number) => void;
  buffer: { active: { baseY: number; viewportY: number } };
}

/**
 * 把历史回放文本里的「裸 LF」规范为 CRLF。
 *
 * xterm 在 `convertEol: false`（live PTY 必须保持，避免 `\r\n` 被双重换行）时，
 * 裸 `\n` 只做 index（下移、不回车），归档后的纯文本日志会呈阶梯错位。
 * 已有 CRLF 与单独的 CR（TUI 行内覆盖）保持原样。
 */
export function normalizeTerminalHistoryNewlines(text: string): string {
  return text.replace(/(?<!\r)\n/g, "\r\n");
}

export async function writeTerminalHistory(
  terminal: {
    reset: () => void;
    write: (data: string, callback?: () => void) => void;
    scrollToBottom: () => void;
    scrollToLine: (line: number) => void;
    buffer: { active: { baseY: number } };
  },
  text: string,
  setInputSuppressed: (suppressed: boolean) => void,
  options?: WriteTerminalHistoryOptions,
): Promise<void> {
  setInputSuppressed(true);
  try {
    terminal.reset();
    const payload = normalizeTerminalHistoryNewlines(text);
    await new Promise<void>((resolve) => {
      terminal.write(payload, () => {
        resolve();
      });
    });
    const restoreViewportY = options?.restoreViewportY;
    if (restoreViewportY !== null && restoreViewportY !== undefined) {
      const maxY = terminal.buffer.active.baseY;
      const target = Math.max(0, Math.min(restoreViewportY, maxY));
      terminal.scrollToLine(target);
      return;
    }
    terminal.scrollToBottom();
  } finally {
    setInputSuppressed(false);
  }
}

/**
 * 回放历史并按缓存的 view state 决定滚动：
 * - sequence 未变 → 恢复原 viewport
 * - 首次 / sequence 前进 → 滚到底部
 * 写完后更新缓存。
 */
export async function writeTerminalHistoryPreservingView(
  terminal: TerminalHistoryTarget,
  text: string,
  setInputSuppressed: (suppressed: boolean) => void,
  viewKey: string,
  restoreSequence: number,
): Promise<void> {
  const restoreViewportY = resolveHistoryScrollViewportY(
    peekTerminalViewState(viewKey),
    restoreSequence,
  );
  await writeTerminalHistory(terminal, text, setInputSuppressed, {
    restoreViewportY,
  });
  saveTerminalViewState(viewKey, {
    sequence: restoreSequence,
    viewportY:
      restoreViewportY !== null
        ? restoreViewportY
        : terminal.buffer.active.viewportY,
  });
}

export function persistTerminalViewPosition(
  viewKey: string,
  sequence: number,
  viewportY: number,
): void {
  saveTerminalViewState(viewKey, { sequence, viewportY });
}
