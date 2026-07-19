import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import {
  DEFAULT_ACTIVITY_SIDEBAR_WIDTH,
  SIDEBAR_RESIZE_STEP,
} from "../../shared/layout/sidebar-width";

export const AGENTS_SIDEBAR_MIN_WIDTH = DEFAULT_ACTIVITY_SIDEBAR_WIDTH;
export const AGENTS_SIDEBAR_MAX_WIDTH = 450;
export const SESSION_SIDE_PANEL_DEFAULT_WIDTH = 400;
export const SESSION_SIDE_PANEL_MIN_WIDTH = 240;
export const SESSION_SIDE_PANEL_MAX_WIDTH = 560;

function clampSessionSidePanelWidth(width: number) {
  return Math.min(
    SESSION_SIDE_PANEL_MAX_WIDTH,
    Math.max(SESSION_SIDE_PANEL_MIN_WIDTH, width),
  );
}

interface SplitterDragState {
  startWidth: number;
  startX: number;
}

/**
 * agents-activity 两个 splitter（session 列表宽 / 侧栏宽）的 drag-resize。
 *
 * 注意：两个 splitter 的鼠标交互历史地不一致——列表 splitter 不拦截右键、不阻止
 * 默认行为；侧栏 splitter 拦截非左键并 preventDefault。本 hook 各自保留原行为，
 * 不在重构中顺手对齐（避免改变可观察行为）。
 */
export function useSplitterDrag() {
  const [sidebarWidth, setSidebarWidth] = useState(
    DEFAULT_ACTIVITY_SIDEBAR_WIDTH,
  );
  const [sessionSidePanelWidth, setSessionSidePanelWidth] = useState(
    SESSION_SIDE_PANEL_DEFAULT_WIDTH,
  );
  const dragStateRef = useRef<SplitterDragState | null>(null);
  const sidePanelDragStateRef = useRef<SplitterDragState | null>(null);

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      const dragState = dragStateRef.current;
      if (dragState) {
        const deltaX = event.clientX - dragState.startX;
        const nextWidth = Math.max(
          AGENTS_SIDEBAR_MIN_WIDTH,
          Math.min(AGENTS_SIDEBAR_MAX_WIDTH, dragState.startWidth + deltaX),
        );
        setSidebarWidth(nextWidth);
      }

      const sidePanelDragState = sidePanelDragStateRef.current;
      if (sidePanelDragState) {
        const deltaX = event.clientX - sidePanelDragState.startX;
        const nextWidth = clampSessionSidePanelWidth(
          sidePanelDragState.startWidth - deltaX,
        );
        setSessionSidePanelWidth(nextWidth);
      }
    }

    function handleMouseUp() {
      dragStateRef.current = null;
      sidePanelDragStateRef.current = null;
      window.document.body.style.cursor = "";
      window.document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.document.body.style.cursor = "";
      window.document.body.style.userSelect = "";
    };
  }, []);

  const handleSidebarSplitterMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      dragStateRef.current = {
        startWidth: sidebarWidth,
        startX: event.clientX,
      };
      window.document.body.style.cursor = "col-resize";
      window.document.body.style.userSelect = "none";
    },
    [sidebarWidth],
  );

  const handleSidebarSplitterKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSidebarWidth((currentWidth) =>
          Math.max(
            AGENTS_SIDEBAR_MIN_WIDTH,
            currentWidth - SIDEBAR_RESIZE_STEP,
          ),
        );
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setSidebarWidth((currentWidth) =>
          Math.min(
            AGENTS_SIDEBAR_MAX_WIDTH,
            currentWidth + SIDEBAR_RESIZE_STEP,
          ),
        );
      }
    },
    [],
  );

  const handleSidePanelSplitterMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      sidePanelDragStateRef.current = {
        startWidth: sessionSidePanelWidth,
        startX: event.clientX,
      };
      window.document.body.style.cursor = "col-resize";
      window.document.body.style.userSelect = "none";
    },
    [sessionSidePanelWidth],
  );

  const handleSidePanelSplitterKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSessionSidePanelWidth((currentWidth) =>
          clampSessionSidePanelWidth(currentWidth + SIDEBAR_RESIZE_STEP),
        );
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setSessionSidePanelWidth((currentWidth) =>
          clampSessionSidePanelWidth(currentWidth - SIDEBAR_RESIZE_STEP),
        );
      }

      if (event.key === "Home") {
        event.preventDefault();
        setSessionSidePanelWidth(SESSION_SIDE_PANEL_DEFAULT_WIDTH);
      }

      if (event.key === "End") {
        event.preventDefault();
        setSessionSidePanelWidth(SESSION_SIDE_PANEL_MAX_WIDTH);
      }
    },
    [],
  );

  return {
    sidebarWidth,
    sessionSidePanelWidth,
    handleSidebarSplitterMouseDown,
    handleSidebarSplitterKeyDown,
    handleSidePanelSplitterMouseDown,
    handleSidePanelSplitterKeyDown,
  };
}
