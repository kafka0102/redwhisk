import { LayoutGrid, Plus } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import {
  listAgentSessions,
  type AgentSessionListItem,
} from "./agent-session-commands";
import { toCommandError } from "../../shared/commands/command-error";

interface AgentsActivityProps {
  activeSessionId: number | null;
  onOpenIssuesActivity?: (issueId: number) => void;
  projectId: number;
}

export function AgentsActivity({
  activeSessionId,
  onOpenIssuesActivity,
  projectId,
}: AgentsActivityProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSessionListItem[]>([]);
  const [manuallySelectedSessionId, setManuallySelectedSessionId] = useState<
    number | null
  >(null);
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const dragStateRef = useRef<{
    startWidth: number;
    startX: number;
  } | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSessions() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await listAgentSessions(projectId);
        if (!isMounted) {
          return;
        }

        setSessions(response.sessions);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setSessions([]);
        setErrorMessage(toCommandError(error).message);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadSessions();

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  const runningSessions = sessions.filter(
    (session) => session.status === "running",
  );
  const completedSessions = sessions.filter(
    (session) => session.status !== "running",
  );

  const selectedSessionId =
    activeSessionId ??
    (sessions.some((session) => session.sessionId === manuallySelectedSessionId)
      ? manuallySelectedSessionId
      : null) ??
    runningSessions[0]?.sessionId ??
    completedSessions[0]?.sessionId ??
    null;

  const selectedSession =
    sessions.find((session) => session.sessionId === selectedSessionId) ?? null;

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }

      const deltaX = event.clientX - dragState.startX;
      const nextWidth = Math.max(200, Math.min(420, dragState.startWidth + deltaX));
      setSidebarWidth(nextWidth);
    }

    function handleMouseUp() {
      dragStateRef.current = null;
      window.document.body.style.cursor = "";
      window.document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.document.body.style.cursor = "";
      window.document.body.style.userSelect = "";
    };
  }, []);

  return (
    <main
      className="activity-surface activity-surface--agents"
      style={
        {
          "--agents-sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <aside className="agents-sidebar" aria-label="Agent sessions">
        <div className="agents-sidebar__header">
          <div className="agents-sidebar__header-main">
            <h2>Agents</h2>
          </div>
          <div
            className="agents-sidebar__toolbar"
            aria-label="Session list controls"
          >
            <button
              aria-label="Session list view"
              className="agents-toolbar-button"
              disabled
              type="button"
            >
              <LayoutGrid aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
            <button
              aria-label="New session"
              className="agents-toolbar-button"
              disabled
              type="button"
            >
              <Plus aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        {errorMessage ? (
          <p className="issues-status" role="status" aria-label="Agents status">
            {errorMessage}
          </p>
        ) : null}
        {isLoading ? (
          <p className="issues-loading" role="status">
            Loading sessions...
          </p>
        ) : null}

        {!isLoading && !errorMessage ? (
          <div className="agents-groups">
            <SessionGroup
              emptyCopy="No running sessions."
              count={runningSessions.length}
              label="Running"
              onSelect={setManuallySelectedSessionId}
              selectedSessionId={selectedSession?.sessionId ?? null}
              sessions={runningSessions}
            />
            <SessionGroup
              emptyCopy="No completed sessions."
              count={completedSessions.length}
              label="Completed"
              onSelect={setManuallySelectedSessionId}
              selectedSessionId={selectedSession?.sessionId ?? null}
              sessions={completedSessions}
            />
          </div>
        ) : null}
      </aside>

      <div
        aria-label="Resize session list"
        aria-orientation="vertical"
        aria-valuemax={420}
        aria-valuemin={200}
        aria-valuenow={sidebarWidth}
        className="agents-splitter"
        role="separator"
        tabIndex={0}
        onMouseDown={(event) => {
          dragStateRef.current = {
            startWidth: sidebarWidth,
            startX: event.clientX,
          };
          window.document.body.style.cursor = "col-resize";
          window.document.body.style.userSelect = "none";
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            setSidebarWidth((currentWidth) => Math.max(200, currentWidth - 16));
          }

          if (event.key === "ArrowRight") {
            event.preventDefault();
            setSidebarWidth((currentWidth) => Math.min(420, currentWidth + 16));
          }
        }}
      />

      <section className="agents-workspace" aria-label="Session workspace">
        {selectedSession &&
        selectedSession.issueId != null &&
        selectedSession.issueTitle ? (
          <header className="agents-header">
            <div>
              <p className="eyebrow">Linked Issue</p>
              <h3>{selectedSession.issueTitle}</h3>
            </div>
            <Button
              className="issues-button"
              type="button"
              variant="outline"
              disabled={!onOpenIssuesActivity}
              onClick={() => onOpenIssuesActivity?.(selectedSession.issueId!)}
            >
              Open in Issues
            </Button>
          </header>
        ) : null}

        <div className="agents-terminal-placeholder">
          {selectedSession ? (
            <>
              <div className="agents-terminal-placeholder__meta">
                <p className="eyebrow">Selected Session</p>
                <h3>{formatSessionTitle(selectedSession)}</h3>
              </div>
              <dl className="agents-terminal-placeholder__facts">
                <div>
                  <dt>Agent</dt>
                  <dd>{formatAgentType(selectedSession.agentType)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{formatSessionStatus(selectedSession.status)}</dd>
                </div>
                <div>
                  <dt>Last active</dt>
                  <dd>{formatLocalTimestamp(selectedSession.lastActiveAt)}</dd>
                </div>
              </dl>
              <p className="empty-state">
                Codex Session terminal for this session arrives in Story 2.6.
              </p>
            </>
          ) : (
            <p className="empty-state">
              Agent sessions will appear here after a session has been started
              for this project.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

interface SessionGroupProps {
  count: number;
  emptyCopy: string;
  label: string;
  onSelect: (sessionId: number) => void;
  selectedSessionId: number | null;
  sessions: AgentSessionListItem[];
}

function SessionGroup({
  count,
  emptyCopy,
  label,
  onSelect,
  selectedSessionId,
  sessions,
}: SessionGroupProps) {
  return (
    <section aria-label={`${label} sessions`} className="agents-group">
      <div className="agents-group__header">
        <h3>{`${label}(${count})`}</h3>
      </div>
      {sessions.length === 0 ? (
        <p className="agents-group__empty">{emptyCopy}</p>
      ) : (
        <div className="agents-session-list">
          {sessions.map((session) => (
            <button
              key={session.sessionId}
              aria-pressed={selectedSessionId === session.sessionId}
              className="agents-session-row"
              type="button"
              onClick={() => onSelect(session.sessionId)}
            >
              <span className="agents-session-row__title">
                {formatSessionTitle(session)}
              </span>
              <span className="agents-session-row__meta">
                {`${formatAgentType(session.agentType)} · ${formatSessionStatus(session.status)}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function formatSessionTitle(session: AgentSessionListItem): string {
  return session.issueTitle ?? session.title ?? `Session #${session.sessionId}`;
}

function formatAgentType(agentType: AgentSessionListItem["agentType"]): string {
  switch (agentType) {
    case "codex":
      return "Codex";
    default:
      return agentType;
  }
}

function formatSessionStatus(status: AgentSessionListItem["status"]): string {
  switch (status) {
    case "running":
      return "running";
    case "closed":
      return "closed";
    case "crashed":
      return "crashed";
    case "stopped":
      return "stopped";
    default:
      return status;
  }
}

function formatLocalTimestamp(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toLocaleString();
}
