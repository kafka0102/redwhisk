import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { CodeWorkspaceRoot } from "./workspace-commands";
import { useCodeWorkspaceRoots } from "./use-code-workspace-roots";

export const DEFAULT_SIDEBAR_WIDTH = 400;

/**
 * 默认分支 = 项目根（即仓库当前分支）；项目根不存在时返回 null（显示为空），
 * 不回退到 roots[0]，与「默认分支不存在则显示为空」诉求一致。
 */
export function selectInitialRoot(
  roots: CodeWorkspaceRoot[],
): CodeWorkspaceRoot | null {
  return roots.find((root) => root.isProjectRoot) ?? null;
}

interface UseWorkspaceShellOptions {
  projectId: number;
  initialRoots: CodeWorkspaceRoot[];
  /** 初始选中分支路径（来自各自 Activity 的 cache）；为 null 时回退到项目根。 */
  initialSelectedRootPath: string | null;
  initialSidebarWidth: number;
  /** root 切换或被清空时通知调用方清理自身状态（code 清 tabs，changes 清 diff）。 */
  onRootChange?: () => void;
}

export interface UseWorkspaceShellResult {
  roots: CodeWorkspaceRoot[];
  /** 用户选择的分支路径（root 失效切换时也会更新），用于持久化到各自 cache。 */
  selectedRootPath: string | null;
  /** 实际生效的 root（selectedRootPath 命中则取它，否则回退到项目根）。 */
  selectedRoot: CodeWorkspaceRoot | null;
  selectedRootWorkspacePath: string | null;
  selectRoot: (root: CodeWorkspaceRoot) => void;
  sidebarWidth: number;
  beginResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

/**
 * 代码 / 变更两个 Activity 共享的「工作区框架」逻辑：分支轮询、root 选择、侧栏
 * 宽度拖拽、选中分支被删时自动切默认分支。无状态持久化——初始值由调用方从各自
 * cache 传入，由调用方负责把 selectedRootPath / sidebarWidth 写回各自 cache。
 *
 * 两个 Activity 各自实例化本 hook：因 Activity 互斥渲染，同一刻仅一个挂载，
 * `useCodeWorkspaceRoots` 的轮询不会重复。
 */
export function useWorkspaceShell({
  projectId,
  initialRoots,
  initialSelectedRootPath,
  initialSidebarWidth,
  onRootChange,
}: UseWorkspaceShellOptions): UseWorkspaceShellResult {
  const { roots: workspaceRoots } = useCodeWorkspaceRoots(
    projectId,
    initialRoots,
    true,
  );

  const [selectedRootPath, setSelectedRootPath] = useState<string | null>(
    initialSelectedRootPath,
  );
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // onRootChange 用 ref 桥接，避免它成为 selectRoot / effect 的频繁依赖。
  // ref 在 effect（commit 阶段）更新，不在 render 期间写（react/refs 规则）。
  const onRootChangeRef = useRef(onRootChange);
  useEffect(() => {
    onRootChangeRef.current = onRootChange;
  }, [onRootChange]);

  const selectedRoot = useMemo(
    () =>
      workspaceRoots.find((root) => root.path === selectedRootPath) ??
      selectInitialRoot(workspaceRoots),
    [selectedRootPath, workspaceRoots],
  );

  const selectRoot = useCallback((root: CodeWorkspaceRoot) => {
    setSelectedRootPath(root.path);
    onRootChangeRef.current?.();
  }, []);

  // 选中分支被删（roots 更新后不再存在）→ 自动切默认分支；默认分支也不存在 → 清空。
  // setState 放进微任务，避免 react-hooks/set-state-in-effect。
  useEffect(() => {
    if (selectedRootPath === null || workspaceRoots.length === 0) return;
    if (workspaceRoots.some((root) => root.path === selectedRootPath)) return;
    const projectRoot = workspaceRoots.find((root) => root.isProjectRoot);
    void Promise.resolve().then(() => {
      if (projectRoot) {
        selectRoot(projectRoot);
      } else {
        setSelectedRootPath(null);
        onRootChangeRef.current?.();
      }
    });
  }, [workspaceRoots, selectedRootPath, selectRoot]);

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );

  const beginResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
        setSidebarWidth(
          Math.min(640, Math.max(230, startWidth + moveEvent.clientX - startX)),
        );
      };
      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        dragCleanupRef.current = null;
      };
      dragCleanupRef.current?.();
      dragCleanupRef.current = onMouseUp;
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [sidebarWidth],
  );

  return {
    roots: workspaceRoots,
    selectedRootPath,
    selectedRoot,
    selectedRootWorkspacePath: selectedRoot?.path ?? null,
    selectRoot,
    sidebarWidth,
    beginResize,
  };
}
