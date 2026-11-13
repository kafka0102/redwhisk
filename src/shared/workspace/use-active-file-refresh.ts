import { useEffect, useRef, useState } from "react";

import { useWindowFocus } from "../window/use-window-focus";
import {
  readProjectWorktreeFile,
  statProjectWorktreeFile,
  type WorkspaceFileContent,
} from "./workspace-commands";

/** 可见文件 Tab 的元数据检测间隔。 */
export const ACTIVE_FILE_REFRESH_INTERVAL_MS = 3_000;

export function buildActiveFileSignature(
  sizeBytes: number,
  modifiedAt: number | null | undefined,
): string {
  return `${sizeBytes}:${modifiedAt ?? 0}`;
}

export interface UseActiveFileRefreshOptions {
  projectId: number;
  /** Session 文件查看器可选；代码 Activity 不传。 */
  sessionId?: number | null;
  /** Session 文件查看器只有 sessionId；代码 Activity 必须提供工作区根。 */
  workspacePath?: string | null;
  /** 当前激活文件；null 表示没有可检测文件。 */
  filePath: string | null;
  /**
   * 文件 Tab 是否暴露（代码 Activity 还要求有选中根与激活 Tab；Session 侧还要求
   * 侧栏与文件 Tab 打开）。窗口聚焦与文档可见性由本 hook 自行门控。
   */
  enabled: boolean;
  /** 当前已加载正文的签名（size:mtime），用于首轮 stat 建立基线，避免重复 read。 */
  knownSignature?: string | null;
  /** 签名变化并静默读取成功后的新正文。 */
  onContent: (content: WorkspaceFileContent) => void;
  /** stat 或 read 失败；同一路径的旧正文应由调用方置空并进入错误态。 */
  onError: (error: unknown, filePath: string) => void;
}

interface ActiveFileRefreshState {
  /** 最近一次已落地（读取成功或 stat 失败后清空）的签名。 */
  signature: string | null;
  /** 最近一次检测完成时间；null 表示尚未检测过。 */
  lastCheckedAt: number | null;
}

const refreshStateByKey = new Map<string, ActiveFileRefreshState>();
const inFlightByKey = new Map<string, Promise<void>>();

function buildStateKey(
  projectId: number,
  sessionId: number | null | undefined,
  workspacePath: string | null,
  filePath: string,
): string {
  return JSON.stringify([
    projectId,
    sessionId ?? null,
    workspacePath,
    filePath,
  ]);
}

function getRefreshState(key: string): ActiveFileRefreshState {
  const existing = refreshStateByKey.get(key);
  if (existing) {
    return existing;
  }
  const state: ActiveFileRefreshState = {
    signature: null,
    lastCheckedAt: null,
  };
  refreshStateByKey.set(key, state);
  return state;
}

/** 仅供测试隔离：清空跨实例共享的检测基线与在途登记。 */
export function resetActiveFileRefreshStateForTests(): void {
  refreshStateByKey.clear();
  inFlightByKey.clear();
}

function isDocumentVisible(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState === "visible"
  );
}

/**
 * 共享的可见文件刷新策略：文件 Tab 可见、窗口聚焦且文档可见时，按 3000ms 检测
 * `stat` 签名；签名未变不读正文，变化时静默 `read` 并交给调用方落地。隐藏 / 失焦
 * 暂停；恢复时距该文件上次检测不足 3000ms 则等剩余时间，否则立即检测。检测状态按
 * 「项目 + 会话 + 工作区根 + 文件路径」在内存中记录，切 Tab / 重挂载后仍共用同一份
 * 基线，不同作用域互不串用；同一路径检测在途时不叠加第二个请求。
 */
export function useActiveFileRefresh({
  projectId,
  sessionId = null,
  workspacePath,
  filePath,
  enabled,
  knownSignature = null,
  onContent,
  onError,
}: UseActiveFileRefreshOptions): void {
  const [isDocumentVisibleState, setIsDocumentVisibleState] =
    useState(isDocumentVisible);
  const isWindowFocused = useWindowFocus();
  const callbacksRef = useRef({ onContent, onError });

  useEffect(() => {
    callbacksRef.current = { onContent, onError };
  }, [onContent, onError]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const handleVisibilityChange = () => {
      setIsDocumentVisibleState(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const hasDetectableTarget =
    filePath != null && (workspacePath != null || sessionId != null);
  const stateKey = hasDetectableTarget
    ? buildStateKey(projectId, sessionId, workspacePath ?? null, filePath)
    : null;
  const isActive =
    enabled &&
    isDocumentVisibleState &&
    isWindowFocused &&
    stateKey != null &&
    filePath != null;

  useEffect(() => {
    if (
      !isActive ||
      stateKey == null ||
      filePath == null ||
      (workspacePath == null && sessionId == null)
    ) {
      return;
    }

    const state = getRefreshState(stateKey);
    if (state.signature == null && knownSignature != null) {
      state.signature = knownSignature;
    }

    let isDisposed = false;
    let timerId: number | null = null;

    const clearTimer = () => {
      if (timerId != null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
    };

    const scheduleNextCheck = () => {
      if (isDisposed) {
        return;
      }
      clearTimer();
      const delay =
        state.lastCheckedAt == null
          ? 0
          : Math.max(
              0,
              ACTIVE_FILE_REFRESH_INTERVAL_MS -
                (Date.now() - state.lastCheckedAt),
            );
      if (delay === 0) {
        void check();
        return;
      }
      timerId = window.setTimeout(() => {
        timerId = null;
        void check();
      }, delay);
    };

    const performCheck = async (): Promise<void> => {
      try {
        const fileInput =
          workspacePath != null
            ? {
                projectId,
                ...(sessionId == null ? {} : { sessionId }),
                workspacePath,
                filePath,
              }
            : { projectId, sessionId, filePath };
        const stat = await statProjectWorktreeFile(fileInput);
        const signature = buildActiveFileSignature(
          stat.sizeBytes,
          stat.modifiedAt,
        );
        if (state.signature === signature) {
          state.lastCheckedAt = Date.now();
          return;
        }
        // 首次检测只建立基线；首次打开正文由调用方现有打开流程负责。
        if (state.signature == null) {
          state.signature = signature;
          state.lastCheckedAt = Date.now();
          return;
        }

        const content = await readProjectWorktreeFile(fileInput);
        // 隐藏 / 失焦 / 切 Tab 会先让当前 effect 失效。此时若先落地共享签名，
        // 正文又因调用方已卸载而丢弃，恢复后同签名会被永久跳过。因此只有仍
        // 有效的检测才提交新签名并交付正文。
        if (isDisposed) {
          return;
        }
        state.signature = buildActiveFileSignature(
          content.sizeBytes,
          content.modifiedAt,
        );
        state.lastCheckedAt = Date.now();
        callbacksRef.current.onContent(content);
      } catch (error) {
        // 清空签名，使恢复可读后的下一次 stat 必然触发 read。
        state.signature = "";
        state.lastCheckedAt = Date.now();
        if (!isDisposed) {
          callbacksRef.current.onError(error, filePath);
        }
      }
    };

    const check = async (): Promise<void> => {
      if (isDisposed) {
        return;
      }
      const inFlight = inFlightByKey.get(stateKey);
      if (inFlight) {
        await inFlight;
        if (!isDisposed) {
          scheduleNextCheck();
        }
        return;
      }

      const task = performCheck();
      inFlightByKey.set(stateKey, task);
      try {
        await task;
      } finally {
        if (inFlightByKey.get(stateKey) === task) {
          inFlightByKey.delete(stateKey);
        }
        if (!isDisposed) {
          scheduleNextCheck();
        }
      }
    };

    scheduleNextCheck();

    return () => {
      isDisposed = true;
      clearTimer();
    };
  }, [
    enabled,
    filePath,
    isActive,
    isDocumentVisibleState,
    isWindowFocused,
    knownSignature,
    projectId,
    sessionId,
    stateKey,
    workspacePath,
  ]);
}
