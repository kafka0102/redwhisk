import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  listAgentSessions,
  updateAgentSessionTitle,
  type AgentSessionListItem,
} from "./agent-session-commands";
import {
  AGENT_SESSION_LIST_CHANGED_EVENT,
  type AgentSessionListChangedEvent,
} from "./agent-session-events";
import { subscribeTauriEvent } from "../../shared/tauri-event/use-tauri-event";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import type { useI18n } from "../../shared/i18n/i18n";

type Translate = ReturnType<typeof useI18n>["t"];

const SESSION_LIST_EVENT_REFRESH_DEBOUNCE_MS = 500;

interface UseAgentSessionListOptions {
  projectId: number;
  applySessionListOverlays: (
    sessions: AgentSessionListItem[],
  ) => AgentSessionListItem[];
  selectedSession: AgentSessionListItem | null;
  setAllSessions: Dispatch<SetStateAction<AgentSessionListItem[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setShouldLoadDeferredContent: Dispatch<SetStateAction<boolean>>;
  setIsRenamingSessionTitle: Dispatch<SetStateAction<boolean>>;
  showCommandErrorAlert: (error: unknown) => void;
  t: Translate;
}

/**
 * agents-activity 的 session 列表数据层：加载 / 事件防抖刷新 / 改名。
 * 列表 state 留在容器（被完成流与跨簇编排共享），本 hook 只接收 setter 与上下文。
 */
export function useAgentSessionList({
  projectId,
  applySessionListOverlays,
  selectedSession,
  setAllSessions,
  setIsLoading,
  setErrorMessage,
  setShouldLoadDeferredContent,
  setIsRenamingSessionTitle,
  showCommandErrorAlert,
  t,
}: UseAgentSessionListOptions) {
  useEffect(() => {
    let isMounted = true;
    let refreshTimer: number | null = null;
    let isRefreshInFlight = false;
    let hasPendingRefresh = false;

    async function loadSessions(showLoading: boolean) {
      if (!showLoading && isRefreshInFlight) {
        hasPendingRefresh = true;
        return;
      }
      if (!showLoading) {
        isRefreshInFlight = true;
      }
      if (showLoading) {
        setIsLoading(true);
      }
      setErrorMessage(null);

      try {
        const response = await listAgentSessions(projectId);
        if (!isMounted) {
          return;
        }

        setAllSessions(applySessionListOverlays(response.sessions));
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setErrorMessage(getCommandErrorMessage(error, t));
      } finally {
        if (!showLoading) {
          isRefreshInFlight = false;
          if (hasPendingRefresh && isMounted) {
            hasPendingRefresh = false;
            scheduleEventRefresh();
          }
        }
        if (isMounted && showLoading) {
          setIsLoading(false);
          // session 列表加载完成后，延迟加载非关键内容，确保 UI 先响应
          window.requestIdleCallback(() => {
            setShouldLoadDeferredContent(true);
          });
        }
      }
    }

    function scheduleEventRefresh() {
      if (refreshTimer !== null) {
        return;
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadSessions(false);
      }, SESSION_LIST_EVENT_REFRESH_DEBOUNCE_MS);
    }

    void loadSessions(true);
    const unsubscribe = subscribeTauriEvent<AgentSessionListChangedEvent>(
      AGENT_SESSION_LIST_CHANGED_EVENT,
      (event) => {
        if (event.projectId !== projectId) {
          return;
        }
        scheduleEventRefresh();
      },
    );

    return () => {
      isMounted = false;
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      unsubscribe();
    };
  }, [
    applySessionListOverlays,
    projectId,
    setAllSessions,
    setErrorMessage,
    setIsLoading,
    setShouldLoadDeferredContent,
    t,
  ]);

  const refreshSessions = useCallback(async () => {
    const response = await listAgentSessions(projectId);
    const nextSessions = applySessionListOverlays(response.sessions);
    setAllSessions(nextSessions);
    return nextSessions;
  }, [applySessionListOverlays, projectId, setAllSessions]);

  async function handleRenameSessionTitle(sessionId: number, title: string) {
    if (!selectedSession || selectedSession.sessionId !== sessionId) {
      return;
    }

    setIsRenamingSessionTitle(true);
    try {
      const result = await updateAgentSessionTitle({
        projectId,
        sessionId,
        title,
      });
      setAllSessions((currentSessions) =>
        currentSessions.map((session) =>
          session.sessionId === result.sessionId
            ? {
                ...session,
                title: result.title,
                lastActiveAt: session.lastActiveAt + 1,
              }
            : session,
        ),
      );
      await refreshSessions();
    } catch (error) {
      showCommandErrorAlert(error);
      throw error;
    } finally {
      setIsRenamingSessionTitle(false);
    }
  }

  return {
    refreshSessions,
    handleRenameSessionTitle,
  };
}
