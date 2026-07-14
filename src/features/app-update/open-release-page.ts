import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * 在系统浏览器中打开 GitHub Release 页。
 * @returns 是否成功发起打开
 */
export async function openReleasePage(url: string): Promise<boolean> {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }

  try {
    await openUrl(trimmed);
    return true;
  } catch {
    return false;
  }
}
