import { useCallback, useEffect, useRef, useState } from "react";

import { subscribeTauriEvent } from "../tauri-event/use-tauri-event";
import {
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT,
  listCodeWorkspaceRoots,
  type CodeWorkspaceRoot,
  type CodeWorkspaceRootsUpdatedEvent,
} from "./workspace-commands";

const ROOTS_REFRESH_INTERVAL_MS = 15_000;

export interface UseCodeWorkspaceRootsResult {
  roots: CodeWorkspaceRoot[];
}

/**
 * 代码工作区分支下拉的数据源（「代码」与「变更」视图共用）。
 *
 * - `initialRoots` 作为首帧快照立即渲染（父层 open / list project 时已 populate），
 *   消除等待首次 IPC 的空窗；之后由本 hook 接管。
 * - 挂载 / projectId 变化时主动 `listCodeWorkspaceRoots` 拉最新，修正「在其它
 *   Activity 期间发生 worktree 增删导致快照过期」的缺失（work tree 分支丢失）。
 * - 监听 `CODE_WORKSPACE_ROOTS_UPDATED_EVENT`（issue 开启 / session setup 等后端
 *   动作触发）即时更新。
 * - 可见时按 15s 定时轮询兜底，捕获应用外部的 `git worktree add / remove`。
 *
 * 轮询结果按 branch+path+isProjectRoot 去重，集合不变则跳过 setState，避免无谓重渲染。
 * 卸载时清理监听与定时器。
 */
export function useCodeWorkspaceRoots(
  projectId: number,
  initialRoots: CodeWorkspaceRoot[],
  enabled: boolean,
): UseCodeWorkspaceRootsResult {
  // useState 仅吃首帧 initialRoots；后续由拉取 / 事件 / 轮询覆盖，不回退到父层快照。
  const [roots, setRoots] = useState<CodeWorkspaceRoot[]>(initialRoots);
  const [isVisible, setIsVisible] = useState(
    typeof document === "undefined" || document.visibilityState === "visible",
  );
  const wasVisibleRef = useRef(isVisible);

  const fetchRoots = useCallback(() => {
    void listCodeWorkspaceRoots(projectId)
      .then((response) => {
        setRoots((current) =>
          hasSameRoots(current, response.roots) ? current : response.roots,
        );
      })
      .catch(() => {
        // 拉取失败保留既有 roots，下次轮询 / 事件重试。
      });
  }, [projectId]);

  // 挂载 / projectId 变化：拉一次最新 + 订阅后端 roots 更新事件。
  useEffect(() => {
    if (!enabled) return;

    fetchRoots();

    return subscribeTauriEvent<CodeWorkspaceRootsUpdatedEvent>(
      CODE_WORKSPACE_ROOTS_UPDATED_EVENT,
      (payload) => {
        if (payload.projectId !== projectId) return;
        setRoots((current) =>
          hasSameRoots(current, payload.roots) ? current : payload.roots,
        );
      },
    );
  }, [projectId, enabled, fetchRoots]);

  // 可见性监听：enabled 期间同步真实可见性，visibilitychange 时更新。
  // setState 放进微任务，避免 react-hooks/set-state-in-effect。
  useEffect(() => {
    if (!enabled) return;
    void Promise.resolve().then(() => {
      setIsVisible(document.visibilityState === "visible");
    });
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled]);

  // 由隐藏恢复可见 → 立即补拉一次（挂载时 wasVisibleRef 已为初始可见，跳过）。
  useEffect(() => {
    if (!enabled) {
      wasVisibleRef.current = isVisible;
      return;
    }
    if (!wasVisibleRef.current && isVisible) {
      fetchRoots();
    }
    wasVisibleRef.current = isVisible;
  }, [isVisible, enabled, fetchRoots]);

  // 可见 + enabled 时按间隔轮询；隐藏 / 禁用不起定时器。
  useEffect(() => {
    if (!enabled || !isVisible) return;
    const timerId = window.setInterval(fetchRoots, ROOTS_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(timerId);
    };
  }, [enabled, isVisible, fetchRoots]);

  return { roots };
}

/** 按 branch+path+isProjectRoot 比较两组 roots，顺序敏感（后端已排序）。 */
function hasSameRoots(
  current: CodeWorkspaceRoot[],
  next: CodeWorkspaceRoot[],
): boolean {
  if (current === next) return true;
  if (current.length !== next.length) return false;
  return current.every((root, index) => {
    const candidate = next[index];
    return (
      candidate.path === root.path &&
      candidate.branch === root.branch &&
      candidate.isProjectRoot === root.isProjectRoot
    );
  });
}
