import type { TreeApi } from "react-arborist";

import type { WorkspaceFileTreeNode } from "./workspace-commands";

const fileTreeScrollOffsetCache = new Map<string, number>();

export function readFileTreeScrollOffset(cacheKey: string): number {
  return fileTreeScrollOffsetCache.get(cacheKey) ?? 0;
}

export function writeFileTreeScrollOffset(
  cacheKey: string,
  offset: number,
): void {
  fileTreeScrollOffsetCache.set(cacheKey, offset);
}

export function resetFileTreeScrollOffsetCacheForTests(): void {
  fileTreeScrollOffsetCache.clear();
}

export function restoreFileTreeScrollOffset(
  treeApi: TreeApi<WorkspaceFileTreeNode> | undefined,
  offset: number,
): boolean {
  if (offset <= 0) {
    return true;
  }
  const list = treeApi?.list.current;
  if (list == null) {
    return false;
  }
  list.scrollTo(offset);
  const listEl = treeApi?.listEl.current;
  if (listEl == null) {
    return true;
  }
  return listEl.scrollHeight - listEl.clientHeight >= offset - 1;
}
