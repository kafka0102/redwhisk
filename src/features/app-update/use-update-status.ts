import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

import {
  dismissUpdatePrompt,
  getUpdateStatus,
  UPDATE_PROMPT_CHANGED_EVENT,
  type DismissUpdatePromptAction,
  type UpdateStatus,
} from "../../shared/commands/app-update-commands";

function isUpdateStatus(value: unknown): value is UpdateStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.shouldShowPrompt === "boolean" &&
    typeof record.currentVersion === "string" &&
    typeof record.hasUpdate === "boolean"
  );
}

/**
 * Workbench 启动时静默拉取更新状态，并订阅多窗口同步事件。
 * 网络/command 失败不抛到 UI。
 */
export function useUpdateStatus(): {
  status: UpdateStatus | null;
  dismiss: (action: DismissUpdatePromptAction) => Promise<void>;
} {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  const refreshQuietly = useCallback(async (forceRefresh = false) => {
    try {
      const next = await getUpdateStatus({ forceRefresh });
      setStatus(next);
    } catch {
      // 启动/同步路径静默失败。
    }
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    // setState 放进微任务，避免 react-hooks/set-state-in-effect。
    void Promise.resolve().then(() => {
      if (cancelled) {
        return;
      }
      void refreshQuietly(false);
    });

    void listen<unknown>(UPDATE_PROMPT_CHANGED_EVENT, (event) => {
      if (cancelled) {
        return;
      }
      if (isUpdateStatus(event.payload)) {
        setStatus(event.payload);
        return;
      }
      void refreshQuietly(false);
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refreshQuietly]);

  const dismiss = useCallback(async (action: DismissUpdatePromptAction) => {
    try {
      const next = await dismissUpdatePrompt({ action });
      setStatus(next);
    } catch {
      // dismiss 失败时保持当前提示，避免误关。
    }
  }, []);

  return { status, dismiss };
}
