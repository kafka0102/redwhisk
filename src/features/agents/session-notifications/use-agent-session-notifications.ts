import { useEffect, useRef } from "react";

import { useI18n } from "../../../shared/i18n/i18n";
import { subscribeAgentSessionStream } from "../message-stream/agent-stream-events";
import {
  createAgentSessionNotificationIntent,
  type AgentSessionNotificationIntent,
} from "./agent-session-notification-rules";
import {
  agentSessionNotificationTransport,
  type AgentSessionNotificationTransport,
} from "./agent-session-notification-transport";

interface UseAgentSessionNotificationsArgs {
  projectId: number;
  projectName: string;
  transport?: AgentSessionNotificationTransport;
}

export function useAgentSessionNotifications({
  projectId,
  projectName,
  transport = agentSessionNotificationTransport,
}: UseAgentSessionNotificationsArgs): void {
  const { messages } = useI18n();
  const notifiedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    notifiedKeysRef.current.clear();
  }, [projectId]);

  useEffect(() => {
    let isDisposed = false;
    let unlisten: (() => void) | null = null;

    async function initialize() {
      try {
        unlisten = await subscribeAgentSessionStream((envelope) => {
          if (envelope.projectId !== projectId) {
            return;
          }

          const intent = createAgentSessionNotificationIntent(envelope, {
            copy: messages.agentNotifications,
            projectName,
          });
          if (!intent || notifiedKeysRef.current.has(intent.key)) {
            return;
          }

          notifiedKeysRef.current.add(intent.key);
          void deliverNotification(intent, transport);
        });

        if (isDisposed) {
          unlisten();
          unlisten = null;
        }
      } catch {
        // 通知订阅失败不影响主工作台，后续刷新会重新读取 session 历史。
      }
    }

    void initialize();

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, [messages.agentNotifications, projectId, projectName, transport]);
}

async function deliverNotification(
  intent: AgentSessionNotificationIntent,
  transport: AgentSessionNotificationTransport,
): Promise<void> {
  try {
    if (await transport.isWindowFocused()) {
      transport.showInAppNotification(intent);
      return;
    }

    await Promise.allSettled([
      transport.requestAttention(intent.level),
      transport.sendSystemNotification(intent),
    ]);
  } catch {
    transport.showInAppNotification(intent);
  }
}
