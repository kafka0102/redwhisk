import { openPath } from "@tauri-apps/plugin-opener";

/** 拼出工作区根目录下文件的绝对路径。 */
export function joinWorkspaceFilePath(
  workspacePath: string,
  relativePath: string,
): string {
  const root = workspacePath.replace(/[\\/]+$/, "");
  const relative = relativePath.replace(/^[\\/]+/, "");
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root}${separator}${relative}`;
}

/**
 * 用系统默认应用打开工作区里的 HTML 文件（通常是默认浏览器）。
 * @returns 是否成功发起打开
 */
export async function openHtmlInBrowser(
  workspacePath: string,
  relativePath: string,
): Promise<boolean> {
  if (!workspacePath || !relativePath) {
    return false;
  }
  try {
    await openPath(joinWorkspaceFilePath(workspacePath, relativePath));
    return true;
  } catch {
    return false;
  }
}
