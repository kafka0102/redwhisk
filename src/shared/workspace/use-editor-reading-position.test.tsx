import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createEditorReadingPositionKey,
  readEditorReadingPosition,
  resetEditorReadingPositionsForTests,
  writeEditorReadingPosition,
  type EditorReadingPosition,
} from "./editor-reading-position";
import {
  useEditorReadingPosition,
  type EditorReadingPositionInstance,
} from "./use-editor-reading-position";

const readingKey = createEditorReadingPositionKey({
  projectId: 1,
  sessionId: "s1",
  filePath: "src/file.ts",
});

function buildPosition(scrollTop: number): EditorReadingPosition {
  return { scrollTop } as unknown as EditorReadingPosition;
}

function seedReadingPosition(scrollTop: number): void {
  writeEditorReadingPosition(readingKey, buildPosition(scrollTop));
}

/** 以「公开契约」造一个假编辑器：布局事件、滚动事件、view state。 */
function createFakeEditor(initialLayoutHeight = 600) {
  const layoutListeners: Array<() => void> = [];
  const scrollListeners: Array<() => void> = [];
  const editor = {
    layoutHeight: initialLayoutHeight,
    viewState: buildPosition(120),
    restoreViewState: vi.fn(),
    saveViewState: vi.fn(() => editor.viewState),
    getLayoutInfo: () => ({ height: editor.layoutHeight }),
    onDidLayoutChange: vi.fn((listener: () => void) => {
      layoutListeners.push(listener);
      return { dispose: vi.fn() };
    }),
    onDidScrollChange: vi.fn((listener: () => void) => {
      scrollListeners.push(listener);
      return { dispose: vi.fn() };
    }),
    onDidDispose: vi.fn((_listener: () => void) => undefined),
    /** 模拟容器由 display:none（高度 0）变为真实高度时的布局事件。 */
    setLayoutHeight(height: number) {
      editor.layoutHeight = height;
      for (const listener of [...layoutListeners]) {
        listener();
      }
    },
    scroll() {
      for (const listener of [...scrollListeners]) {
        listener();
      }
    },
  };
  return editor;
}

type FakeEditor = ReturnType<typeof createFakeEditor>;

function mountEditor(
  handleEditorMount: (editor: EditorReadingPositionInstance) => void,
  editor: FakeEditor,
): void {
  act(() => {
    handleEditorMount(editor as unknown as EditorReadingPositionInstance);
  });
}

describe("useEditorReadingPosition", () => {
  beforeEach(() => {
    resetEditorReadingPositionsForTests();
  });

  it("restores the cached position once the layout is ready", () => {
    const editor = createFakeEditor(0);
    seedReadingPosition(420);
    const { result } = renderHook(() =>
      useEditorReadingPosition({ readingKey, loadKey: "a:1:na" }),
    );

    mountEditor(result.current.handleEditorMount, editor);
    expect(editor.restoreViewState).not.toHaveBeenCalled();

    act(() => {
      editor.setLayoutHeight(600);
    });
    expect(editor.restoreViewState).toHaveBeenCalledTimes(1);
    expect(editor.restoreViewState).toHaveBeenCalledWith({ scrollTop: 420 });

    act(() => {
      editor.setLayoutHeight(700);
    });
    expect(editor.restoreViewState).toHaveBeenCalledTimes(1);
  });

  it("keeps the cached position when a zero-height container reports a scroll", () => {
    const editor = createFakeEditor(0);
    editor.viewState = buildPosition(0);
    seedReadingPosition(420);
    const { result } = renderHook(() =>
      useEditorReadingPosition({ readingKey, loadKey: "a:1:na" }),
    );
    mountEditor(result.current.handleEditorMount, editor);

    act(() => {
      editor.scroll();
    });
    expect(readEditorReadingPosition(readingKey)).toEqual({ scrollTop: 420 });

    act(() => {
      editor.setLayoutHeight(600);
    });
    expect(editor.restoreViewState).toHaveBeenCalledWith({ scrollTop: 420 });
  });

  it("restores again when the layout collapses and becomes visible again", () => {
    const editor = createFakeEditor();
    seedReadingPosition(420);
    const { result } = renderHook(() =>
      useEditorReadingPosition({ readingKey, loadKey: "a:1:na" }),
    );
    mountEditor(result.current.handleEditorMount, editor);
    expect(editor.restoreViewState).toHaveBeenCalledTimes(1);

    act(() => {
      editor.setLayoutHeight(0);
      editor.setLayoutHeight(600);
    });
    expect(editor.restoreViewState).toHaveBeenCalledTimes(2);
  });

  it("restores when the disk load identity changes and not for local edits", () => {
    const editor = createFakeEditor();
    editor.viewState = buildPosition(120);
    const { result, rerender } = renderHook(
      ({ loadKey }: { loadKey: string }) =>
        useEditorReadingPosition({ readingKey, loadKey }),
      { initialProps: { loadKey: "a:1:na" } },
    );
    mountEditor(result.current.handleEditorMount, editor);
    editor.restoreViewState.mockClear();

    // 本地缓冲变化：加载身份不变，不得触发恢复。
    rerender({ loadKey: "a:1:na" });
    expect(editor.restoreViewState).not.toHaveBeenCalled();

    // 磁盘静默重载：加载身份变化，恢复一次并写回最新位置。
    seedReadingPosition(420);
    rerender({ loadKey: "a:2:na" });
    expect(editor.restoreViewState).toHaveBeenCalledTimes(1);

    act(() => {
      editor.scroll();
    });
    expect(readEditorReadingPosition(readingKey)).toEqual({ scrollTop: 120 });
  });

  it("does not restore before the layout is ready even when a load identity change arrives", () => {
    const editor = createFakeEditor(0);
    seedReadingPosition(420);
    const { result, rerender } = renderHook(
      ({ loadKey }: { loadKey: string }) =>
        useEditorReadingPosition({ readingKey, loadKey }),
      { initialProps: { loadKey: "a:1:na" } },
    );
    mountEditor(result.current.handleEditorMount, editor);
    editor.restoreViewState.mockClear();

    rerender({ loadKey: "a:2:na" });
    expect(editor.restoreViewState).not.toHaveBeenCalled();

    act(() => {
      editor.setLayoutHeight(600);
    });
    expect(editor.restoreViewState).toHaveBeenCalledWith({ scrollTop: 420 });
  });

  it("skips restoring when an explicit positioning takes precedence", () => {
    const editor = createFakeEditor(0);
    seedReadingPosition(420);
    const { result } = renderHook(() =>
      useEditorReadingPosition({
        readingKey,
        loadKey: "a:1:na",
        shouldDeferRestore: true,
      }),
    );
    mountEditor(result.current.handleEditorMount, editor);

    act(() => {
      editor.setLayoutHeight(600);
    });
    expect(editor.restoreViewState).not.toHaveBeenCalled();
  });

  it("persists the current position on unmount so a remount returns to it", () => {
    const editor = createFakeEditor();
    const first = renderHook(() =>
      useEditorReadingPosition({ readingKey, loadKey: "a:1:na" }),
    );
    mountEditor(first.result.current.handleEditorMount, editor);

    editor.viewState = buildPosition(300);
    first.unmount();
    expect(readEditorReadingPosition(readingKey)).toEqual({ scrollTop: 300 });

    const second = renderHook(() =>
      useEditorReadingPosition({ readingKey, loadKey: "a:1:na" }),
    );
    const remounted = createFakeEditor();
    mountEditor(second.result.current.handleEditorMount, remounted);
    expect(remounted.restoreViewState).toHaveBeenCalledWith({ scrollTop: 300 });
  });

  it("does nothing when the editor has no reading identity", () => {
    const editor = createFakeEditor(0);
    const { result } = renderHook(() =>
      useEditorReadingPosition({ readingKey: null, loadKey: null }),
    );
    mountEditor(result.current.handleEditorMount, editor);

    act(() => {
      editor.setLayoutHeight(600);
      editor.scroll();
    });
    expect(editor.restoreViewState).not.toHaveBeenCalled();
    expect(editor.saveViewState).not.toHaveBeenCalled();
  });
});
