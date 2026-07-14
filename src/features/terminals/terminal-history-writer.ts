/**
 * 把会话日志尾部回放到 xterm。
 *
 * 必须在写入期间抑制 onData→PTY 转发：日志里可能含有远程程序发出的 CSI/OSC 查询
 * （DSR / DA / 颜色查询 / DECRQSS 等）。xterm 处理这些序列时会通过 onData 产出应答；
 * 若把应答当作键盘输入写回 PTY，shell 会回显成乱码，并在每次页面切换 restore 时累积。
 */
export async function writeTerminalHistory(
  terminal: {
    reset: () => void;
    write: (data: string, callback?: () => void) => void;
    scrollToBottom: () => void;
  },
  text: string,
  setInputSuppressed: (suppressed: boolean) => void,
): Promise<void> {
  setInputSuppressed(true);
  try {
    terminal.reset();
    await new Promise<void>((resolve) => {
      terminal.write(text, () => {
        resolve();
      });
    });
    terminal.scrollToBottom();
  } finally {
    setInputSuppressed(false);
  }
}
