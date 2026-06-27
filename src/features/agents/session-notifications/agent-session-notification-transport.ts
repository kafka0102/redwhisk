import {
  isPermissionGranted,
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

      sendNotification({
        body: intent.body,
        title: intent.title,
      });
    },

    showInAppNotification(intent) {
      if (intent.level === "urgent") {
        toast.warning(intent.body);
        return;
      }

      toast.info(intent.body);
    },
  };

async function ensureNotificationPermission(): Promise<boolean> {
  if (await isPermissionGranted()) {
    return true;
  }

  return (await requestPermission()) === "granted";
}
