import { Bot, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../../../components/ui/button";
import { useI18n } from "../../../shared/i18n/i18n";
import { toCommandError } from "../../../shared/commands/command-error";
import { listAgentSessions } from "../agent-session-commands";
import type { AgentSessionListItem } from "../agent-session-commands";
import { formatSessionTitle } from "../agent-session-formatters";
import {
  formatSessionMonitorStatusLabel,
  formatSessionMonitorUpdatedAt,
  selectSessionMonitorItems,
} from "./session-monitor-rules";

const DEFAULT_MONITOR_REFRESH_INTERVAL_MS = 1_500;
const MONITOR_CLOSE_DELAY_MS = 150;

interface AgentSessionMonitorButtonProps {
  onViewSession: (sessionId: number) => void;
  projectId: number;
  refreshIntervalMs?: number;
}

export function AgentSessionMonitorButton({
  onViewSession,
  projectId,
  refreshIntervalMs = DEFAULT_MONITOR_REFRESH_INTERVAL_MS,
}: AgentSessionMonitorButtonProps) {
  const { locale, messages } = useI18n();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    null,
  );
  const [sessions, setSessions] = useState<AgentSessionListItem[]>([]);
  const closeTimeoutRef = useRef<number | null>(null);
  const visibleSessions = useMemo(
    () => selectSessionMonitorItems(sessions),
    [sessions],
  );

  const loadSessions = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) {
        setIsLoading(true);
      }
      setErrorMessage(null);

      try {
        const response = await listAgentSessions(projectId);
        setSessions(response.sessions);
      } catch (error) {
        setErrorMessage(toCommandError(error).message);
      } finally {
        if (showLoading) {
          setIsLoading(false);
        }
      }
    },
    [projectId],
  );

  useEffect(
    () => () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const initialLoadId = window.setTimeout(() => {
      void loadSessions(true);
    }, 0);
    const intervalId = window.setInterval(() => {
      void loadSessions(false);
    }, refreshIntervalMs);

    return () => {
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
    };
  }, [isOpen, loadSessions, refreshIntervalMs]);

  function closeMonitor() {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsOpen(false);
    setSelectedSessionId(null);
  }

  function openMonitor() {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsOpen(true);
  }

  function scheduleCloseMonitor() {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
    }

    closeTimeoutRef.current = window.setTimeout(() => {
      closeTimeoutRef.current = null;
      closeMonitor();
    }, MONITOR_CLOSE_DELAY_MS);
  }

  return (
    <div
      className="agent-session-monitor"
      onFocus={openMonitor}
      onMouseEnter={openMonitor}
      onMouseLeave={scheduleCloseMonitor}
    >
      <Button
        aria-expanded={isOpen}
        aria-label={messages.agentsFeature.sessionMonitor}
        className="agent-session-monitor__button"
        size="icon"
        type="button"
        variant="secondary"
        onClick={() => {
          setIsOpen((currentValue) => !currentValue);
        }}
      >
        <Bot aria-hidden="true" size={18} strokeWidth={1.8} />
      </Button>

      {isOpen ? (
        <section
          aria-label={messages.agentsFeature.sessionMonitorList}
          className="agent-session-monitor__panel"
        >
          {errorMessage ? (
            <p className="agent-session-monitor__status" role="status">
              {errorMessage}
            </p>
          ) : null}
          {isLoading ? (
            <p className="agent-session-monitor__status" role="status">
              {messages.agentsFeature.loadingSessions}
            </p>
          ) : null}
          {!isLoading && !errorMessage ? (
            <SessionMonitorRows
              locale={locale}
              messages={messages}
              onSelectSession={setSelectedSessionId}
              onViewSession={(sessionId) => {
                onViewSession(sessionId);
                closeMonitor();
              }}
              selectedSessionId={selectedSessionId}
              sessions={visibleSessions}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

interface SessionMonitorRowsProps {
  locale: ReturnType<typeof useI18n>["locale"];
  messages: ReturnType<typeof useI18n>["messages"];
  onSelectSession: (sessionId: number) => void;
  onViewSession: (sessionId: number) => void;
  selectedSessionId: number | null;
  sessions: AgentSessionListItem[];
}

function SessionMonitorRows({
  locale,
  messages,
  onSelectSession,
  onViewSession,
  selectedSessionId,
  sessions,
}: SessionMonitorRowsProps) {
  if (sessions.length === 0) {
    return (
      <p className="agent-session-monitor__status">
        {messages.agentsFeature.sessionMonitorEmpty}
      </p>
    );
  }

  return (
    <div
      aria-label={messages.agentsFeature.sessionMonitorList}
      className="agent-session-monitor__list"
      role="list"
    >
      {sessions.map((session) => {
        const title = formatSessionTitle(session);
        const statusLabel = formatSessionMonitorStatusLabel(messages, session);
        const updatedAt = formatSessionMonitorUpdatedAt(
          locale,
          session.lastActiveAt,
        );
        const isSelected = selectedSessionId === session.sessionId;

        return (
          <div
            className="agent-session-monitor__item"
            key={session.sessionId}
            role="listitem"
          >
            <button
              aria-pressed={isSelected}
              className="agent-session-monitor__row"
              type="button"
              onClick={() => onSelectSession(session.sessionId)}
            >
              <span className="agent-session-monitor__row-header">
                <span className="agent-session-monitor__title">{title}</span>
                <span className="agent-session-monitor__status-pill">
                  {statusLabel}
                </span>
              </span>
              <span className="agent-session-monitor__updated">
                {messages.agentsFeature.sessionMonitorUpdatedAt(updatedAt)}
              </span>
            </button>
            {isSelected ? (
              <Button
                className="agent-session-monitor__view"
                size="sm"
                type="button"
                variant="outline"
                onClick={() => onViewSession(session.sessionId)}
              >
                <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
                {messages.agentsFeature.sessionMonitorView}
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
