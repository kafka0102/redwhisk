import { ChevronLeft, ChevronRight, LayoutGrid, Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  listAgentSessions,
  setAgentSessionAttention,
  type StartStandaloneAgentSessionResult,
  type AgentSessionListItem,
} from "./agent-session-commands";
import { CodexTerminal } from "./codex-terminal";
import { TemporarySessionDialog } from "./temporary-session-dialog";
import { markIssueReview } from "../issues/issue-commands";
import { toCommandError } from "../../shared/commands/command-error";

const SESSION_LIST_POLL_INTERVAL_MS = 1_500;

interface AgentsActivityProps {
  activeSessionId: number | null;
  onSelectSession?: (sessionId: number) => void;
  onOpenIssuesActivity?: (issueId: number) => void;
  projectId: number;
}

type DragPane = "info" | "sidebar";

function isCompletedSession(
  session: AgentSessionListItem,
): session is AgentSessionListItem & {
  status: "closed" | "crashed" | "stopped";
} {
  return (
    session.status === "closed" ||
    session.status === "crashed" ||
    session.status === "stopped"
  );
}

export function AgentsActivity({
  activeSessionId,
  onSelectSession,
  onOpenIssuesActivity,
  projectId,
}: AgentsActivityProps) {
  const defaultSidebarWidth = 200;
  const infoPaneDefaultWidth = defaultSidebarWidth;
  const infoPaneMinWidth = 200;
  const infoPaneMaxWidth = 420;
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attentionErrorMessage, setAttentionErrorMessage] = useState<
    string | null
  >(null);
  const [isUpdatingAttention, setIsUpdatingAttention] = useState(false);
  const [isMarkingReview, setIsMarkingReview] = useState(false);
  const [markReviewErrorMessage, setMarkReviewErrorMessage] = useState<
    string | null
  >(null);
  const [isTemporarySessionDialogOpen, setIsTemporarySessionDialogOpen] =
    useState(false);
  const [sessions, setSessions] = useState<AgentSessionListItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    activeSessionId,
  );
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth);
  const [infoPaneWidth, setInfoPaneWidth] = useState(infoPaneDefaultWidth);
  const [isInfoPaneCollapsed, setIsInfoPaneCollapsed] = useState(false);
  const dragStateRef = useRef<{
    pane: DragPane;
    startWidth: number;
    startX: number;
  } | null>(null);
  const newSessionButtonRef = useRef<HTMLButtonElement | null>(null);
  const reviewedIssueIdsRef = useRef<Set<number>>(new Set());

  const applySessionListOverlays = useCallback(
    (nextSessions: AgentSessionListItem[]) => {
      const reviewedIssueIds = reviewedIssueIdsRef.current;
      if (reviewedIssueIds.size === 0) {
        return nextSessions;
      }

      return nextSessions.map((session) =>
        session.issueId != null &&
        reviewedIssueIds.has(session.issueId) &&
        session.issueStatus === "running"
          ? { ...session, issueStatus: "review" as const }
          : session,
      );
    },
    [],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadSessions(showLoading: boolean) {
      if (showLoading) {
        setIsLoading(true);
      }
      setErrorMessage(null);

      try {
        const response = await listAgentSessions(projectId);
        if (!isMounted) {
          return;
        }

        setSessions(applySessionListOverlays(response.sessions));
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setErrorMessage(toCommandError(error).message);
      } finally {
        if (isMounted && showLoading) {
          setIsLoading(false);
        }
      }
    }

    void loadSessions(true);
    const intervalId = window.setInterval(
      () => void loadSessions(false),
      SESSION_LIST_POLL_INTERVAL_MS,
    );

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [applySessionListOverlays, projectId]);

  const runningSessions = sessions.filter(
    (session) => session.status === "running",
  );
  const completedSessions = sessions.filter(isCompletedSession);

  const currentSessionId =
    (sessions.some((session) => session.sessionId === selectedSessionId)
      ? selectedSessionId
      : null) ??
    runningSessions[0]?.sessionId ??
    completedSessions[0]?.sessionId ??
    null;

  const selectedSession =
    sessions.find((session) => session.sessionId === currentSessionId) ?? null;
  const linkedIssue =
    selectedSession?.issueId != null && selectedSession.issueTitle
      ? {
          issueId: selectedSession.issueId,
          issueTitle: selectedSession.issueTitle,
          issueStatus: selectedSession.issueStatus ?? null,
        }
      : null;
  const canMarkReview =
    selectedSession?.status === "running" &&
    linkedIssue?.issueStatus === "running";

  function handleSelectSession(sessionId: number) {
    setSelectedSessionId(sessionId);
    onSelectSession?.(sessionId);
  }

  function openTemporarySessionDialog() {
    setIsTemporarySessionDialogOpen(true);
  }

  function closeTemporarySessionDialog() {
    setIsTemporarySessionDialogOpen(false);
    window.requestAnimationFrame(() => {
      newSessionButtonRef.current?.focus();
    });
  }

  async function handleTemporarySessionStarted(
    result: StartStandaloneAgentSessionResult,
  ) {
    const response = await listAgentSessions(projectId);
    setSessions(applySessionListOverlays(response.sessions));
    setSelectedSessionId(result.sessionId);
    onSelectSession?.(result.sessionId);
  }

  async function handleSetAttention(attention: "none" | "requested") {
    if (selectedSession == null) {
      return;
    }

    setAttentionErrorMessage(null);
    setIsUpdatingAttention(true);

    try {
      await setAgentSessionAttention({
        projectId,
        sessionId: selectedSession.sessionId,
        attention,
      });
      const response = await listAgentSessions(projectId);
      setSessions(applySessionListOverlays(response.sessions));
    } catch (error) {
      setAttentionErrorMessage(toCommandError(error).message);
    } finally {
      setIsUpdatingAttention(false);
    }
  }

  async function handleMarkReview() {
    if (!linkedIssue) {
      return;
    }

    setMarkReviewErrorMessage(null);
    setIsMarkingReview(true);

    let reviewedIssueId: number | null = null;

    try {
      const reviewedIssue = await markIssueReview({
        projectId,
        issueId: linkedIssue.issueId,
      });
      reviewedIssueId = reviewedIssue.id;
      reviewedIssueIdsRef.current.add(reviewedIssue.id);
      setSessions((currentSessions) =>
        currentSessions.map((session) =>
          session.issueId === reviewedIssue.id
            ? {
                ...session,
                issueStatus: reviewedIssue.status,
                lastActiveAt: Math.max(
                  session.lastActiveAt,
                  reviewedIssue.updatedAt,
                ),
              }
            : session,
        ),
      );
    } catch (error) {
      setMarkReviewErrorMessage(toCommandError(error).message);
      try {
        const response = await listAgentSessions(projectId);
        setSessions(applySessionListOverlays(response.sessions));
      } catch {
        // Keep the command failure visible; polling can retry the refresh.
      }
    } finally {
      if (reviewedIssueId == null) {
        setIsMarkingReview(false);
      }
    }

    if (reviewedIssueId == null) {
      return;
    }

    try {
      const response = await listAgentSessions(projectId);
      setSessions(applySessionListOverlays(response.sessions));
    } catch (error) {
      setMarkReviewErrorMessage(toCommandError(error).message);
    } finally {
      setIsMarkingReview(false);
    }
  }

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }

      if (dragState.pane === "sidebar") {
        const deltaX = event.clientX - dragState.startX;
        const nextWidth = Math.max(
          200,
          Math.min(420, dragState.startWidth + deltaX),
        );
        setSidebarWidth(nextWidth);
        return;
      }

      const nextWidth = dragState.startWidth + dragState.startX - event.clientX;
      if (nextWidth <= 0) {
        setIsInfoPaneCollapsed(true);
        return;
      }

      setIsInfoPaneCollapsed(false);
      setInfoPaneWidth(
        Math.max(infoPaneMinWidth, Math.min(infoPaneMaxWidth, nextWidth)),
      );
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
          "--agents-info-pane-width":
            linkedIssue && !isInfoPaneCollapsed ? `${infoPaneWidth}px` : "0px",
          "--agents-info-splitter-width": linkedIssue ? "8px" : "0px",
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
              ref={newSessionButtonRef}
              type="button"
              onClick={openTemporarySessionDialog}
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
              onSelect={handleSelectSession}
              selectedSessionId={selectedSession?.sessionId ?? null}
              sessions={runningSessions}
            />
            <SessionGroup
              emptyCopy="No completed sessions."
              count={completedSessions.length}
              label="Completed"
              onSelect={handleSelectSession}
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
            pane: "sidebar",
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
        <div className="agents-terminal-pane">
          {selectedSession ? (
            <div className="agents-session-toolbar">
              <div className="agents-session-toolbar__copy">
                <p className="agents-session-toolbar__eyebrow">当前会话</p>
                <h3>{formatSessionTitle(selectedSession)}</h3>
              </div>
              <div className="agents-session-toolbar__actions">
                {canMarkReview ? (
                  <button
                    className="agents-session-toolbar__action"
                    disabled={isMarkingReview}
                    type="button"
                    onClick={() => void handleMarkReview()}
                  >
                    {isMarkingReview ? "更新中..." : "Mark Review"}
                  </button>
                ) : null}
                {selectedSession.status === "running" ? (
                  <button
                    className="agents-session-toolbar__action"
                    disabled={isUpdatingAttention}
                    type="button"
                    onClick={() =>
                      void handleSetAttention(
                        selectedSession.attention === "requested"
                          ? "none"
                          : "requested",
                      )
                    }
                  >
                    {isUpdatingAttention
                      ? "更新中..."
                      : selectedSession.attention === "requested"
                        ? "清除关注"
                        : "标记关注"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {markReviewErrorMessage ? (
            <p className="issues-status" role="status">
              {markReviewErrorMessage}
            </p>
          ) : null}
          {attentionErrorMessage ? (
            <p className="issues-status" role="status">
              {attentionErrorMessage}
            </p>
          ) : null}
          {selectedSession ? (
            <CodexTerminal
              projectId={projectId}
              sessionId={selectedSession.sessionId}
            />
          ) : (
            <p className="empty-state">
              Agent sessions will appear here after a session has been started
              for this project.
            </p>
          )}
        </div>

        {linkedIssue ? (
          <>
            <div
              aria-label="Resize session info"
              aria-orientation="vertical"
              aria-valuemax={infoPaneMaxWidth}
              aria-valuemin={0}
              aria-valuenow={isInfoPaneCollapsed ? 0 : infoPaneWidth}
              className="agents-info-splitter"
              role="separator"
              tabIndex={0}
              onMouseDown={(event) => {
                dragStateRef.current = {
                  pane: "info",
                  startWidth: isInfoPaneCollapsed ? 0 : infoPaneWidth,
                  startX: event.clientX,
                };
                window.document.body.style.cursor = "col-resize";
                window.document.body.style.userSelect = "none";
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  setIsInfoPaneCollapsed(false);
                  setInfoPaneWidth((currentWidth) =>
                    Math.min(infoPaneMaxWidth, currentWidth + 16),
                  );
                }

                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  if (isInfoPaneCollapsed) {
                    return;
                  }

                  setInfoPaneWidth((currentWidth) => {
                    if (currentWidth <= infoPaneMinWidth) {
                      setIsInfoPaneCollapsed(true);
                      return infoPaneMinWidth;
                    }

                    const nextWidth = Math.max(0, currentWidth - 16);
                    if (nextWidth === 0) {
                      setIsInfoPaneCollapsed(true);
                      return infoPaneMinWidth;
                    }

                    return Math.max(infoPaneMinWidth, nextWidth);
                  });
                }
              }}
            >
              <button
                aria-label={
                  isInfoPaneCollapsed
                    ? "Expand session info"
                    : "Collapse session info"
                }
                className="agents-info-toggle"
                type="button"
                onClick={() =>
                  setIsInfoPaneCollapsed((currentState) => !currentState)
                }
              >
                {isInfoPaneCollapsed ? (
                  <ChevronLeft aria-hidden="true" size={14} strokeWidth={1.8} />
                ) : (
                  <ChevronRight
                    aria-hidden="true"
                    size={14}
                    strokeWidth={1.8}
                  />
                )}
              </button>
            </div>

            {!isInfoPaneCollapsed ? (
              <aside className="agents-info-pane" aria-label="Linked issue">
                <p className="agents-info-pane__label">Issue</p>
                <button
                  className="issue-card agents-linked-issue-card"
                  disabled={!onOpenIssuesActivity}
                  type="button"
                  onClick={() => onOpenIssuesActivity?.(linkedIssue.issueId)}
                >
                  <span className="issue-card__meta-row">
                    <span className="issue-card__id">
                      {`#issue${linkedIssue.issueId}`}
                    </span>
                  </span>
                  <span className="issue-card__title">
                    {linkedIssue.issueTitle}
                  </span>
                  <span className="issue-card__description">
                    Open this issue in the issues board.
                  </span>
                </button>
              </aside>
            ) : null}
          </>
        ) : null}
      </section>

      {isTemporarySessionDialogOpen ? (
        <TemporarySessionDialog
          projectId={projectId}
          onClose={closeTemporarySessionDialog}
          onStarted={handleTemporarySessionStarted}
        />
      ) : null}
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
              <span className="agents-session-row__header">
                <span
                  aria-label={`Session 状态：${formatSessionStatusLabel(session)}`}
                  className={buildSessionStatusDotClassName(session)}
                />
                <span className="agents-session-row__title">
                  {formatSessionTitle(session)}
                </span>
              </span>
              <span className="agents-session-row__meta">
                <span className="agents-session-row__meta-main">
                  {formatAgentType(session.agentType)}
                </span>
                <span className="sr-only">{`，${formatSessionStatusLabel(session)}`}</span>
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

function buildSessionStatusDotClassName(session: AgentSessionListItem): string {
  const tone =
    session.attention === "requested"
      ? "attention"
      : session.status === "running"
        ? "running"
        : "completed";

  return `agents-session-row__status-dot agents-session-row__status-dot--${tone}`;
}

function formatSessionStatusLabel(session: AgentSessionListItem): string {
  if (session.attention === "requested") {
    return "需要确认";
  }

  if (session.status === "running") {
    return "运行中";
  }

  return "已结束";
}
