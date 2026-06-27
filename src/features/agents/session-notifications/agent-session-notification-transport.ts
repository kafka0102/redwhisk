import {
  isPermissionGranted,
  removeActive,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";

import { toast } from "../../../shared/toast";
import type {
  AgentSessionNotificationIntent,
  AgentSessionNotificationLevel,
} from "./agent-session-notification-rules";

export interface AgentSessionNotificationTransport {
  isWindowFocused: () => Promise<boolean>;
  requestAttention: (level: AgentSessionNotificationLevel) => Promise<void>;
  sendSystemNotification: (
    intent: AgentSessionNotificationIntent,
  ) => Promise<void>;
  showInAppNotification: (intent: AgentSessionNotificationIntent) => void;
}

export const agentSessionNotificationTransport: AgentSessionNotificationTransport =
  {
    async isWindowFocused() {
      return getCurrentWindow().isFocused();
    },

    async requestAttention(level) {
      const requestType =
        level === "urgent"
          ? UserAttentionType.Critical
          : UserAttentionType.Informational;
      await getCurrentWindow().requestUserAttention(requestType);
    },

    async sendSystemNotification(intent) {
      if (!(await ensureNotificationPermission())) {
        return;
      }

      const notificationId = createNotificationId(intent.key);

      sendNotification({
        body: createNotificationPreviewBody(intent.body),
        id: notificationId,
        largeBody: intent.body,
        title: intent.title,
      });

      if (intent.durationMs) {
        window.setTimeout(() => {
          void removeActive([{ id: notificationId }]).catch(() => {
            // 系统通知可能已被用户或操作系统清理，无需打断主流程。
          });
        }, intent.durationMs);
      }
    },

    showInAppNotification(intent) {
      const options = intent.durationMs
        ? {
            duration: intent.durationMs,
          }
        : undefined;

      if (intent.level === "urgent") {
        toast.warning(intent.body, options);
        return;
      }

      toast.info(intent.body, options);
    },
  };

async function ensureNotificationPermission(): Promise<boolean> {
  if (await isPermissionGranted()) {
    return true;
  }

  return (await requestPermission()) === "granted";
}

function createNotificationId(key: string): number {
  let hash = 0;

  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }

  return hash & 0x7fffffff || 1;
}

function createNotificationPreviewBody(body: string): string {
  const preview = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!preview) {
    return body;
  }

  return preview.length > 140 ? `${preview.slice(0, 137)}...` : preview;
}
