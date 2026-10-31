/**
 * Markdown 阅读模式与预览滚动位置。
 *
 * 身份沿用 Monaco 阅读位置的 key（代码页 = 项目 + 文件；会话查看器 = 项目 +
 * session + 文件）。状态只存在应用运行期内存中：组件因切 Activity / 窗口切走
 * 再回来而卸载重挂载后仍能恢复，但关闭文件 Tab 或应用重启后从头开始。
 */
export type MarkdownPreviewMode = "source" | "preview";

const previewModes = new Map<string, MarkdownPreviewMode>();
const previewScrollOffsets = new Map<string, number>();

export function readMarkdownPreviewMode(
  readingKey: string | null,
): MarkdownPreviewMode {
  if (readingKey == null) {
    return "source";
  }
  return previewModes.get(readingKey) ?? "source";
}

export function writeMarkdownPreviewMode(
  readingKey: string | null,
  mode: MarkdownPreviewMode,
): void {
  if (readingKey == null) {
    return;
  }
  previewModes.set(readingKey, mode);
}

export function readMarkdownPreviewScrollOffset(
  readingKey: string,
): number | null {
  return previewScrollOffsets.get(readingKey) ?? null;
}

export function writeMarkdownPreviewScrollOffset(
  readingKey: string,
  offset: number,
): void {
  previewScrollOffsets.set(readingKey, Math.max(0, offset));
}

export function clearMarkdownPreviewState(readingKey: string): void {
  previewModes.delete(readingKey);
  previewScrollOffsets.delete(readingKey);
}

export function clearMarkdownPreviewStatesByProject(projectId: number): void {
  const prefix = `project:${projectId}\u0000`;
  for (const readingKey of [...previewModes.keys()]) {
    if (readingKey.startsWith(prefix)) {
      previewModes.delete(readingKey);
      previewScrollOffsets.delete(readingKey);
    }
  }
  for (const readingKey of [...previewScrollOffsets.keys()]) {
    if (readingKey.startsWith(prefix)) {
      previewScrollOffsets.delete(readingKey);
    }
  }
}

export function clearMarkdownPreviewStatesBySession(sessionId: string): void {
  const scope = `session:${sessionId}`;
  for (const readingKey of [...previewModes.keys()]) {
    if (readingKey.split("\u0000")[1] === scope) {
      previewModes.delete(readingKey);
      previewScrollOffsets.delete(readingKey);
    }
  }
  for (const readingKey of [...previewScrollOffsets.keys()]) {
    if (readingKey.split("\u0000")[1] === scope) {
      previewScrollOffsets.delete(readingKey);
    }
  }
}

export function resetMarkdownPreviewStateForTests(): void {
  previewModes.clear();
  previewScrollOffsets.clear();
}
