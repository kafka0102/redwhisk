/**
 * macOS 会把 Web 层没有消费的 ESC 当成窗口级默认动作：原生全屏窗口因此退出全屏，
 * 表现为「按 ESC 后窗口先缩小到中间、随后又被拉回全屏」的闪烁。
 *
 * 这里在捕获阶段把 ESC 标记为已处理（preventDefault），窗口级默认动作不再触发，
 * 全屏状态与窗口尺寸都不会有任何变化。
 *
 * 只 preventDefault、不 stopPropagation：应用内对话框、文件树行内编辑、终端 TUI
 * 仍需按各自逻辑响应 ESC。
 */

export interface BlockEscapeDefaultActionOptions {
  target?: EventTarget;
}

export function installBlockEscapeDefaultAction(
  options: BlockEscapeDefaultActionOptions = {},
): () => void {
  const target = options.target ?? window;

  const onKeyDown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || event.type !== "keydown") {
      return;
    }
    if (event.key !== "Escape" && event.code !== "Escape") {
      return;
    }
    // 输入法组合过程中的 ESC 用于取消组合，交给输入法处理。
    if (event.isComposing) {
      return;
    }
    event.preventDefault();
  };

  target.addEventListener("keydown", onKeyDown, true);
  return () => {
    target.removeEventListener("keydown", onKeyDown, true);
  };
}
