import type { editor as MonacoEditor } from "monaco-editor";

/**
 * Monaco 编辑器的阅读位置（滚动位置 + 光标），沿用 Monaco 公开的 view state 契约。
 */
export type EditorReadingPosition = MonacoEditor.ICodeEditorViewState;

/**
 * 编辑器实例的阅读身份：代码页 = 项目 + 文件路径；会话文件查看器 = 项目 + session + 文件路径。
 * 同一文件在不同 session 各自记忆位置，互不串味。
 */
export interface EditorReadingPositionIdentity {
  projectId: number;
  /** 会话工作区文件的 session 身份；代码页为 null。 */
  sessionId?: string | null;
  filePath: string;
}

/**
 * 恢复时机决策：
 * - `restore`：已布局就绪且有缓存位置，执行恢复；
 * - `wait`：仍处于零高度（编辑器容器尚未显示），保持待恢复，等布局就绪后再补做；
 * - `none`：不需要恢复（非待恢复态，或没有缓存位置）。
 *
 * 缓存始终跟随用户滚动更新（用户滚到顶部时缓存也是顶部），所以这里无需比较新旧位置；
 * 只有换文件、磁盘重载、重新挂载、布局塌陷后重新可见才会进入待恢复态。
 */
export type EditorReadingPositionRestoreDecision = "restore" | "wait" | "none";

/** 运行期内存缓存，不落盘；应用重启后从头开始记忆。 */
const readingPositions = new Map<string, EditorReadingPosition>();

function projectScope(projectId: number): string {
  return `project:${projectId}\u0000`;
}

function sessionScope(sessionId: string): string {
  return `session:${sessionId}`;
}

export function createEditorReadingPositionKey(
  identity: EditorReadingPositionIdentity,
): string {
  const session = identity.sessionId
    ? `${sessionScope(identity.sessionId)}\u0000`
    : "";
  return `${projectScope(identity.projectId)}${session}file:${identity.filePath}`;
}

export function readEditorReadingPosition(
  readingKey: string,
): EditorReadingPosition | null {
  return readingPositions.get(readingKey) ?? null;
}

export function writeEditorReadingPosition(
  readingKey: string,
  position: EditorReadingPosition,
): void {
  readingPositions.set(readingKey, position);
}

export function clearEditorReadingPosition(readingKey: string): void {
  readingPositions.delete(readingKey);
}

export function clearEditorReadingPositionsByProject(projectId: number): void {
  const prefix = projectScope(projectId);
  for (const readingKey of [...readingPositions.keys()]) {
    if (readingKey.startsWith(prefix)) {
      readingPositions.delete(readingKey);
    }
  }
}

/**
 * 清理某个 session 下全部文件的阅读位置。
 *
 * sessionId 全局唯一（跨项目不会复用），可用于 Session 删除流程；
 * 否则复用同一 id 的新 Session 会继承旧 Session 的阅读位置。
 */
export function clearEditorReadingPositionsBySession(sessionId: string): void {
  const scope = sessionScope(sessionId);
  for (const readingKey of [...readingPositions.keys()]) {
    // key 结构为 `project:<id>\0[session:<id>\0]file:<path>`：按段落比对，
    // 避免文件路径里出现相同文案时被误删。
    if (readingKey.split("\u0000")[1] === scope) {
      readingPositions.delete(readingKey);
    }
  }
}

export function resetEditorReadingPositionsForTests(): void {
  readingPositions.clear();
}

/** 磁盘正文中决定「磁盘加载身份」的字段。 */
export interface EditorReadingLoadKeyContent {
  isBinary: boolean;
  isTooLarge: boolean;
  modifiedAt: number | null;
  sizeBytes: number;
}

export interface EditorReadingLoadKeyInput {
  filePath: string;
  /** 内容尚未加载完成时不参与恢复：加载态会先渲染一次空内容。 */
  isLoading: boolean;
  content: EditorReadingLoadKeyContent | null;
}

/**
 * 「磁盘加载身份」：同一文件在磁盘正文未变（尺寸与 mtime 相同）时身份不变，
 * 因此同一次阅读只恢复一次；换文件 / 静默重载 / 挂载都会得到新身份。
 *
 * 只接受决定身份的字段，不接收整体 content：本地未落盘输入每次改字符串都会
 * 产生新身份，从而误触发恢复、把光标拽走。
 */
export function createEditorReadingLoadKey(
  input: EditorReadingLoadKeyInput,
): string | null {
  const { content, filePath, isLoading } = input;
  if (isLoading) {
    return null;
  }
  if (content == null || content.isBinary || content.isTooLarge) {
    return null;
  }
  return `${filePath}:${content.sizeBytes}:${content.modifiedAt ?? "na"}`;
}

/**
 * 布局就绪判据：容器尚未显示时 Monaco 首次创建编辑器的高度为 0，
 * 此时写入或恢复都会被裁剪到顶部，必须等布局高度大于 0 之后再处理。
 */
export function isEditorLayoutReady(layoutHeight: number): boolean {
  return layoutHeight > 0;
}

/** 零高度期间不得写缓存，避免把真实阅读位置覆盖成瞬时顶部。 */
export function shouldPersistEditorReadingPosition(
  layoutHeight: number,
): boolean {
  return isEditorLayoutReady(layoutHeight);
}

export function decideEditorReadingPositionRestore({
  pending,
  layoutHeight,
  savedPosition,
}: {
  pending: boolean;
  layoutHeight: number;
  savedPosition: EditorReadingPosition | null;
}): EditorReadingPositionRestoreDecision {
  if (!pending) {
    return "none";
  }
  if (!isEditorLayoutReady(layoutHeight)) {
    return "wait";
  }
  return savedPosition ? "restore" : "none";
}
