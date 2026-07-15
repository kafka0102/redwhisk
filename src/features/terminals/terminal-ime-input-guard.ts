/**
 * 修复 xterm 在中文等 IME 下把 helper textarea 残留误判为退格的问题。
 *
 * 根因（@xterm/xterm CompositionHelper）：
 * 1. composition 提交后 textarea.value 仍保留已发送文本
 * 2. keyCode=229 路径比较 old/new，变短则写出 \x7f
 * 3. 部分 IME 会先对残留逐字发 Backspace 再提交标点（同样变成 shell 退格）
 *
 * 策略：
 * - host 捕获阶段在 xterm 之前处理：清残留、吞掉「清残留用」的 Backspace
 * - 丢弃无真实用户 Backspace 标记的 \x7f / \b
 * - composition 终态发送完成后再清残留，避免截断 xterm 自己的 setTimeout(0) 读取
 */
const DEL = "\x7f";
const BACKSPACE = "\b";

export interface TerminalImeInputGuard {
  dispose: () => void;
  /** 是否应把 onData 字节写往 PTY；误发的 DEL 返回 false */
  shouldForwardData: (data: string) => boolean;
}

export function installTerminalImeInputGuard(
  host: HTMLElement,
  textarea: HTMLTextAreaElement,
): TerminalImeInputGuard {
  let isComposing = false;
  let isFinalizingComposition = false;
  let allowDeleteChars = 0;
  let finalizeTimer: number | null = null;

  const clearResidual = (): void => {
    if (textarea.value.length === 0) {
      return;
    }
    textarea.value = "";
  };

  const handleCompositionStart = (): void => {
    isComposing = true;
    isFinalizingComposition = false;
    if (finalizeTimer !== null) {
      window.clearTimeout(finalizeTimer);
      finalizeTimer = null;
    }
  };

  const handleCompositionEnd = (): void => {
    isComposing = false;
    // xterm 在 compositionend 里 setTimeout(0) 读取 textarea；此期间禁止清空。
    isFinalizingComposition = true;
    if (finalizeTimer !== null) {
      window.clearTimeout(finalizeTimer);
    }
    finalizeTimer = window.setTimeout(() => {
      finalizeTimer = null;
      isFinalizingComposition = false;
      if (!isComposing) {
        clearResidual();
      }
    }, 0);
  };

  /**
   * 捕获阶段挂在 host 上：先于 xterm 绑在 textarea 上的 capture keydown。
   */
  const handleHostKeyDownCapture = (event: KeyboardEvent): void => {
    if (event.target !== textarea) {
      return;
    }

    const isBackspace = event.key === "Backspace" || event.keyCode === 8;
    if (isBackspace) {
      // 非 composing 时 textarea 里还有字符，几乎一定是 IME/浏览器在改 helper
      // 残留，而不是用户在删 shell 里的字符（正常英文输入时 textarea 应为空）。
      if (!isComposing && textarea.value.length > 0) {
        clearResidual();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      allowDeleteChars += 1;
      return;
    }

    // IME 处理中的按键（含中文标点）：在 xterm 采样 oldValue 前清掉残留
    if (event.keyCode === 229 && !isComposing && !isFinalizingComposition) {
      clearResidual();
    }
  };

  textarea.addEventListener("compositionstart", handleCompositionStart);
  textarea.addEventListener("compositionend", handleCompositionEnd);
  host.addEventListener("keydown", handleHostKeyDownCapture, true);

  return {
    shouldForwardData(data: string): boolean {
      if (data !== DEL && data !== BACKSPACE) {
        return true;
      }
      if (allowDeleteChars > 0) {
        allowDeleteChars -= 1;
        return true;
      }
      return false;
    },
    dispose(): void {
      if (finalizeTimer !== null) {
        window.clearTimeout(finalizeTimer);
        finalizeTimer = null;
      }
      textarea.removeEventListener("compositionstart", handleCompositionStart);
      textarea.removeEventListener("compositionend", handleCompositionEnd);
      host.removeEventListener("keydown", handleHostKeyDownCapture, true);
    },
  };
}
