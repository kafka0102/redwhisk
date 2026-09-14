import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { editor as MonacoEditor } from "monaco-editor";

import {
  decideEditorReadingPositionRestore,
  isEditorLayoutReady,
  readEditorReadingPosition,
  shouldPersistEditorReadingPosition,
  writeEditorReadingPosition,
} from "./editor-reading-position";

/**
 * Monaco 编辑器实例（`OnMount` 注入的公开契约）。
 */
export type EditorReadingPositionInstance = MonacoEditor.IStandaloneCodeEditor;

export interface UseEditorReadingPositionOptions {
  /** 阅读身份 key（`createEditorReadingPositionKey`）；null 表示当前编辑器不记忆位置。 */
  readingKey: string | null;
  /**
   * 磁盘加载身份。变化（换文件 / 静默重载 / 挂载）时只触发一次待恢复；
   * null 表示当前没有可恢复的内容。不可传整体 content：本地输入会误触发恢复。
   */
  loadKey: string | null;
  /** 以显式定位（如搜索结果 reveal 到目标行）为准时跳过本次恢复。 */
  shouldDeferRestore?: boolean;
}

export interface EditorReadingPositionHandle {
  editorRef: RefObject<EditorReadingPositionInstance | null>;
  /** 编辑器挂载时调用：登记实例、监听布局与滚动、按策略恢复。 */
  handleEditorMount: (editor: EditorReadingPositionInstance) => void;
  /** 把当前阅读位置写入缓存（零高度期间自动跳过）。 */
  persistReadingPosition: () => void;
}

/**
 * 编辑器阅读位置跨切换保持（滚动位置 + 光标）。
 *
 * 代码页与会话文件查看器共用这一份时序实现，规则见共享策略 module：
 * - 布局就绪（高度 > 0）后才恢复，容器零高度时挂起；
 * - 零高度期间的滚动事件不覆盖缓存，避免真实阅读位置被瞬时顶部冲掉；
 * - 磁盘加载身份变化只恢复一次；本地缓冲变化不触发恢复；
 * - 布局塌陷后重新可见（hidden tab / Activity 切换）补做一次恢复；
 * - 卸载前写回当前位置。
 */
export function useEditorReadingPosition({
  readingKey,
  loadKey,
  shouldDeferRestore = false,
}: UseEditorReadingPositionOptions): EditorReadingPositionHandle {
  const editorRef = useRef<EditorReadingPositionInstance | null>(null);
  const readingKeyRef = useRef(readingKey);
  /** 最近一次已知布局高度：用于识别「零高度 → 真实高度」这一需要补做恢复的时刻。 */
  const layoutHeightRef = useRef(0);
  const pendingRestoreRef = useRef(false);
  /** 已处理过的磁盘加载身份：同一身份只待恢复一次，避免重复 restore。 */
  const handledLoadKeyRef = useRef<string | null>(null);

  useEffect(() => {
    readingKeyRef.current = readingKey;
  }, [readingKey]);

  const persistReadingPosition = useCallback(() => {
    const editor = editorRef.current;
    const key = readingKeyRef.current;
    if (!editor || key == null) return;
    // 零高度（容器尚未显示 / 布局塌陷）期间写缓存会把真实阅读位置覆盖成顶部。
    if (!shouldPersistEditorReadingPosition(editor.getLayoutInfo().height)) {
      return;
    }
    const position = editor.saveViewState();
    if (!position) return;
    writeEditorReadingPosition(key, position);
  }, []);

  const restoreReadingPosition = useCallback(() => {
    const editor = editorRef.current;
    const key = readingKeyRef.current;
    if (!editor || key == null) {
      pendingRestoreRef.current = false;
      return;
    }
    const savedPosition = readEditorReadingPosition(key);
    const decision = decideEditorReadingPositionRestore({
      pending: pendingRestoreRef.current,
      layoutHeight: editor.getLayoutInfo().height,
      savedPosition,
    });
    if (decision === "wait") return;
    pendingRestoreRef.current = false;
    if (decision === "restore" && savedPosition) {
      editor.restoreViewState(savedPosition);
    }
  }, []);

  const handleEditorMount = useCallback(
    (editor: EditorReadingPositionInstance) => {
      editorRef.current = editor;
      layoutHeightRef.current = editor.getLayoutInfo().height;
      handledLoadKeyRef.current = loadKey;
      if (shouldDeferRestore) {
        pendingRestoreRef.current = false;
      } else {
        pendingRestoreRef.current = true;
        restoreReadingPosition();
      }

      // 编辑器首次创建时容器仍是 display:none（布局高度 0），恢复阅读位置必须等布局就绪。
      // 布局塌陷归 0 时挂起一次待恢复，重新可见后再恢复；不在「变为就绪」时重新挂起，
      // 否则会覆盖显式定位（搜索结果 / 跳转定义打开已读过并滚动过的文件）。
      const layoutDisposable = editor.onDidLayoutChange(() => {
        const previousHeight = layoutHeightRef.current;
        const nextHeight = editor.getLayoutInfo().height;
        layoutHeightRef.current = nextHeight;
        if (
          isEditorLayoutReady(previousHeight) &&
          !isEditorLayoutReady(nextHeight)
        ) {
          pendingRestoreRef.current = true;
        }
        restoreReadingPosition();
      });
      const scrollDisposable = editor.onDidScrollChange(() => {
        persistReadingPosition();
      });
      editor.onDidDispose(() => {
        layoutDisposable.dispose();
        scrollDisposable.dispose();
      });
    },
    [
      loadKey,
      persistReadingPosition,
      restoreReadingPosition,
      shouldDeferRestore,
    ],
  );

  // 仅在磁盘加载身份变化时恢复（静默复检 / 换文件 / 加载完成）。
  useEffect(() => {
    if (loadKey == null) {
      return;
    }
    if (handledLoadKeyRef.current === loadKey) {
      return;
    }
    handledLoadKeyRef.current = loadKey;
    if (shouldDeferRestore) {
      // 以显式定位为准时不做阅读位置恢复。
      pendingRestoreRef.current = false;
      return;
    }
    pendingRestoreRef.current = true;
    restoreReadingPosition();
  }, [loadKey, restoreReadingPosition, shouldDeferRestore]);

  // 卸载（切走 Activity / 关闭编辑器面板）前写回当前位置。
  useEffect(() => {
    return () => {
      persistReadingPosition();
    };
  }, [persistReadingPosition, readingKey]);

  return {
    editorRef,
    handleEditorMount,
    persistReadingPosition,
  };
}
