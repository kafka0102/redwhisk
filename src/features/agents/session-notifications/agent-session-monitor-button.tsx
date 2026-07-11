import { Bot, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
  primaryMonitor,
} from "@tauri-apps/api/window";

import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../../components/ui/dropdown-menu";
import { useI18n } from "../../../shared/i18n/i18n";
import { getCommandErrorMessage } from "../../../shared/commands/command-error";
import { listAgentSessions } from "../agent-session-commands";
import type { AgentSessionListItem } from "../agent-session-commands";
import { formatSessionTitle } from "../agent-session-formatters";
import {
  formatSessionMonitorStatusLabel,
  formatSessionMonitorUpdatedAt,
  selectSessionMonitorItems,
} from "./session-monitor-rules";
import {
  closeSessionMonitorWindow,
  listMonitoredAgentSessions,
} from "./session-monitor-commands";

const DEFAULT_MONITOR_REFRESH_INTERVAL_MS = 1_500;
const MONITOR_CLOSE_DELAY_MS = 150;
const DESKTOP_COLLAPSED_SIZE = 44;
const DESKTOP_EXPANDED_HEIGHT = 460;
const DESKTOP_EXPANDED_WIDTH = 360;
const DESKTOP_MARGIN = 8;

interface AgentSessionMonitorButtonProps {
  mode?: "in-app" | "desktop";
  onViewSession: (sessionId: number, projectId: number) => void;
  projectId?: number;
  refreshIntervalMs?: number;
}

export function AgentSessionMonitorButton({
  mode = "in-app",
  onViewSession,
  projectId,
  refreshIntervalMs = DEFAULT_MONITOR_REFRESH_INTERVAL_MS,
}: AgentSessionMonitorButtonProps) {
  const { locale, messages, t } = useI18n();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    null,
  );
  const [sessions, setSessions] = useState<AgentSessionListItem[]>([]);
  const closeTimeoutRef = useRef<number | null>(null);
  const hasUserDraggedDesktopWindowRef = useRef(false);
  const visibleSessions = useMemo(
    () => selectSessionMonitorItems(sessions),
    [sessions],
  );
  const isDesktopMode = mode === "desktop";

  const loadSessions = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) {
        setIsLoading(true);
      }
      setErrorMessage(null);

      try {
        const response =
          projectId == null
            ? await listMonitoredAgentSessions()
            : await listAgentSessions(projectId);
        setSessions(response.sessions);
      } catch (error) {
        setErrorMessage(getCommandErrorMessage(error, t));
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
    if (!isDesktopMode) {
      return;
    }

    void resizeDesktopMonitorWindow(
      isOpen,
      !hasUserDraggedDesktopWindowRef.current,
    );
  }, [isDesktopMode, isOpen]);

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

  async function handleDesktopDrag(event: React.PointerEvent) {
    if (!isDesktopMode || event.button !== 0) {
      return;
    }

    try {
      hasUserDraggedDesktopWindowRef.current = true;
      await getCurrentWindow().startDragging();
    } catch {
      // Dragging is only a desktop affordance; keep the monitor usable if it fails.
    }
  }

  function closeDesktopMonitor() {
    setIsContextMenuOpen(false);
    void closeSessionMonitorWindow({
      ownerWindowLabel: getCurrentWindow().label,
    });
  }

  return (
    <div
      className={
        isDesktopMode
          ? "agent-session-monitor agent-session-monitor--desktop"
          : "agent-session-monitor"
      }
      onFocus={openMonitor}
      onMouseEnter={openMonitor}
      onMouseLeave={scheduleCloseMonitor}
    >
      {isDesktopMode ? (
        <DropdownMenu
          open={isContextMenuOpen}
          onOpenChange={setIsContextMenuOpen}
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
            onContextMenu={(event) => {
              event.preventDefault();
              setIsContextMenuOpen(true);
            }}
            onPointerDown={handleDesktopDrag}
          >
            <Bot aria-hidden="true" size={18} strokeWidth={1.8} />
          </Button>
          <DropdownMenuContent
            align="end"
            aria-label={messages.agentsFeature.sessionMonitorMenu}
            onMouseEnter={() => {
              if (closeTimeoutRef.current !== null) {
                window.clearTimeout(closeTimeoutRef.current);
                closeTimeoutRef.current = null;
              }
            }}
          >
            <DropdownMenuItem onClick={closeDesktopMonitor}>
              {messages.agentsFeature.sessionMonitorClose}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
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
      )}

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
              onViewSession={(sessionId, targetProjectId) => {
                onViewSession(sessionId, targetProjectId);
                closeMonitor();
              }}
              projectId={projectId}
              selectedSessionId={selectedSessionId}
              sessions={visibleSessions}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

async function resizeDesktopMonitorWindow(
  isOpen: boolean,
  shouldPosition: boolean,
): Promise<void> {
  const currentWindow = getCurrentWindow();
  const monitor = await primaryMonitor();
  const scaleFactor = monitor?.scaleFactor ?? 1;
  const workAreaPosition = monitor?.workArea.position ?? { x: 0, y: 0 };
  const workAreaSize = monitor?.workArea.size ?? {
    height: DESKTOP_EXPANDED_HEIGHT * scaleFactor,
    width: DESKTOP_EXPANDED_WIDTH * scaleFactor,
  };
  const width = isOpen ? DESKTOP_EXPANDED_WIDTH : DESKTOP_COLLAPSED_SIZE;
  const height = isOpen ? DESKTOP_EXPANDED_HEIGHT : DESKTOP_COLLAPSED_SIZE;
  const logicalWorkX = workAreaPosition.x / scaleFactor;
  const logicalWorkY = workAreaPosition.y / scaleFactor;
  const logicalWorkWidth = workAreaSize.width / scaleFactor;
  const logicalWorkHeight = workAreaSize.height / scaleFactor;

  await currentWindow.setSize(new LogicalSize(width, height));
  if (shouldPosition) {
    await currentWindow.setPosition(
      new LogicalPosition(
        logicalWorkX + logicalWorkWidth - width - DESKTOP_MARGIN,
        logicalWorkY + (logicalWorkHeight - height) / 2,
      ),
    );
  }
}

interface SessionMonitorRowsProps {
  locale: ReturnType<typeof useI18n>["locale"];
  messages: ReturnType<typeof useI18n>["messages"];
  onSelectSession: (sessionId: number) => void;
  onViewSession: (sessionId: number, projectId: number) => void;
  projectId?: number;
  selectedSessionId: number | null;
  sessions: AgentSessionListItem[];
}

function SessionMonitorRows({
  locale,
  messages,
  onSelectSession,
  onViewSession,
  projectId,
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
        const targetProjectId = session.projectId ?? projectId;
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
                disabled={targetProjectId == null}
                onClick={() => {
                  if (targetProjectId != null) {
                    onViewSession(session.sessionId, targetProjectId);
                  }
                }}
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
