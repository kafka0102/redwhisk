import { useEffect, useRef } from "react";

import type { CodeFileTab } from "./code-workspace-cache";
import { clearCodeEditorReadingPosition } from "./code-workspace-cache";

/**
 * 关闭文件 Tab / LRU 淘汰后清理对应阅读位置。
 *
 * 必须在本轮提交的卸载写回之后清理：编辑器卸载时会先写回一次阅读位置，
 * 若在同一事件里先删缓存，会被这次写回重新写回。
 */
export function useCodeReadingPositionCleanup(
  projectId: number,
  tabs: CodeFileTab[],
): void {
  const openPathsRef = useRef(tabs.map((tab) => tab.filePath));
  useEffect(() => {
    const openPaths = new Set(tabs.map((tab) => tab.filePath));
    for (const filePath of openPathsRef.current) {
      if (!openPaths.has(filePath)) {
        clearCodeEditorReadingPosition(projectId, filePath);
      }
    }
    openPathsRef.current = [...openPaths];
  }, [projectId, tabs]);
}
