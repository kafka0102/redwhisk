import { useEffect, useRef } from "react";

import { clearSessionFileReadingPosition } from "./session-file-reading-position";

interface ReadingPositionScope {
  projectId: number;
  sessionId: number;
  filePath: string | null;
}

/**
 * 关闭（或替换）会话文件 Tab 后清理对应阅读位置。
 *
 * 必须在本轮提交的卸载写回之后清理：文件查看器卸载时会先写回一次阅读位置，
 * 若在同一事件里先删缓存，会被这次写回重新写回。
 */
export function useSessionFileReadingPositionCleanup(
  projectId: number,
  sessionId: number,
  filePath: string | null,
): void {
  const previousRef = useRef<ReadingPositionScope>({
    projectId,
    sessionId,
    filePath,
  });

  useEffect(() => {
    const previous = previousRef.current;
    // 换项目 / 换 session 时两侧路径不可比，交由各自的清理入口处理，避免误删。
    const isSameScope =
      previous.projectId === projectId && previous.sessionId === sessionId;
    if (
      isSameScope &&
      previous.filePath != null &&
      previous.filePath !== filePath
    ) {
      clearSessionFileReadingPosition(projectId, sessionId, previous.filePath);
    }
    previousRef.current = { projectId, sessionId, filePath };
  }, [filePath, projectId, sessionId]);
}
