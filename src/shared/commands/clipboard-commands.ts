import { writeText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * 写入系统剪贴板（原生侧，走 clipboard-manager 插件）。
 *
 * 不直接用 WebView 的 `navigator.clipboard.writeText`：WKWebView 对该 API 有
 * transient activation / 焦点要求，窗口状态不满足时直接 reject，调用方无法与
 * 真实失败区分。原生写入不经过 WebView 这层权限门。
 */
export async function writeClipboardText(text: string): Promise<void> {
  await writeText(text);
}
