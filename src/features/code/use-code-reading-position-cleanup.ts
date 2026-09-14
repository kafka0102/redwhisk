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
  const previousRef = useRef({
    projectId,
    openPaths: tabs.map((tab) => tab.filePath),
  });
  useEffect(() => {
    const previous = previousRef.current;
    const openPaths = new Set(tabs.map((tab) => tab.filePath));
    // 换项目时两侧路径集合不可比，交给项目级清理，避免误删新项目同名文件的阅读位置。
    if (previous.projectId === projectId) {
      for (const filePath of previous.openPaths) {
        if (!openPaths.has(filePath)) {
          clearCodeEditorReadingPosition(projectId, filePath);
        }
      }
    }
    previousRef.current = { projectId, openPaths: [...openPaths] };
  }, [projectId, tabs]);
}
