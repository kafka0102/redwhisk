/**
 * 清理 xterm helper textarea 在 IME 提交后的残留文本。
 *
 * xterm 默认只在 blur/paste 时清空 textarea，中文等 IME 经 composition 提交后字符会留在
 * textarea.value。后续在 IME 激活态输入标点（常见 keyCode=229）时，CompositionHelper
 * 会把「残留变短」误判为退格并写出 \x7f，表现为光标回退、全角标点无法输入。
 *
 * 在 composition 结束后（以及非 composing 的 input 后）延迟清空，且必须晚于 xterm 自身
 * compositionend 的 setTimeout(0) 终态发送，避免截断正在提交的组合文本。
 */
export function installTerminalImeTextareaCleanup(
  textarea: HTMLTextAreaElement,
): () => void {
  let isComposing = false;
  let clearTimer: number | null = null;

  const cancelScheduledClear = (): void => {
    if (clearTimer === null) {
      return;
    }
    window.clearTimeout(clearTimer);
    clearTimer = null;
  };

  const scheduleClear = (): void => {
    cancelScheduledClear();
    clearTimer = window.setTimeout(() => {
      clearTimer = null;
      if (isComposing || textarea.value.length === 0) {
        return;
      }
      textarea.value = "";
    }, 0);
  };

  const handleCompositionStart = (): void => {
    isComposing = true;
    cancelScheduledClear();
  };

  const handleCompositionEnd = (): void => {
    isComposing = false;
    scheduleClear();
  };

  const handleInput = (): void => {
    if (isComposing) {
      return;
    }
    scheduleClear();
  };

  textarea.addEventListener("compositionstart", handleCompositionStart);
  textarea.addEventListener("compositionend", handleCompositionEnd);
  textarea.addEventListener("input", handleInput);

  return () => {
    cancelScheduledClear();
    textarea.removeEventListener("compositionstart", handleCompositionStart);
    textarea.removeEventListener("compositionend", handleCompositionEnd);
    textarea.removeEventListener("input", handleInput);
  };
}
