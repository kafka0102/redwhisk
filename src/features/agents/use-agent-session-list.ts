import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  listAgentSessions,
  startStructuredAgentSession,
  updateAgentSessionTitle,
  type AgentSessionListItem,
  type StartStructuredAgentSessionResult,
} from "./agent-session-commands";
import { subscribeAgentSessionListChanged } from "./agent-session-events";
import {
  listAgentProfiles,
  type AgentProfileRecord,
} from "../settings/settings-commands";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import type { useI18n } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";

type Messages = ReturnType<typeof useI18n>["messages"];
type Translate = ReturnType<typeof useI18n>["t"];

const SESSION_LIST_EVENT_REFRESH_DEBOUNCE_MS = 500;

interface UseAgentSessionListOptions {
  projectId: number;
  applySessionListOverlays: (
    sessions: AgentSessionListItem[],
  ) => AgentSessionListItem[];
  selectedSession: AgentSessionListItem | null;
  isCreatingSession: boolean;
  setAllSessions: Dispatch<SetStateAction<AgentSessionListItem[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setShouldLoadDeferredContent: Dispatch<SetStateAction<boolean>>;
  setAvailableAgentProfiles: Dispatch<SetStateAction<AgentProfileRecord[]>>;
  setIsLoadingAgentProfiles: Dispatch<SetStateAction<boolean>>;
  setHasAgentProfilesLoadError: Dispatch<SetStateAction<boolean>>;
  setIsCreatingSession: Dispatch<SetStateAction<boolean>>;
  setIsRenamingSessionTitle: Dispatch<SetStateAction<boolean>>;
  setIsSessionSidePanelOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedSessionId: Dispatch<SetStateAction<number | null>>;
  onSelectSession?: (sessionId: number) => void;
  showCommandErrorAlert: (error: unknown) => void;
  t: Translate;
  messages: Messages;
}

/**
 * agents-activity 的 session 列表数据层：加载 / 事件防抖刷新 / agent profile 合并
 * 加载 / 创建临时 session / 改名。列表 state 留在容器（被完成流与跨簇编排共享），
 * 本 hook 只接收 setter 与上下文，跑两个加载 effect 并返回 CRUD handler。
 */
export function useAgentSessionList({
  projectId,
  applySessionListOverlays,
  selectedSession,
  isCreatingSession,
  setAllSessions,
  setIsLoading,
  setErrorMessage,
  setShouldLoadDeferredContent,
  setAvailableAgentProfiles,
  setIsLoadingAgentProfiles,
  setHasAgentProfilesLoadError,
  setIsCreatingSession,
  setIsRenamingSessionTitle,
  setIsSessionSidePanelOpen,
  setSelectedSessionId,
  onSelectSession,
  showCommandErrorAlert,
  t,
  messages,
}: UseAgentSessionListOptions) {
  useEffect(() => {
    let isMounted = true;
    let unlisten: (() => void) | null = null;
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
    void subscribeAgentSessionListChanged((event) => {
      if (event.projectId !== projectId) {
        return;
      }
      scheduleEventRefresh();
    }).then((nextUnlisten) => {
      if (!isMounted) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
    });

    return () => {
      isMounted = false;
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      unlisten?.();
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

  useEffect(() => {
    let isMounted = true;

    async function loadAgentProfiles() {
      setIsLoadingAgentProfiles(true);
      setHasAgentProfilesLoadError(false);

      try {
        const [projectResponse, globalResponse] = await Promise.all([
          listAgentProfiles({ scope: "project", projectId }),
          listAgentProfiles({ scope: "global", projectId: null }),
        ]);

        if (!isMounted) {
          return;
        }

        const mergedProfiles = [
          ...projectResponse.profiles,
          ...globalResponse.profiles,
        ];
        setAvailableAgentProfiles(mergedProfiles);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setAvailableAgentProfiles([]);
        setHasAgentProfilesLoadError(true);
        toast.error(getCommandErrorMessage(error, t));
      } finally {
        if (isMounted) {
          setIsLoadingAgentProfiles(false);
        }
      }
    }

    void loadAgentProfiles();

    return () => {
      isMounted = false;
    };
  }, [
    projectId,
    setAvailableAgentProfiles,
    setHasAgentProfilesLoadError,
    setIsLoadingAgentProfiles,
    t,
  ]);

  const refreshSessions = useCallback(async () => {
    const response = await listAgentSessions(projectId);
    const nextSessions = applySessionListOverlays(response.sessions);
    setAllSessions(nextSessions);
    return nextSessions;
  }, [applySessionListOverlays, projectId, setAllSessions]);

  async function handleTemporarySessionStarted(
    result: StartStructuredAgentSessionResult,
  ) {
    const response = await listAgentSessions(projectId);
    setAllSessions(applySessionListOverlays(response.sessions));
    setIsSessionSidePanelOpen(false);
    setSelectedSessionId(result.sessionId);
    onSelectSession?.(result.sessionId);
  }

  async function createSession(profile: AgentProfileRecord) {
    if (isCreatingSession) {
      return;
    }

    setIsCreatingSession(true);

    try {
      const result = await startStructuredAgentSession({
        projectId,
        title: messages.agentsFeature.temporarySessionDefaultTitle,
        agentType: profile.agentType,
        agentProfileId: profile.id,
      });
      await handleTemporarySessionStarted(result);
    } catch (error) {
      toast.error(getCommandErrorMessage(error, t));
    } finally {
      setIsCreatingSession(false);
    }
  }

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
    createSession,
    handleTemporarySessionStarted,
    handleRenameSessionTitle,
  };
}
