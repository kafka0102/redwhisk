import { useEffect, useRef } from "react";

import { playNotificationSound } from "../../../shared/audio/notification-sound";
import { useI18n } from "../../../shared/i18n/i18n";
import { useTauriEvent } from "../../../shared/tauri-event/use-tauri-event";
import {
  listAgentSessions,
  readAgentTimeline,
} from "../agent-session-commands";
import type { AgentSessionListItem } from "../agent-session-commands";
import type { AgentStreamEventEnvelope } from "../agent-stream-types";
import { AGENT_SESSION_STREAM_EVENT } from "../message-stream/agent-stream-events";
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
  const { messages, notificationReminder } = useI18n();
  const notifiedKeysRef = useRef<Set<string>>(new Set());
  const sessionStatusByIdRef = useRef<
    Map<number, AgentSessionListItem["status"]>
  >(new Map());

  useEffect(() => {
    notifiedKeysRef.current.clear();
    sessionStatusByIdRef.current.clear();
  }, [projectId]);

  useTauriEvent<AgentStreamEventEnvelope>(
    AGENT_SESSION_STREAM_EVENT,
    (envelope) => {
      if (envelope.projectId !== projectId) {
        return;
      }

      const intent = createAgentSessionNotificationIntent(envelope, {
        copy: messages.agentNotifications,
        projectName,
      });
      if (!intent) {
        return;
      }
      // [notify] 诊断：流式通知事件（turn_completed/turn_failed/permission_requested）。
      if (notifiedKeysRef.current.has(intent.key)) {
        console.info(
          `[notify] stream 重复跳过 type=${envelope.event.type} key=${intent.key}`,
        );
        return;
      }

      notifiedKeysRef.current.add(intent.key);
      console.info(
        `[notify] stream 命中 type=${envelope.event.type} key=${intent.key}`,
      );
      // 每轮 turn 完成播放一次提示音：声音针对 session，不受窗口聚焦门控，
      // 即使用户盯着窗口也能听到；偏好关闭时静默。
      if (envelope.event.type === "turn_completed" && notificationReminder) {
        playNotificationSound();
      }
      void deliverNotification(intent, transport);
    },
  );

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

          // [notify] 诊断：打印所有 running 切出转换；若落到 stopped 等未覆盖状态，
          // 命中门控=false 会被静默跳过（当前只认 closed/crashed）。
          if (previousStatus === "running" && session.status !== "running") {
            const matched =
              session.status === "closed" || session.status === "crashed";
            console.info(
              `[notify] status 转换 session=${session.sessionId} running->${session.status} 命中门控=${matched}`,
            );
          }

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
    const windowFocused = await transport.isWindowFocused();
    // [notify] 诊断：窗口聚焦时只走应用内 toast，不发系统通知（无声）；离开窗口才发系统通知+声音。
    console.info(
      `[notify] deliver key=${intent.key} level=${intent.level} windowFocused=${windowFocused}`,
    );
    if (windowFocused) {
      transport.showInAppNotification(intent);
      return;
    }

    await Promise.allSettled([
      transport.requestAttention(intent.level),
      transport.sendSystemNotification(intent),
    ]);
  } catch (error) {
    console.info("[notify] deliver 异常，回落 in-app toast", error);
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
    // [notify] 诊断：状态规则未生成通知意图。
    console.info(
      `[notify] status intent 为空 session=${session.sessionId} status=${session.status}`,
    );
    return;
  }

  const closedAndFocused =
    session.status === "closed" && (await transport.isWindowFocused());
  if (closedAndFocused) {
    // [notify] 诊断：closed 且窗口聚焦，按设计跳过通知。
    console.info(
      `[notify] status closed 且窗口聚焦，跳过 session=${session.sessionId}`,
    );
    return;
  }

  await deliverNotification(intent, transport);
}
