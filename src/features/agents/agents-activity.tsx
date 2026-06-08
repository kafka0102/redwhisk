import { ChevronLeft, ChevronRight, LayoutGrid, Plus } from "lucide-react";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  useCallback,
  useEffect,
  useMemo,
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
import { IssueInspector } from "./issue-inspector";
import { markIssueReview, type IssueRecord } from "../issues/issue-commands";
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
  const [sessionActionErrorMessage, setSessionActionErrorMessage] = useState<
    string | null
  >(null);
  const [isUpdatingAttention, setIsUpdatingAttention] = useState(false);
  const [isMarkingReview, setIsMarkingReview] = useState(false);
  const [isOpeningLog, setIsOpeningLog] = useState(false);
  const [markReviewErrorMessage, setMarkReviewErrorMessage] = useState<
    string | null
  >(null);
  const [isTemporarySessionDialogOpen, setIsTemporarySessionDialogOpen] =
    useState(false);
  const [sessions, setSessions] = useState<AgentSessionListItem[]>([]);
  const [viewedSessionActivity, setViewedSessionActivity] = useState<
    Record<number, number>
  >({});
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    activeSessionId,
  );
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth);
  const [infoPaneWidth, setInfoPaneWidth] = useState(infoPaneDefaultWidth);
  const [openInspectorIssueId, setOpenInspectorIssueId] = useState<
    number | null
  >(null);
  const dragStateRef = useRef<{
    pane: DragPane;
    startWidth: number;
    startX: number;
  } | null>(null);
  const newSessionButtonRef = useRef<HTMLButtonElement | null>(null);
  const reviewedIssueIdsRef = useRef<Set<number>>(new Set());
  const issueTitleButtonRef = useRef<HTMLButtonElement | null>(null);
  const inspectorPaneRef = useRef<HTMLElement | null>(null);
  const infoSplitterRef = useRef<HTMLDivElement | null>(null);

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
  const linkedIssue = useMemo(
    () =>
      selectedSession?.issueId != null && selectedSession.issueTitle
        ? {
            issueId: selectedSession.issueId,
            issueTitle: selectedSession.issueTitle,
            issueStatus: selectedSession.issueStatus ?? null,
          }
        : null,
    [selectedSession],
  );
  const isInspectorOpen =
    linkedIssue != null && openInspectorIssueId === linkedIssue.issueId;
  const canMarkReview =
    selectedSession?.status === "running" &&
    linkedIssue?.issueStatus === "running";
  const canOpenLog =
    selectedSession?.status === "crashed" &&
    selectedSession.logPath != null &&
    selectedSession.logPath.length > 0;

  useEffect(() => {
    if (!isInspectorOpen) {
      return;
    }

    function closeInspector() {
      setOpenInspectorIssueId(null);
      window.requestAnimationFrame(() => {
        issueTitleButtonRef.current?.focus();
      });
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (inspectorPaneRef.current?.contains(target)) {
        return;
      }

      if (issueTitleButtonRef.current?.contains(target)) {
        return;
      }

      if (infoSplitterRef.current?.contains(target)) {
        return;
      }

      closeInspector();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      closeInspector();
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isInspectorOpen]);

  function markSessionViewed(session: AgentSessionListItem) {
    if (session.status !== "running" || session.attention !== "none") {
      return;
    }

    setViewedSessionActivity((currentViewedSessionActivity) => ({
      ...currentViewedSessionActivity,
      [session.sessionId]: session.lastActiveAt,
    }));
  }

  async function acknowledgeSessionAttention(sessionId: number) {
    const targetSession = sessions.find(
      (session) => session.sessionId === sessionId,
    );
    if (targetSession == null || targetSession.status !== "running") {
      return;
    }

    if (targetSession.attention === "requested") {
      if (isUpdatingAttention) {
        return;
      }

      setAttentionErrorMessage(null);
      setIsUpdatingAttention(true);

      try {
        await setAgentSessionAttention({
          projectId,
          sessionId,
          attention: "none",
        });
        const response = await listAgentSessions(projectId);
        const nextSessions = applySessionListOverlays(response.sessions);
        setSessions(nextSessions);
        const refreshedSession = nextSessions.find(
          (session) => session.sessionId === sessionId,
        );
        if (refreshedSession) {
          markSessionViewed(refreshedSession);
        }
      } catch (error) {
        setAttentionErrorMessage(toCommandError(error).message);
      } finally {
        setIsUpdatingAttention(false);
      }

      return;
    }

    markSessionViewed(targetSession);
  }

  function handleSelectSession(sessionId: number) {
    setSelectedSessionId(sessionId);
    onSelectSession?.(sessionId);
    void acknowledgeSessionAttention(sessionId);
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

  async function handleOpenLog() {
    if (!selectedSession?.logPath || isOpeningLog) {
      return;
    }

    setSessionActionErrorMessage(null);
    setIsOpeningLog(true);

    try {
      await openPath(selectedSession.logPath);
    } catch (error) {
      setSessionActionErrorMessage(toCommandError(error).message);
    } finally {
      setIsOpeningLog(false);
    }
  }

  function handleToggleInspector() {
    if (!linkedIssue) {
      return;
    }

    setOpenInspectorIssueId((currentIssueId) =>
      currentIssueId === linkedIssue.issueId ? null : linkedIssue.issueId,
    );
  }

  function handleCloseInspector() {
    setOpenInspectorIssueId(null);
    window.requestAnimationFrame(() => {
      issueTitleButtonRef.current?.focus();
    });
  }

  function handleInspectorIssueUpdated(updatedIssue: IssueRecord) {
    setSessions((currentSessions) =>
      currentSessions.map((session) =>
        session.issueId === updatedIssue.id
          ? {
              ...session,
              issueTitle: updatedIssue.title,
              issueStatus: updatedIssue.status,
              lastActiveAt: Math.max(
                session.lastActiveAt,
                updatedIssue.updatedAt,
              ),
            }
          : session,
      ),
    );
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
        setOpenInspectorIssueId(null);
        return;
      }

      if (linkedIssue) {
        setOpenInspectorIssueId(linkedIssue.issueId);
      }
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
  }, [linkedIssue]);

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

  return (
    <main
      className="activity-surface activity-surface--agents"
      style={
        {
          "--agents-sidebar-width": `${sidebarWidth}px`,
          "--agents-info-pane-width": isInspectorOpen
            ? `${infoPaneWidth}px`
            : "0px",
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
              viewedSessionActivity={viewedSessionActivity}
            />
            <SessionGroup
              emptyCopy="No completed sessions."
              count={completedSessions.length}
              label="Completed"
              onSelect={handleSelectSession}
              selectedSessionId={selectedSession?.sessionId ?? null}
              sessions={completedSessions}
              viewedSessionActivity={viewedSessionActivity}
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
                {linkedIssue ? (
                  <h3 aria-label={linkedIssue.issueTitle}>
                    <button
                      ref={issueTitleButtonRef}
                      aria-expanded={isInspectorOpen}
                      className="agents-session-toolbar__issue-button"
                      type="button"
                      onClick={handleToggleInspector}
                    >
                      <span className="agents-session-toolbar__issue-id">
                        {`#issue${linkedIssue.issueId}`}
                      </span>
                      <span className="agents-session-toolbar__issue-title">
                        {linkedIssue.issueTitle}
                      </span>
                    </button>
                  </h3>
                ) : (
                  <h3>{formatSessionTitle(selectedSession)}</h3>
                )}
                {shouldShowExplicitSessionStatus(selectedSession) ? (
                  <p className="agents-session-toolbar__status">{`Status: ${formatSessionStatusLabel(
                    selectedSession,
                    viewedSessionActivity,
                  )}`}</p>
                ) : null}
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
                {canOpenLog ? (
                  <button
                    className="agents-session-toolbar__action"
                    disabled={isOpeningLog}
                    type="button"
                    onClick={() => void handleOpenLog()}
                  >
                    {isOpeningLog ? "打开中..." : "Open Log"}
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
          {sessionActionErrorMessage ? (
            <p className="issues-status" role="status">
              {sessionActionErrorMessage}
            </p>
          ) : null}
          <div
            onMouseDown={() => {
              if (selectedSession) {
                void acknowledgeSessionAttention(selectedSession.sessionId);
              }
            }}
          >
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
        </div>

        {linkedIssue ? (
          <>
            <div
              ref={infoSplitterRef}
              aria-label="Resize session info"
              aria-orientation="vertical"
              aria-valuemax={infoPaneMaxWidth}
              aria-valuemin={0}
              aria-valuenow={isInspectorOpen ? infoPaneWidth : 0}
              className="agents-info-splitter"
              role="separator"
              tabIndex={0}
              onMouseDown={(event) => {
                dragStateRef.current = {
                  pane: "info",
                  startWidth: isInspectorOpen ? infoPaneWidth : 0,
                  startX: event.clientX,
                };
                window.document.body.style.cursor = "col-resize";
                window.document.body.style.userSelect = "none";
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  if (linkedIssue) {
                    setOpenInspectorIssueId(linkedIssue.issueId);
                  }
                  setInfoPaneWidth((currentWidth) =>
                    Math.min(infoPaneMaxWidth, currentWidth + 16),
                  );
                }

                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  if (!isInspectorOpen) {
                    return;
                  }

                  setInfoPaneWidth((currentWidth) => {
                    if (currentWidth <= infoPaneMinWidth) {
                      setOpenInspectorIssueId(null);
                      return infoPaneMinWidth;
                    }

                    const nextWidth = Math.max(0, currentWidth - 16);
                    if (nextWidth === 0) {
                      setOpenInspectorIssueId(null);
                      return infoPaneMinWidth;
                    }

                    return Math.max(infoPaneMinWidth, nextWidth);
                  });
                }
              }}
            >
              <button
                aria-label={
                  isInspectorOpen
                    ? "Collapse issue inspector"
                    : "Expand issue inspector"
                }
                className="agents-info-toggle"
                type="button"
                onClick={handleToggleInspector}
              >
                {!isInspectorOpen ? (
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

            {isInspectorOpen && selectedSession ? (
              <aside
                ref={inspectorPaneRef}
                className="agents-info-pane"
                aria-label="Issue Inspector"
              >
                <IssueInspector
                  issueId={linkedIssue.issueId}
                  issueTitle={linkedIssue.issueTitle}
                  linkedSessionId={selectedSession.sessionId}
                  linkedSessionStatus={selectedSession.status}
                  projectId={projectId}
                  onClose={handleCloseInspector}
                  onIssueUpdated={handleInspectorIssueUpdated}
                  onOpenIssuesActivity={onOpenIssuesActivity}
                />
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
  viewedSessionActivity: Record<number, number>;
}

function SessionGroup({
  count,
  emptyCopy,
  label,
  onSelect,
  selectedSessionId,
  sessions,
  viewedSessionActivity,
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
                {shouldShowSessionStatusDot(session) ? (
                  <span
                    aria-label={`Session 状态：${formatSessionStatusLabel(session, viewedSessionActivity)}`}
                    className={buildSessionStatusDotClassName(
                      session,
                      viewedSessionActivity,
                    )}
                  />
                ) : null}
                <span className="agents-session-row__title">
                  {formatSessionTitle(session)}
                </span>
              </span>
              <span className="agents-session-row__meta">
                <span className="agents-session-row__meta-main">
                  {formatAgentType(session.agentType)}
                </span>
                {shouldShowExplicitSessionStatus(session) ? (
                  <span className="agents-session-row__meta-status">
                    {formatSessionStatusLabel(session, viewedSessionActivity)}
                  </span>
                ) : null}
                <span className="sr-only">{`，${formatSessionStatusLabel(session, viewedSessionActivity)}`}</span>
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

function shouldShowSessionStatusDot(session: AgentSessionListItem): boolean {
  return session.status === "running";
}

function buildSessionStatusDotClassName(
  session: AgentSessionListItem,
  viewedSessionActivity: Record<number, number>,
): string {
  const tone =
    session.attention === "requested"
      ? "attention"
      : session.status === "running"
        ? isViewedSession(session, viewedSessionActivity)
          ? "viewed"
          : "running"
        : "completed";

  return `agents-session-row__status-dot agents-session-row__status-dot--${tone}`;
}

function formatSessionStatusLabel(
  session: AgentSessionListItem,
  viewedSessionActivity: Record<number, number>,
): string {
  if (session.attention === "requested") {
    return "需要确认";
  }

  if (session.status === "running") {
    if (isViewedSession(session, viewedSessionActivity)) {
      return "已查看";
    }

    return "运行中";
  }

  switch (session.status) {
    case "crashed":
      return "crashed";
    case "stopped":
      return "stopped";
    case "closed":
      return "closed";
    default:
      return "closed";
  }
}

function shouldShowExplicitSessionStatus(session: AgentSessionListItem): boolean {
  return session.status === "crashed";
}

function isViewedSession(
  session: AgentSessionListItem,
  viewedSessionActivity: Record<number, number>,
): boolean {
  const viewedAt = viewedSessionActivity[session.sessionId];
  return viewedAt != null && viewedAt >= session.lastActiveAt;
}
