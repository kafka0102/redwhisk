import { getCurrentWebview } from "@tauri-apps/api/webview";

import { formatDroppedPaths, isPositionInRect } from "./terminal-drop";

export interface TerminalDragDropHandlers {
  /** 终端宿主元素，用于判定 drop 落点是否命中。 */
  host: HTMLElement;
  /** 终端 effect 是否已清理（避免清理后仍写入）。 */
  isDisposed: () => boolean;
  /** 是否处于 restore 回放等需抑制 PTY 写入的阶段。 */
  shouldSuppressInput: () => boolean;
  /** 落点命中且路径非空时，用格式化后的路径文本回调（通常写入 inputWriter）。 */
  onDropText: (text: string) => void;
}

/**
 * 监听 Tauri webview 拖拽事件，drop 落点命中终端宿主时，把文件路径格式化为文本回调。
 *
 * Tauri 默认拦截 HTML5 drop（`dragDropEnabled:true`），故 xterm 容器收不到浏览器
 * drop 事件；只能经原生 `onDragDropEvent` 拿到文件路径。落点判定把 webview 级事件
 * 收窄到「当前终端面板」，避免拖到非终端区域也误写入。对齐 iTerm2 / Warp 拖入文件
 * 「插入路径」的行为，使 Codex / Claude Code 的输入框能接收拖入文件。
 *
 * @returns dispose 函数：取消监听；若监听尚未注册完成，则标记后在其 resolve 时立即注销。
 */
export function attachTerminalDragDrop(
  handlers: TerminalDragDropHandlers,
): () => void {
  const { host, isDisposed, shouldSuppressInput, onDropText } = handlers;
  let unlisten: (() => void) | null = null;
  let disposed = false;

  try {
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (isDisposed()) {
          return;
        }
        const payload = event.payload;
        if (payload.type !== "drop") {
          return;
        }
        if (shouldSuppressInput()) {
          return;
        }
        if (payload.paths.length === 0) {
          return;
        }
        const rect = host.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          return;
        }
        if (
          !isPositionInRect(
            payload.position.x,
            payload.position.y,
            rect,
            window.devicePixelRatio || 1,
          )
        ) {
          return;
        }
        const text = formatDroppedPaths(payload.paths);
        if (text) {
          onDropText(text);
        }
      })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
      });
  } catch {
    // 非 Tauri 环境（测试 / web 预览）无 webview 拖拽 API：静默降级，
    // 终端其余功能不受影响。
  }

  return () => {
    disposed = true;
    unlisten?.();
  };
}
