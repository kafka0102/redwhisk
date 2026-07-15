/**
 * 修复 xterm 在中文等 IME 下把 helper textarea 残留误判为退格的问题。
 *
 * 根因（@xterm/xterm CompositionHelper，仓库已 pnpm patch）：
 * 1. composition 提交后 textarea.value 仍保留已发送文本
 * 2. keyCode=229 路径比较 old/new，变短时旧逻辑会写出 \x7f
 * 3. 部分 IME 会先对残留发 Backspace 再提交标点
 *
 * 本 guard 作为运行时兜底：
 * - host 捕获阶段预清残留、吞掉清残留用 Backspace
 * - IME 按键窗口内丢弃 DEL/BS
 * - 无真实用户 Backspace 标记时丢弃 DEL/BS
 */
const DEL = "\x7f";
const BACKSPACE = "\b";

export interface TerminalImeInputGuard {
  dispose: () => void;
  /** 过滤 onData；返回 null 表示整段丢弃 */
  filterData: (data: string) => string | null;
}

export function installTerminalImeInputGuard(
  host: HTMLElement,
  textarea: HTMLTextAreaElement,
): TerminalImeInputGuard {
  let isComposing = false;
  let isFinalizingComposition = false;
  let allowDeleteChars = 0;
  let imeDeleteSuppressDepth = 0;
  let finalizeTimer: number | null = null;
  let imeSuppressTimer: number | null = null;

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
    // 覆盖 xterm CompositionHelper 的 setTimeout(0) 与紧随其后的 IME Backspace
    imeSuppressTimer = window.setTimeout(() => {
      imeSuppressTimer = null;
      imeDeleteSuppressDepth = 0;
    }, 50);
  };

  const handleCompositionStart = (): void => {
    isComposing = true;
    isFinalizingComposition = false;
    beginImeDeleteSuppress();
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
      if (!isComposing && !isFinalizingComposition) {
        clearResidual();
      }
    }

    if (isBackspace) {
      // IME 清残留 / 组合态退格：不交给 shell
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

  textarea.addEventListener("compositionstart", handleCompositionStart);
  textarea.addEventListener("compositionend", handleCompositionEnd);
  host.addEventListener("keydown", handleHostKeyDownCapture, true);

  return {
    filterData(data: string): string | null {
      if (data.length === 0) {
        return null;
      }

      const containsDelete = data.includes(DEL) || data.includes(BACKSPACE);
      if (!containsDelete) {
        return data;
      }

      if (imeDeleteSuppressDepth > 0) {
        const stripped = data.split(DEL).join("").split(BACKSPACE).join("");
        return stripped.length > 0 ? stripped : null;
      }

      if (data === DEL || data === BACKSPACE) {
        if (allowDeleteChars > 0) {
          allowDeleteChars -= 1;
          return data;
        }
        return null;
      }

      // 混合数据：无 allow 时剥掉退格控制符
      if (allowDeleteChars > 0) {
        allowDeleteChars -= 1;
        return data;
      }
      const stripped = data.split(DEL).join("").split(BACKSPACE).join("");
      return stripped.length > 0 ? stripped : null;
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
      textarea.removeEventListener("compositionstart", handleCompositionStart);
      textarea.removeEventListener("compositionend", handleCompositionEnd);
      host.removeEventListener("keydown", handleHostKeyDownCapture, true);
    },
  };
}
