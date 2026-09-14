import {
  clearEditorReadingPosition,
  clearEditorReadingPositionsBySession,
  createEditorReadingPositionKey,
} from "../../../shared/workspace/editor-reading-position";

/**
 * 会话文件查看器的阅读位置身份：项目 + session + 文件路径。
 *
 * 同一文件在不同 session 各自记忆位置（存储与时机策略见共享 module）。
 */
export function sessionFileReadingPositionKey(
  projectId: number,
  sessionId: number,
  filePath: string,
): string {
  return createEditorReadingPositionKey({
    projectId,
    sessionId: String(sessionId),
    filePath,
  });
}

/** 关闭会话文件 Tab 时清理该文件的阅读位置。 */
export function clearSessionFileReadingPosition(
  projectId: number,
  sessionId: number,
  filePath: string,
): void {
  clearEditorReadingPosition(
    sessionFileReadingPositionKey(projectId, sessionId, filePath),
  );
}

/** 删除 session / 清理其 workspace 缓存时清掉该 session 全部文件的阅读位置。 */
export function clearSessionFileReadingPositions(sessionId: number): void {
  clearEditorReadingPositionsBySession(String(sessionId));
}
