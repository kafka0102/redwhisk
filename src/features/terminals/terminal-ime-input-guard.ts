/**
 * 修复 xterm + 中文 IME 下标点首次按键丢失 / 误退格。
 *
 * 背景：
 * - composition 后 helper textarea 可能残留已提交文本
 * - keyCode=229 路径用 setTimeout 采样 textarea；WKWebView 上 0ms 过早会丢掉第一次标点
 * - 仓库对 @xterm/xterm 做了 patch（变短不再发 DEL，采样改为 10ms）
 *
 * 本 guard：
 * - composition 结束后清残留
 * - IME 窗口内丢弃误发 DEL/BS；吞掉清残留用 Backspace
 * - 对非 composing 的 insertText 做短延迟兜底，避免 xterm 漏发第一次全角标点
 */
const DEL = "\x7f";
const BACKSPACE = "\b";
const IME_DELETE_SUPPRESS_MS = 80;
const INSERT_FALLBACK_DELAY_MS = 16;
const RECENT_FORWARD_WINDOW_MS = 80;

export interface TerminalImeInputGuardOptions {
  /** xterm 漏发 IME insertText 时的兜底写入 */
  sendFallbackData?: (data: string) => void;
}

export interface TerminalImeInputGuard {
  dispose: () => void;
  /** 过滤 onData；返回 null 表示整段丢弃 */
  filterData: (data: string) => string | null;
}

export function installTerminalImeInputGuard(
  host: HTMLElement,
  textarea: HTMLTextAreaElement,
  options: TerminalImeInputGuardOptions = {},
): TerminalImeInputGuard {
  let isComposing = false;
  let isFinalizingComposition = false;
  let allowDeleteChars = 0;
  let imeDeleteSuppressDepth = 0;
  let finalizeTimer: number | null = null;
  let imeSuppressTimer: number | null = null;
  let insertFallbackTimer: number | null = null;
  let pendingInsertFallback: string | null = null;
  let recentForwarded = "";
  let recentForwardedAt = 0;

  const clearResidual = (): void => {
    if (textarea.value.length === 0) {
      return;
    }
    textarea.value = "";
  };

  const beginImeDeleteSuppress = (): void => {
    imeDeleteSuppressDepth += 1;
    allowDeleteChars = 0;
    if (imeSuppressTimer !== null) {
      window.clearTimeout(imeSuppressTimer);
    }
    imeSuppressTimer = window.setTimeout(() => {
      imeSuppressTimer = null;
      imeDeleteSuppressDepth = 0;
    }, IME_DELETE_SUPPRESS_MS);
  };

  const noteForwarded = (data: string): void => {
    if (data.length === 0) {
      return;
    }
    if (data === DEL || data === BACKSPACE) {
      return;
    }
    recentForwarded = data;
    recentForwardedAt = Date.now();
  };

  const wasRecentlyForwarded = (data: string): boolean => {
    if (data.length === 0) {
      return false;
    }
    if (Date.now() - recentForwardedAt > RECENT_FORWARD_WINDOW_MS) {
      return false;
    }
    return recentForwarded.includes(data) || data.includes(recentForwarded);
  };

  const flushInsertFallback = (): void => {
    insertFallbackTimer = null;
    const data = pendingInsertFallback;
    pendingInsertFallback = null;
    if (!data || isComposing) {
      return;
    }
    if (wasRecentlyForwarded(data)) {
      return;
    }
    options.sendFallbackData?.(data);
    noteForwarded(data);
    // 兜底发送后清掉 helper 残留，避免下一次 229 采样被干扰
    if (!isComposing && !isFinalizingComposition) {
      clearResidual();
    }
  };

  const scheduleInsertFallback = (data: string): void => {
    pendingInsertFallback = data;
    if (insertFallbackTimer !== null) {
      window.clearTimeout(insertFallbackTimer);
    }
    insertFallbackTimer = window.setTimeout(
      flushInsertFallback,
      INSERT_FALLBACK_DELAY_MS,
    );
  };

  const handleCompositionStart = (): void => {
    isComposing = true;
    isFinalizingComposition = false;
    beginImeDeleteSuppress();
    pendingInsertFallback = null;
    if (insertFallbackTimer !== null) {
      window.clearTimeout(insertFallbackTimer);
      insertFallbackTimer = null;
    }
    if (finalizeTimer !== null) {
      window.clearTimeout(finalizeTimer);
      finalizeTimer = null;
    }
  };

  const handleCompositionEnd = (): void => {
    isComposing = false;
    beginImeDeleteSuppress();
    isFinalizingComposition = true;
    if (finalizeTimer !== null) {
      window.clearTimeout(finalizeTimer);
    }
    // 晚于 xterm compositionend 的 setTimeout(0) 终态发送
    finalizeTimer = window.setTimeout(() => {
      finalizeTimer = null;
      isFinalizingComposition = false;
      if (!isComposing) {
        clearResidual();
      }
    }, 0);
  };

  const handleHostKeyDownCapture = (event: KeyboardEvent): void => {
    if (event.target !== textarea) {
      return;
    }

    const isBackspace = event.key === "Backspace" || event.keyCode === 8;
    const isImeKey =
      event.keyCode === 229 ||
      event.isComposing ||
      event.key === "Process" ||
      event.key === "Unidentified";

    if (isImeKey) {
      beginImeDeleteSuppress();
      // 注意：不要在 229 上同步 clearResidual。
      // 第一次全角标点时 IME 可能尚未写入，抢清会干扰后续采样；
      // 残留清理交给 compositionend / fallback / Backspace 吞并路径。
    }

    if (isBackspace) {
      if (
        imeDeleteSuppressDepth > 0 ||
        isComposing ||
        event.isComposing ||
        textarea.value.length > 0
      ) {
        clearResidual();
        allowDeleteChars = 0;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      allowDeleteChars += 1;
    }
  };

  const handleTextareaInput = (event: Event): void => {
    if (isComposing || isFinalizingComposition) {
      return;
    }
    const inputEvent = event as InputEvent;
    if (inputEvent.inputType !== "insertText") {
      return;
    }
    const data = inputEvent.data;
    if (!data) {
      return;
    }
    // 非 composing 的 insertText：xterm 在 keyDownSeen && composed 时会忽略 input，
    // 只靠 229 的延时 diff；若 diff 仍漏发，由这里兜底。
    beginImeDeleteSuppress();
    scheduleInsertFallback(data);
  };

  textarea.addEventListener("compositionstart", handleCompositionStart);
  textarea.addEventListener("compositionend", handleCompositionEnd);
  textarea.addEventListener("input", handleTextareaInput);
  host.addEventListener("keydown", handleHostKeyDownCapture, true);

  return {
    filterData(data: string): string | null {
      if (data.length === 0) {
        return null;
      }

      const containsDelete = data.includes(DEL) || data.includes(BACKSPACE);
      if (!containsDelete) {
        noteForwarded(data);
        return data;
      }

      if (imeDeleteSuppressDepth > 0) {
        const stripped = data.split(DEL).join("").split(BACKSPACE).join("");
        if (stripped.length > 0) {
          noteForwarded(stripped);
          return stripped;
        }
        return null;
      }

      if (data === DEL || data === BACKSPACE) {
        if (allowDeleteChars > 0) {
          allowDeleteChars -= 1;
          return data;
        }
        return null;
      }

      if (allowDeleteChars > 0) {
        allowDeleteChars -= 1;
        noteForwarded(data);
        return data;
      }
      const stripped = data.split(DEL).join("").split(BACKSPACE).join("");
      if (stripped.length > 0) {
        noteForwarded(stripped);
        return stripped;
      }
      return null;
    },
    dispose(): void {
      if (finalizeTimer !== null) {
        window.clearTimeout(finalizeTimer);
        finalizeTimer = null;
      }
      if (imeSuppressTimer !== null) {
        window.clearTimeout(imeSuppressTimer);
        imeSuppressTimer = null;
      }
      if (insertFallbackTimer !== null) {
        window.clearTimeout(insertFallbackTimer);
        insertFallbackTimer = null;
      }
      textarea.removeEventListener("compositionstart", handleCompositionStart);
      textarea.removeEventListener("compositionend", handleCompositionEnd);
      textarea.removeEventListener("input", handleTextareaInput);
      host.removeEventListener("keydown", handleHostKeyDownCapture, true);
    },
  };
}
