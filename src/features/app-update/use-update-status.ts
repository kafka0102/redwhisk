import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

import {
  dismissUpdatePrompt,
  getUpdateStatus,
  UPDATE_PROMPT_CHANGED_EVENT,
  type DismissUpdatePromptAction,
  type UpdateCheckErrorCode,
  type UpdateStatus,
} from "../../shared/commands/app-update-commands";
import { isCommandError } from "../../shared/commands/command-error";

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isUpdateCheckErrorCode(
  value: unknown,
): value is UpdateCheckErrorCode | null {
  return (
    value === null ||
    value === "network" ||
    value === "invalidResponse" ||
    value === "unknown"
  );
}

/** 校验事件 payload 是否为完整 UpdateStatus。 */
export function isUpdateStatus(value: unknown): value is UpdateStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.shouldShowPrompt === "boolean" &&
    typeof record.currentVersion === "string" &&
    typeof record.hasUpdate === "boolean" &&
    isNullableString(record.latestVersion) &&
    isNullableString(record.releaseUrl) &&
    isNullableString(record.ignoredVersion) &&
    isNullableString(record.snoozeUntil) &&
    isNullableString(record.checkedAt) &&
    isUpdateCheckErrorCode(record.errorCode)
  );
}

/**
 * Workbench / 关于页共用：静默启动检查、强制检查、dismiss、多窗同步。
 */
export function useUpdateStatus(): {
  status: UpdateStatus | null;
  isChecking: boolean;
  checkError: string | null;
  dismiss: (action: DismissUpdatePromptAction) => Promise<void>;
  checkForUpdates: () => Promise<void>;
} {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const refreshQuietly = useCallback(async () => {
    try {
      const next = await getUpdateStatus({ forceRefresh: false });
      setStatus(next);
    } catch {
      // 启动/同步路径静默失败。
    }
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    void Promise.resolve().then(() => {
      if (cancelled) {
        return;
      }
      void refreshQuietly();
    });

    void listen<unknown>(UPDATE_PROMPT_CHANGED_EVENT, (event) => {
      if (cancelled) {
        return;
      }
      if (isUpdateStatus(event.payload)) {
        setStatus(event.payload);
        setCheckError(null);
        return;
      }
      void refreshQuietly();
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
      setCheckError(null);
    } catch {
      // dismiss 失败时保持当前提示。
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    setIsChecking(true);
    setCheckError(null);
    try {
      const next = await getUpdateStatus({ forceRefresh: true });
      setStatus(next);
    } catch (error: unknown) {
      const message = isCommandError(error)
        ? error.message
        : error instanceof Error && error.message
          ? error.message
          : "check failed";
      setCheckError(message);
    } finally {
      setIsChecking(false);
    }
  }, []);

  return { status, isChecking, checkError, dismiss, checkForUpdates };
}
