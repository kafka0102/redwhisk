import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import {
  readMarkdownPreviewMode,
  readMarkdownPreviewScrollOffset,
  writeMarkdownPreviewMode,
  writeMarkdownPreviewScrollOffset,
  type MarkdownPreviewMode,
} from "./markdown-preview-state";

export interface MarkdownPreviewReadingPositionHandle {
  containerRef: RefObject<HTMLDivElement | null>;
  handleScroll: () => void;
}

/**
 * 按阅读身份保存 Markdown 源码 / 预览模式。
 *
 * 组件卸载后模式仍留在 module 缓存里；调用方在关闭 Tab、换文件或换根时清理
 * 对应 key，避免旧状态串到下一次打开。
 */
export function useMarkdownPreviewMode(
  readingKey: string | null,
): readonly [MarkdownPreviewMode, (mode: MarkdownPreviewMode) => void] {
  const [state, setState] = useState<{
    key: string | null;
    mode: MarkdownPreviewMode;
  }>(() => ({
    key: readingKey,
    mode: readMarkdownPreviewMode(readingKey),
  }));

  if (state.key !== readingKey) {
    setState({
      key: readingKey,
      mode: readMarkdownPreviewMode(readingKey),
    });
  }
  const mode =
    state.key === readingKey ? state.mode : readMarkdownPreviewMode(readingKey);

  const setMode = useCallback(
    (nextMode: MarkdownPreviewMode) => {
      writeMarkdownPreviewMode(readingKey, nextMode);
      setState({ key: readingKey, mode: nextMode });
    },
    [readingKey],
  );

  return [mode, setMode] as const;
}

/**
 * 恢复并持续记录 Markdown 预览容器的滚动位置。
 *
 * 容器尚未布局（高度 0）时仍先写入一次，并用 ResizeObserver 在真正可见后补做；
 * 零高度期间浏览器报出的顶部滚动不得覆盖缓存。
 */
export function useMarkdownPreviewReadingPosition({
  readingKey,
  enabled,
}: {
  readingKey: string | null;
  enabled: boolean;
}): MarkdownPreviewReadingPositionHandle {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingRestoreRef = useRef(false);

  const persist = useCallback(() => {
    const container = containerRef.current;
    if (!container || readingKey == null) {
      return;
    }
    // 隐藏 / 布局塌陷时滚动位置可能被浏览器报成顶部，不能覆盖真实位置。
    if (container.clientHeight <= 0 && container.scrollTop === 0) {
      return;
    }
    writeMarkdownPreviewScrollOffset(readingKey, container.scrollTop);
  }, [readingKey]);

  const restore = useCallback(() => {
    const container = containerRef.current;
    if (!container || readingKey == null) {
      pendingRestoreRef.current = false;
      return;
    }
    const offset = readMarkdownPreviewScrollOffset(readingKey);
    if (offset == null) {
      pendingRestoreRef.current = false;
      return;
    }
    container.scrollTop = offset;
    if (container.clientHeight > 0) {
      pendingRestoreRef.current = false;
    }
  }, [readingKey]);

  useLayoutEffect(() => {
    if (!enabled) {
      pendingRestoreRef.current = false;
      return;
    }
    pendingRestoreRef.current = true;
    restore();
  }, [enabled, readingKey, restore]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (pendingRestoreRef.current) {
        restore();
      }
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [enabled, readingKey, restore]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return () => {
      persist();
    };
  }, [enabled, persist]);

  return {
    containerRef,
    handleScroll: persist,
  };
}
