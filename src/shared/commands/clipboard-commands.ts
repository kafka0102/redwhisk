import { invokeCommand } from "./command-client";

/**
 * 写入系统剪贴板（原生侧）。
 *
 * 不直接用 WebView 的 `navigator.clipboard.writeText`：WKWebView 对该 API 有
 * transient activation / 焦点要求，窗口状态不满足时直接 reject。
 * 也不走 clipboard-manager 插件的 `writeText`：那个 async command 在 tokio
 * worker 上调 NSPasteboard，macOS 会在剪贴板 owner 变更里崩。
 * `write_clipboard_text` 在 macOS 上切回主线程再写。
 */
export async function writeClipboardText(text: string): Promise<void> {
  await invokeCommand<void>("write_clipboard_text", { text });
}
