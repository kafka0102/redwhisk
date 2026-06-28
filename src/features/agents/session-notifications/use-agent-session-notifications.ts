import { useEffect, useRef } from "react";

import { useI18n } from "../../../shared/i18n/i18n";
import {
  listAgentSessions,
  readAgentTimeline,
} from "../agent-session-commands";
import type { AgentSessionListItem } from "../agent-session-commands";
import { subscribeAgentSessionStream } from "../message-stream/agent-stream-events";
import {
  createAgentSessionNotificationIntent,
  type AgentSessionNotificationIntent,
} from "./agent-session-notification-rules";
import {
  agentSessionNotificationTransport,
  type AgentSessionNotificationTransport,
} from "./agent-session-notification-transport";
import { createAgentSessionStatusNotificationIntent } from "./session-monitor-rules";

const DEFAULT_SESSION_STATUS_POLL_INTERVAL_MS = 1_500;

interface UseAgentSessionNotificationsArgs {
  pollIntervalMs?: number;
  projectId: number;
  projectName: string;
  transport?: AgentSessionNotificationTransport;
}

export function useAgentSessionNotifications({
  pollIntervalMs = DEFAULT_SESSION_STATUS_POLL_INTERVAL_MS,
  projectId,
  projectName,
  transport = agentSessionNotificationTransport,
}: UseAgentSessionNotificationsArgs): void {
  const { messages } = useI18n();
  const notifiedKeysRef = useRef<Set<string>>(new Set());
  const sessionStatusByIdRef = useRef<
    Map<number, AgentSessionListItem["status"]>
  >(new Map());

  useEffect(() => {
    notifiedKeysRef.current.clear();
    sessionStatusByIdRef.current.clear();
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

  useEffect(() => {
    let isDisposed = false;

    async function refreshSessionStatuses() {
      try {
        const response = await listAgentSessions(projectId);
        if (isDisposed) {
          return;
        }

        const previousStatusById = sessionStatusByIdRef.current;
        const nextStatusById = new Map<
          number,
          AgentSessionListItem["status"]
        >();

        response.sessions.forEach((session) => {
          const previousStatus = previousStatusById.get(session.sessionId);
          nextStatusById.set(session.sessionId, session.status);

          if (
            previousStatus === "running" &&
            (session.status === "closed" || session.status === "crashed")
          ) {
            void deliverSessionStatusNotification({
              messages,
              projectId,
              projectName,
              session,
              transport,
            });
          }
        });

        sessionStatusByIdRef.current = nextStatusById;
      } catch {
        // 状态轮询失败不影响主工作台；下次轮询会重新同步状态。
      }
    }

    void refreshSessionStatuses();
    const intervalId = window.setInterval(() => {
      void refreshSessionStatuses();
    }, pollIntervalMs);

    return () => {
      isDisposed = true;
      window.clearInterval(intervalId);
    };
  }, [messages, pollIntervalMs, projectId, projectName, transport]);
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

async function deliverSessionStatusNotification({
  messages,
  projectId,
  projectName,
  session,
  transport,
}: {
  messages: ReturnType<typeof useI18n>["messages"];
  projectId: number;
  projectName: string;
  session: AgentSessionListItem;
  transport: AgentSessionNotificationTransport;
}): Promise<void> {
  let timelineItems: Awaited<ReturnType<typeof readAgentTimeline>>["items"];

  try {
    const timeline = await readAgentTimeline({
      projectId,
      sessionId: session.sessionId,
    });
    timelineItems = timeline.items;
  } catch {
    timelineItems = [];
  }

  const intent = createAgentSessionStatusNotificationIntent(
    session,
    timelineItems,
    {
      copy: messages.agentNotifications,
      projectName,
    },
  );

  if (!intent) {
    return;
  }

  if (session.status === "closed" && (await transport.isWindowFocused())) {
    return;
  }

  await deliverNotification(intent, transport);
}
