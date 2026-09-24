import { writeClipboardText } from "./clipboard-commands";

/**
 * 复制文本到系统剪贴板，返回是否成功。
 *
 * 优先走原生侧（见 `clipboard-commands.ts`）；原生不可用时（浏览器里跑 dev
 * server、单测等非 Tauri 环境）回退 WebView Clipboard API，保持既有行为。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await writeClipboardText(text);
    return true;
  } catch {
    // 原生剪贴板不可用或写入失败，继续尝试 WebView 兜底。
  }

  try {
    if (typeof navigator.clipboard?.writeText !== "function") {
      return false;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
