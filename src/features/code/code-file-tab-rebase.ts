import type { CodeFileTab } from "./code-workspace-cache";
import { rebaseRelativePath } from "../../shared/workspace/file-tree-path-rebase";

/** 移动或重命名成功后，把打开的标签改挂到新路径，保留未保存内容。 */
export function rebaseCodeFileTabs(
  tabs: readonly CodeFileTab[],
  from: string,
  to: string,
): CodeFileTab[] {
  return tabs.map((tab) => {
    const filePath = rebaseRelativePath(tab.filePath, from, to);
    if (filePath === tab.filePath) {
      return tab;
    }
    const separator = filePath.lastIndexOf("/");
    const fileName =
      separator === -1 ? filePath : filePath.slice(separator + 1);
    return { ...tab, fileName, filePath };
  });
}

export function rebasePathSet(
  paths: ReadonlySet<string>,
  from: string,
  to: string,
): Set<string> {
  const next = new Set<string>();
  for (const path of paths) {
    next.add(rebaseRelativePath(path, from, to));
  }
  return next;
}
