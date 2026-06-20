import {
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  LoaderCircle,
  Plus,
} from "lucide-react";
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
  type StartStructuredAgentSessionResult,
  type AgentSessionListItem,
} from "./agent-session-commands";
import {
  DEFAULT_ACTIVITY_SIDEBAR_WIDTH,
  SIDEBAR_RESIZE_STEP,
} from "../../shared/layout/sidebar-width";
import { formatAgentTypeLabel, getAgentLogoSrc } from "./agent-visuals";
import { AgentSessionView } from "./agent-session-view";
import { TemporarySessionDialog } from "./temporary-session-dialog";
import { IssueSummaryDialog } from "../issues/issue-summary-dialog";
import {
  completeIssueClean,
  completeIssueManual,
  detectAgentCommitCompletion,
  listIssues,
  markIssueReview,
  prepareAgentCommitCompletion,
  sendAgentCommitPrompt,
  type AgentCommitCompletionPreview,
  type IssueRecord,
} from "../issues/issue-commands";
import { toCommandError } from "../../shared/commands/command-error";
import type { ProjectCompletionPolicy } from "../project/project-commands";
import { useI18n } from "../../shared/i18n/i18n";

const SESSION_LIST_POLL_INTERVAL_MS = 1_500;
const AGENTS_SIDEBAR_DEFAULT_WIDTH = DEFAULT_ACTIVITY_SIDEBAR_WIDTH;
const AGENTS_SIDEBAR_MIN_WIDTH = DEFAULT_ACTIVITY_SIDEBAR_WIDTH;
const AGENTS_SIDEBAR_MAX_WIDTH = 450;

interface AgentsActivityProps {
  activeSessionId: number | null;
  onSelectSession?: (sessionId: number) => void;
  projectCompletionPolicy?: ProjectCompletionPolicy;
  projectId: number;
}

type SessionIssueGroup = "inProcess" | "review" | "done";
type SessionIssueTransition = "review" | "done";

export function AgentsActivity({
  activeSessionId,
  onSelectSession,
  projectCompletionPolicy = "manual",
  projectId,
}: AgentsActivityProps) {
  const { messages } = useI18n();
  const defaultSidebarWidth = AGENTS_SIDEBAR_DEFAULT_WIDTH;
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attentionErrorMessage, setAttentionErrorMessage] = useState<
    string | null
  >(null);
  const [isUpdatingAttention, setIsUpdatingAttention] = useState(false);
  const [isMarkingReview, setIsMarkingReview] = useState(false);
  const [isCompletingManual, setIsCompletingManual] = useState(false);
  const [isCompletingClean, setIsCompletingClean] = useState(false);
  const [isPreparingAgentCommit, setIsPreparingAgentCommit] = useState(false);
  const [isSendingAgentCommitPrompt, setIsSendingAgentCommitPrompt] =
    useState(false);
  const [
    isDetectingAgentCommitCompletion,
    setIsDetectingAgentCommitCompletion,
  ] = useState(false);
  const [markReviewErrorMessage, setMarkReviewErrorMessage] = useState<
    string | null
  >(null);
  const [completeManualErrorMessage, setCompleteManualErrorMessage] = useState<
    string | null
  >(null);
  const [completeCleanErrorMessage, setCompleteCleanErrorMessage] = useState<
    string | null
  >(null);
  const [completeAgentCommitErrorMessage, setCompleteAgentCommitErrorMessage] =
    useState<string | null>(null);
  const [agentCommitPreview, setAgentCommitPreview] =
    useState<AgentCommitCompletionPreview | null>(null);
  const [isTemporarySessionDialogOpen, setIsTemporarySessionDialogOpen] =
    useState(false);
  const [summaryIssueId, setSummaryIssueId] = useState<number | null>(null);
  const [isIssueDrawerOpen, setIsIssueDrawerOpen] = useState(false);
  const [isTransitionMenuOpen, setIsTransitionMenuOpen] = useState(false);
  const [sessions, setSessions] = useState<AgentSessionListItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    activeSessionId,
  );
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth);
  const dragStateRef = useRef<{
    startWidth: number;
    startX: number;
  } | null>(null);
  const newSessionButtonRef = useRef<HTMLButtonElement | null>(null);
  const reviewedIssueIdsRef = useRef<Set<number>>(new Set());
  const completedIssueIdsRef = useRef<Set<number>>(new Set());
  const closedSessionIdsRef = useRef<Set<number>>(new Set());

  const applySessionListOverlays = useCallback(
    (nextSessions: AgentSessionListItem[]) => {
      const reviewedIssueIds = reviewedIssueIdsRef.current;
      const completedIssueIds = completedIssueIdsRef.current;
      const closedSessionIds = closedSessionIdsRef.current;
      if (
        reviewedIssueIds.size === 0 &&
        completedIssueIds.size === 0 &&
        closedSessionIds.size === 0
      ) {
        return nextSessions;
      }

      return nextSessions.map((session) =>
        applySessionOverlay(
          session,
          reviewedIssueIds,
          completedIssueIds,
          closedSessionIds,
        ),
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

  const sessionsByGroup = useMemo(
    () =>
      [
        {
          key: "inProcess" as const,
          label: messages.agentsFeature.inProgress,
          emptyCopy: messages.agentsFeature.noInProgressSessions,
        },
        {
          key: "review" as const,
          label: messages.agentsFeature.review,
          emptyCopy: messages.agentsFeature.noReviewSessions,
        },
        {
          key: "done" as const,
          label: messages.agentsFeature.done,
          emptyCopy: messages.agentsFeature.noDoneSessions,
        },
      ].map((group) => ({
        ...group,
        sessions: sessions.filter(
          (session) => getSessionIssueGroup(session) === group.key,
        ),
      })),
    [
      messages.agentsFeature.done,
      messages.agentsFeature.inProgress,
      messages.agentsFeature.noDoneSessions,
      messages.agentsFeature.noInProgressSessions,
      messages.agentsFeature.noReviewSessions,
      messages.agentsFeature.review,
      sessions,
    ],
  );

  const currentSessionId =
    (sessions.some((session) => session.sessionId === selectedSessionId)
      ? selectedSessionId
      : null) ??
    sessionsByGroup[0]?.sessions[0]?.sessionId ??
    sessionsByGroup[1]?.sessions[0]?.sessionId ??
    sessionsByGroup[2]?.sessions[0]?.sessionId ??
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
  const sessionTransitionPhase = getSessionTransitionPhase(selectedSession);
  const transitionButtonLabel =
    sessionTransitionPhase === "running"
      ? "Mark review"
      : sessionTransitionPhase === "review"
        ? "Mark done"
        : null;
  const transitionMenuOptions =
    sessionTransitionPhase === "running"
      ? ([
          { action: "review", label: "Review" },
          { action: "done", label: "Done" },
        ] satisfies Array<{
          action: SessionIssueTransition;
          label: string;
        }>)
      : [];
  const canRenderTransitionButton = transitionButtonLabel !== null;
  const canRenderTransitionMenu = transitionMenuOptions.length > 0;
  const isTransitionPending =
    isMarkingReview ||
    isCompletingManual ||
    isCompletingClean ||
    isPreparingAgentCommit ||
    isSendingAgentCommitPrompt ||
    isDetectingAgentCommitCompletion;
  const canViewSummary = linkedIssue?.issueStatus === "completed";

  const refreshSessions = useCallback(async () => {
    const response = await listAgentSessions(projectId);
    const nextSessions = applySessionListOverlays(response.sessions);
    setSessions(nextSessions);
    return nextSessions;
  }, [applySessionListOverlays, projectId]);

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
      } catch (error) {
        setAttentionErrorMessage(toCommandError(error).message);
      } finally {
        setIsUpdatingAttention(false);
      }

      return;
    }
  }

  function handleSelectSession(sessionId: number) {
    setIsTransitionMenuOpen(false);
    setSelectedSessionId(sessionId);
    onSelectSession?.(sessionId);
    void acknowledgeSessionAttention(sessionId);
  }

  async function markLinkedIssueReview(issue: NonNullable<typeof linkedIssue>) {
    setIsTransitionMenuOpen(false);
    setCompleteManualErrorMessage(null);
    setCompleteCleanErrorMessage(null);
    setCompleteAgentCommitErrorMessage(null);
    setMarkReviewErrorMessage(null);
    setIsMarkingReview(true);

    let reviewedIssueId: number | null = null;

    try {
      const reviewedIssue = await markIssueReview({
        projectId,
        issueId: issue.issueId,
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
        await refreshSessions();
      } catch {
        // Keep the command failure visible; polling can retry the refresh.
      }
    } finally {
      if (reviewedIssueId == null) {
        setIsMarkingReview(false);
      }
    }

    if (reviewedIssueId == null) {
      return null;
    }

    try {
      return await refreshSessions();
    } catch (error) {
      setMarkReviewErrorMessage(toCommandError(error).message);
      return null;
    } finally {
      setIsMarkingReview(false);
    }
  }

  async function handleMarkReview() {
    if (!linkedIssue) {
      return;
    }

    await markLinkedIssueReview(linkedIssue);
  }

  async function completeLinkedIssueManual(
    issue: NonNullable<typeof linkedIssue>,
    session: AgentSessionListItem,
  ) {
    const targetSessionId = session.sessionId;
    setIsTransitionMenuOpen(false);
    setCompleteManualErrorMessage(null);
    setIsCompletingManual(true);

    let completedIssueId: number | null = null;
    let completedSessionId: number | null = null;

    try {
      const completedIssue = await completeIssueManual({
        projectId,
        issueId: issue.issueId,
      });
      completedIssueId = completedIssue.id;
      completedSessionId = session.sessionId;
      completedIssueIdsRef.current.add(completedIssue.id);
      closedSessionIdsRef.current.add(session.sessionId);
      setSessions((currentSessions) =>
        currentSessions.map((session) =>
          session.issueId === completedIssue.id
            ? {
                ...session,
                status:
                  session.sessionId === targetSessionId
                    ? ("closed" as const)
                    : session.status,
                issueStatus: completedIssue.status,
                lastActiveAt: Math.max(
                  session.lastActiveAt,
                  completedIssue.updatedAt,
                ),
                closedAt:
                  session.sessionId === targetSessionId
                    ? Math.max(session.closedAt ?? 0, completedIssue.updatedAt)
                    : session.closedAt,
              }
            : session,
        ),
      );
    } catch (error) {
      setCompleteManualErrorMessage(toCommandError(error).message);
      try {
        await refreshSessions();
      } catch {
        // Keep the command failure visible; polling can retry the refresh.
      }
    } finally {
      if (completedIssueId == null) {
        setIsCompletingManual(false);
      }
    }

    if (completedIssueId == null || completedSessionId == null) {
      return;
    }

    try {
      await refreshSessions();
    } catch (error) {
      setCompleteManualErrorMessage(toCommandError(error).message);
    } finally {
      setIsCompletingManual(false);
    }
  }

  async function completeLinkedIssueClean(
    issue: NonNullable<typeof linkedIssue>,
    session: AgentSessionListItem,
  ) {
    const targetSessionId = session.sessionId;
    setIsTransitionMenuOpen(false);
    setCompleteCleanErrorMessage(null);
    setIsCompletingClean(true);

    let completedIssueId: number | null = null;
    let completedSessionId: number | null = null;

    try {
      const completedIssue = await completeIssueClean({
        projectId,
        issueId: issue.issueId,
      });
      completedIssueId = completedIssue.id;
      completedSessionId = session.sessionId;
      completedIssueIdsRef.current.add(completedIssue.id);
      closedSessionIdsRef.current.add(session.sessionId);
      setSessions((currentSessions) =>
        currentSessions.map((session) =>
          session.issueId === completedIssue.id
            ? {
                ...session,
                status:
                  session.sessionId === targetSessionId
                    ? ("closed" as const)
                    : session.status,
                issueStatus: completedIssue.status,
                lastActiveAt: Math.max(
                  session.lastActiveAt,
                  completedIssue.updatedAt,
                ),
                closedAt:
                  session.sessionId === targetSessionId
                    ? Math.max(session.closedAt ?? 0, completedIssue.updatedAt)
                    : session.closedAt,
              }
            : session,
        ),
      );
    } catch (error) {
      setCompleteCleanErrorMessage(toCommandError(error).message);
      try {
        await refreshSessions();
      } catch {
        // Keep the command failure visible; polling can retry the refresh.
      }
    } finally {
      if (completedIssueId == null) {
        setIsCompletingClean(false);
      }
    }

    if (completedIssueId == null || completedSessionId == null) {
      return;
    }

    try {
      await refreshSessions();
    } catch (error) {
      setCompleteCleanErrorMessage(toCommandError(error).message);
    } finally {
      setIsCompletingClean(false);
    }
  }

  async function prepareLinkedIssueAgentCommit(
    issue: NonNullable<typeof linkedIssue>,
  ) {
    setIsTransitionMenuOpen(false);
    setCompleteAgentCommitErrorMessage(null);
    setIsPreparingAgentCommit(true);

    try {
      const preview = await prepareAgentCommitCompletion({
        projectId,
        issueId: issue.issueId,
      });
      setAgentCommitPreview(preview);
    } catch (error) {
      setCompleteAgentCommitErrorMessage(toCommandError(error).message);
    } finally {
      setIsPreparingAgentCommit(false);
    }
  }

  async function handleMarkDone() {
    if (!linkedIssue || !selectedSession) {
      return;
    }

    const currentSession =
      sessions.find(
        (session) => session.sessionId === selectedSession.sessionId,
      ) ?? selectedSession;
    let nextSession = currentSession;

    if (currentSession.issueStatus === "running") {
      const refreshedSessions = await markLinkedIssueReview(linkedIssue);
      if (!refreshedSessions) {
        return;
      }

      nextSession = refreshedSessions.find(
        (session) => session.sessionId === currentSession.sessionId,
      ) ?? { ...currentSession, issueStatus: "review" as const };
    }

    if (projectCompletionPolicy === "manual") {
      await completeLinkedIssueManual(linkedIssue, nextSession);
      return;
    }

    if (nextSession.canCompleteClean) {
      await completeLinkedIssueClean(linkedIssue, nextSession);
      return;
    }

    if (nextSession.canCompleteAgentCommit) {
      await prepareLinkedIssueAgentCommit(linkedIssue);
    }
  }

  async function handleTransitionAction(action: SessionIssueTransition) {
    if (action === "review") {
      await handleMarkReview();
      return;
    }

    await handleMarkDone();
  }

  function handleCloseAgentCommitPreview() {
    if (isSendingAgentCommitPrompt || isDetectingAgentCommitCompletion) {
      return;
    }
    setAgentCommitPreview(null);
  }

  async function handleConfirmAgentCommit() {
    if (!linkedIssue || !agentCommitPreview || !selectedSession) {
      return;
    }

    setCompleteAgentCommitErrorMessage(null);
    setIsSendingAgentCommitPrompt(true);

    try {
      await sendAgentCommitPrompt({
        projectId,
        issueId: linkedIssue.issueId,
      });
      setIsDetectingAgentCommitCompletion(true);
      const detectionResult = await detectAgentCommitCompletion({
        projectId,
        issueId: linkedIssue.issueId,
      });
      if (detectionResult.outcome === "completed") {
        const completedIssue = detectionResult.issue;
        completedIssueIdsRef.current.add(completedIssue.id);
        closedSessionIdsRef.current.add(selectedSession.sessionId);
        setSessions((currentSessions) =>
          currentSessions.map((session) =>
            session.issueId === completedIssue.id
              ? {
                  ...session,
                  status:
                    session.sessionId === selectedSession.sessionId
                      ? ("closed" as const)
                      : session.status,
                  issueStatus: completedIssue.status,
                  lastActiveAt: Math.max(
                    session.lastActiveAt,
                    completedIssue.updatedAt,
                  ),
                  closedAt:
                    session.sessionId === selectedSession.sessionId
                      ? Math.max(
                          session.closedAt ?? 0,
                          completedIssue.updatedAt,
                        )
                      : session.closedAt,
                  canCompleteClean: false,
                  canCompleteAgentCommit: false,
                }
              : session,
          ),
        );
        setAgentCommitPreview(null);
        const response = await listAgentSessions(projectId);
        setSessions(applySessionListOverlays(response.sessions));
      } else {
        setAgentCommitPreview(null);
        setCompleteAgentCommitErrorMessage(detectionResult.message);
      }
    } catch (error) {
      setCompleteAgentCommitErrorMessage(toCommandError(error).message);
    } finally {
      setIsDetectingAgentCommitCompletion(false);
      setIsSendingAgentCommitPrompt(false);
    }
  }

  function handleOpenSummary() {
    if (!linkedIssue || linkedIssue.issueStatus !== "completed") {
      return;
    }

    setSummaryIssueId(linkedIssue.issueId);
  }

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }

      const deltaX = event.clientX - dragState.startX;
      const nextWidth = Math.max(
        AGENTS_SIDEBAR_MIN_WIDTH,
        Math.min(AGENTS_SIDEBAR_MAX_WIDTH, dragState.startWidth + deltaX),
      );
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
    result: StartStructuredAgentSessionResult,
  ) {
    const response = await listAgentSessions(projectId);
    setSessions(applySessionListOverlays(response.sessions));
    setSelectedSessionId(result.sessionId);
    onSelectSession?.(result.sessionId);
  }

  return (
    <main
      className="activity-surface activity-surface--agents"
      style={{ "--agents-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <aside className="agents-sidebar" aria-label="Agent sessions">
        <div className="agents-sidebar__header">
          <div className="agents-sidebar__header-main">
            <h2>{messages.app.agents}</h2>
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
            {sessionsByGroup.map((group) => (
              <SessionGroup
                key={group.key}
                emptyCopy={group.emptyCopy}
                count={group.sessions.length}
                label={group.label}
                groupKey={group.key}
                onSelect={handleSelectSession}
                selectedSessionId={selectedSession?.sessionId ?? null}
                sessions={group.sessions}
              />
            ))}
          </div>
        ) : null}
      </aside>

      <div
        aria-label="Resize session list"
        aria-orientation="vertical"
        aria-valuemax={AGENTS_SIDEBAR_MAX_WIDTH}
        aria-valuemin={AGENTS_SIDEBAR_MIN_WIDTH}
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
            setSidebarWidth((currentWidth) =>
              Math.max(
                AGENTS_SIDEBAR_MIN_WIDTH,
                currentWidth - SIDEBAR_RESIZE_STEP,
              ),
            );
          }

          if (event.key === "ArrowRight") {
            event.preventDefault();
            setSidebarWidth((currentWidth) =>
              Math.min(
                AGENTS_SIDEBAR_MAX_WIDTH,
                currentWidth + SIDEBAR_RESIZE_STEP,
              ),
            );
          }
        }}
      />

      <section
        className={`agents-workspace${
          isIssueDrawerOpen && linkedIssue
            ? " agents-workspace--with-issue-drawer"
            : ""
        }`}
        aria-label="Session workspace"
      >
        <div className="agents-terminal-pane">
          {selectedSession ? (
            <div className="agents-session-toolbar">
              <div className="agents-session-toolbar__copy">
                <p className="agents-session-toolbar__eyebrow">当前会话</p>
                {linkedIssue ? (
                  <h3 className="agents-session-toolbar__issue-heading">{`#issue${linkedIssue.issueId} ${linkedIssue.issueTitle}`}</h3>
                ) : (
                  <h3>{formatSessionTitle(selectedSession)}</h3>
                )}
                {shouldShowExplicitSessionStatus(selectedSession) ? (
                  <p className="agents-session-toolbar__status">{`Status: ${formatSessionStatusLabel(
                    selectedSession,
                  )}`}</p>
                ) : null}
              </div>
              <div className="agents-session-toolbar__actions">
                {canRenderTransitionButton ? (
                  <div className="agents-session-toolbar__split-action">
                    <button
                      className="agents-session-toolbar__action agents-session-toolbar__action--split-main"
                      disabled={isTransitionPending}
                      type="button"
                      onClick={() =>
                        void handleTransitionAction(
                          sessionTransitionPhase === "running"
                            ? "review"
                            : "done",
                        )
                      }
                    >
                      {transitionButtonLabel}
                    </button>
                    {canRenderTransitionMenu ? (
                      <div className="agents-session-toolbar__split-menu">
                        <button
                          aria-expanded={isTransitionMenuOpen}
                          aria-haspopup="menu"
                          aria-label="Open status options"
                          className="agents-session-toolbar__action agents-session-toolbar__action--split-toggle"
                          disabled={isTransitionPending}
                          type="button"
                          onClick={() =>
                            setIsTransitionMenuOpen(
                              (currentIsTransitionMenuOpen) =>
                                !currentIsTransitionMenuOpen,
                            )
                          }
                        >
                          <ChevronDown
                            aria-hidden="true"
                            size={14}
                            strokeWidth={1.9}
                          />
                        </button>
                        {isTransitionMenuOpen ? (
                          <div
                            className="agents-session-toolbar__menu"
                            role="menu"
                          >
                            {transitionMenuOptions.map((option) => (
                              <button
                                key={option.action}
                                className="agents-session-toolbar__menu-item"
                                role="menuitem"
                                type="button"
                                onClick={() =>
                                  void handleTransitionAction(option.action)
                                }
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {linkedIssue ? (
                  <button
                    className="agents-session-toolbar__action"
                    type="button"
                    onClick={() => setIsIssueDrawerOpen(true)}
                  >
                    Open Issue
                  </button>
                ) : null}
                {canViewSummary ? (
                  <button
                    className="agents-session-toolbar__action"
                    type="button"
                    onClick={handleOpenSummary}
                  >
                    View Summary
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="agents-session-status-stack">
            {markReviewErrorMessage ? (
              <p className="issues-status" role="status">
                {markReviewErrorMessage}
              </p>
            ) : null}
            {completeManualErrorMessage ? (
              <p className="issues-status" role="status">
                {completeManualErrorMessage}
              </p>
            ) : null}
            {completeCleanErrorMessage ? (
              <p className="issues-status" role="status">
                {completeCleanErrorMessage}
              </p>
            ) : null}
            {completeAgentCommitErrorMessage ? (
              <p className="issues-status" role="status">
                {completeAgentCommitErrorMessage}
              </p>
            ) : null}
            {attentionErrorMessage ? (
              <p className="issues-status" role="status">
                {attentionErrorMessage}
              </p>
            ) : null}
          </div>
          <div
            className="agents-terminal-host"
            onMouseDown={() => {
              if (selectedSession) {
                void acknowledgeSessionAttention(selectedSession.sessionId);
              }
            }}
          >
            {selectedSession ? (
              <AgentSessionView
                projectId={projectId}
                sessionId={selectedSession.sessionId}
                agentType={selectedSession.agentType}
              />
            ) : (
              <p className="empty-state">
                Agent sessions will appear here after a session has been started
                for this project.
              </p>
            )}
          </div>
        </div>
        {isIssueDrawerOpen && linkedIssue ? (
          <SessionIssueDrawer
            issueId={linkedIssue.issueId}
            issueTitle={linkedIssue.issueTitle}
            projectId={projectId}
            onClose={() => setIsIssueDrawerOpen(false)}
          />
        ) : null}
      </section>

      {isTemporarySessionDialogOpen ? (
        <TemporarySessionDialog
          projectId={projectId}
          onClose={closeTemporarySessionDialog}
          onStarted={handleTemporarySessionStarted}
        />
      ) : null}
      {agentCommitPreview ? (
        <div className="issue-dialog-overlay">
          <div
            aria-label="Completion Confirmation"
            aria-modal="true"
            className="issue-dialog issue-dialog--compact"
            role="dialog"
          >
            <div className="issue-dialog__header">
              <h3>Completion Confirmation</h3>
              <button
                aria-label="Close completion confirmation"
                className="issue-dialog__close"
                type="button"
                onClick={handleCloseAgentCommitPreview}
              >
                ×
              </button>
            </div>
            <div className="issue-dialog__body issue-dialog__body--single">
              <div className="issue-dialog__editor">
                <section className="issue-dialog__panel">
                  <h4>Git summary</h4>
                  <p>{`HEAD: ${agentCommitPreview.head}`}</p>
                  <p>{`Changed files: ${agentCommitPreview.changedFilesCount}`}</p>
                  <p>{`Completion option: ${agentCommitPreview.option}`}</p>
                </section>
                <section className="issue-dialog__panel">
                  <h4>Changed files</h4>
                  {agentCommitPreview.changedFiles.length > 0 ? (
                    <ul className="completion-preview__files">
                      {agentCommitPreview.changedFiles.map((file) => (
                        <li key={`${file.status}:${file.path}`}>
                          <span>{file.status}</span>
                          <code>{file.path}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No changed files.</p>
                  )}
                </section>
                <details className="settings-panel">
                  <summary>Completion prompt</summary>
                  <pre className="completion-preview__prompt">
                    {agentCommitPreview.completionPrompt}
                  </pre>
                </details>
              </div>
            </div>
            <div className="issue-dialog__footer issue-dialog__footer--end">
              <button
                disabled={
                  isSendingAgentCommitPrompt || isDetectingAgentCommitCompletion
                }
                type="button"
                onClick={() => void handleConfirmAgentCommit()}
              >
                {isSendingAgentCommitPrompt || isDetectingAgentCommitCompletion
                  ? "Sending..."
                  : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {summaryIssueId != null ? (
        <IssueSummaryDialog
          issueId={summaryIssueId}
          projectId={projectId}
          onClose={() => setSummaryIssueId(null)}
        />
      ) : null}
    </main>
  );
}

interface SessionIssueDrawerProps {
  issueId: number;
  issueTitle: string;
  projectId: number;
  onClose: () => void;
}

function SessionIssueDrawer({
  issueId,
  issueTitle,
  projectId,
  onClose,
}: SessionIssueDrawerProps) {
  const [issue, setIssue] = useState<IssueRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadIssue() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await listIssues({ projectId });
        if (!isMounted) {
          return;
        }

        const nextIssue =
          response.issues.find((candidate) => candidate.id === issueId) ?? null;
        setIssue(nextIssue);
        if (!nextIssue) {
          setErrorMessage("Linked issue no longer exists.");
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setIssue(null);
        setErrorMessage(toCommandError(error).message);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadIssue();

    return () => {
      isMounted = false;
    };
  }, [issueId, projectId]);

  const description = issue?.description?.trim().length
    ? issue.description
    : "No details provided.";

  return (
    <aside className="agents-issue-drawer" aria-label="Issue details">
      <div className="agents-issue-drawer__header">
        <div className="agents-issue-drawer__copy">
          <p className="agents-issue-drawer__eyebrow">Issue</p>
          <h4>{issue?.title ?? issueTitle}</h4>
        </div>
        <button
          aria-label="Close issue details"
          className="issue-dialog__close"
          type="button"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="agents-issue-drawer__body">
        {isLoading ? (
          <p className="issues-status" role="status">
            Loading issue...
          </p>
        ) : errorMessage ? (
          <p className="issues-status" role="status">
            {errorMessage}
          </p>
        ) : (
          <>
            <section className="issue-dialog__panel">
              <h4>Title</h4>
              <p className="issue-detail__title">
                {issue?.title ?? issueTitle}
              </p>
            </section>
            <section className="issue-dialog__panel">
              <h4>Details</h4>
              <div className="issue-detail__description">{description}</div>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

function applySessionOverlay(
  session: AgentSessionListItem,
  reviewedIssueIds: Set<number>,
  completedIssueIds: Set<number>,
  closedSessionIds: Set<number>,
): AgentSessionListItem {
  let nextSession = session;

  if (
    nextSession.issueId != null &&
    reviewedIssueIds.has(nextSession.issueId) &&
    nextSession.issueStatus === "running"
  ) {
    nextSession = { ...nextSession, issueStatus: "review" as const };
  }

  const shouldCloseSession = closedSessionIds.has(nextSession.sessionId);
  const shouldCompleteIssue =
    nextSession.issueId != null && completedIssueIds.has(nextSession.issueId);

  if (!shouldCloseSession && !shouldCompleteIssue) {
    return nextSession;
  }

  return {
    ...nextSession,
    status: shouldCloseSession ? "closed" : nextSession.status,
    issueStatus: shouldCompleteIssue ? "completed" : nextSession.issueStatus,
    closedAt: shouldCloseSession
      ? Math.max(nextSession.closedAt ?? 0, nextSession.lastActiveAt)
      : nextSession.closedAt,
  };
}

function getSessionIssueGroup(
  session: AgentSessionListItem,
): SessionIssueGroup | null {
  switch (session.issueStatus) {
    case "running":
      return "inProcess";
    case "review":
      return "review";
    case "completed":
      return "done";
    case "backlog":
      return null;
    default:
      break;
  }

  if (session.issueId != null) {
    return session.status === "running" ? "inProcess" : "done";
  }

  return session.status === "running" ? "inProcess" : "done";
}

function getSessionTransitionPhase(
  session: AgentSessionListItem | null,
): "running" | "review" | "completed" | null {
  if (!session?.issueId || !session.issueStatus) {
    return null;
  }

  switch (session.issueStatus) {
    case "running":
    case "review":
    case "completed":
      return session.issueStatus;
    default:
      return null;
  }
}

interface SessionGroupProps {
  count: number;
  emptyCopy: string;
  groupKey: SessionIssueGroup;
  label: string;
  onSelect: (sessionId: number) => void;
  selectedSessionId: number | null;
  sessions: AgentSessionListItem[];
}

function SessionGroup({
  count,
  emptyCopy,
  groupKey,
  label,
  onSelect,
  selectedSessionId,
  sessions,
}: SessionGroupProps) {
  const [isExpanded, setIsExpanded] = useState(groupKey !== "done");

  return (
    <section aria-label={`${label} sessions`} className="agents-group">
      <button
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${label} sessions`}
        className="agents-group__header"
        type="button"
        onClick={() => setIsExpanded((currentIsExpanded) => !currentIsExpanded)}
      >
        {isExpanded ? (
          <ChevronDown aria-hidden="true" size={14} strokeWidth={1.9} />
        ) : (
          <ChevronRight aria-hidden="true" size={14} strokeWidth={1.9} />
        )}
        <h3>
          <span className="agents-group__title">{label}</span>
          <span className="agents-group__count">{`(${count})`}</span>
        </h3>
      </button>
      {isExpanded && sessions.length === 0 ? (
        <p className="agents-group__empty">{emptyCopy}</p>
      ) : null}
      {isExpanded && sessions.length > 0 ? (
        <div className="agents-session-list">
          {sessions.map((session) => {
            const outputLine = formatSessionOutputLine(session.latestOutput);
            const statusTone = getSessionStatusTone(session);
            const statusLabel = formatSessionStatusLabel(session);
            const agentLabel = formatAgentTypeLabel(session.agentType);

            return (
              <button
                key={session.sessionId}
                aria-pressed={selectedSessionId === session.sessionId}
                className="agents-session-row"
                type="button"
                onClick={() => onSelect(session.sessionId)}
              >
                <span className="agents-session-row__header">
                  {statusTone === "running" ? (
                    <LoaderCircle
                      aria-label="Session 正在运行"
                      className="agents-session-row__running-icon"
                      size={12}
                      strokeWidth={2}
                    />
                  ) : null}
                  <span className="agents-session-row__title">
                    {formatSessionTitle(session)}
                  </span>
                </span>
                <span className="agents-session-row__output">
                  <span
                    aria-label={`Session 状态：${statusLabel}`}
                    className={buildSessionStatusDotClassName(statusTone)}
                  />
                  <span className="agents-session-row__latest-output">
                    {outputLine}
                  </span>
                </span>
                <span className="agents-session-row__agent">
                  <img
                    alt={`Agent 类型：${agentLabel}`}
                    className="agents-session-row__agent-logo"
                    src={getAgentLogoSrc(session.agentType)}
                  />
                  {shouldShowSessionRowStatus(session) ? (
                    <span className="agents-session-row__meta-status">
                      {statusLabel}
                    </span>
                  ) : null}
                  <span className="sr-only">{`，${statusLabel}`}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function formatSessionTitle(session: AgentSessionListItem): string {
  return session.issueTitle ?? session.title ?? `Session #${session.sessionId}`;
}

function buildSessionStatusDotClassName(tone: string): string {
  return `agents-session-row__status-dot agents-session-row__status-dot--${tone}`;
}

function formatSessionStatusLabel(session: AgentSessionListItem): string {
  if (session.status === "crashed") {
    return "crashed";
  }

  if (session.status === "stopped") {
    return "stopped";
  }

  if (session.issueStatus === "completed") {
    return "Done";
  }

  if (session.issueStatus === "review") {
    return "Review";
  }

  if (session.attention === "requested") {
    return "输出完成";
  }

  if (session.status === "running") {
    return "运行中";
  }

  return "closed";
}

function getSessionStatusTone(session: AgentSessionListItem): string {
  if (session.issueStatus === "completed") {
    return "done";
  }

  if (session.issueStatus === "review") {
    return "viewed";
  }

  if (session.status !== "running") {
    return "done";
  }

  return session.attention === "requested" ? "viewed" : "running";
}

function formatSessionOutputLine(output: string | null | undefined): string {
  if (!output) {
    return "";
  }

  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!isNonOutputLine(line)) {
      return line;
    }
  }

  return "";
}

function isNonOutputLine(line: string): boolean {
  const normalized = line.trim().toLowerCase();
  return (
    normalized === "working" ||
    normalized === "thinking" ||
    normalized === "working..." ||
    normalized === "thinking..." ||
    /^[>›]\s*/.test(line) ||
    /^input\s*[:：]/i.test(line) ||
    /^prompt\s*[:：]/i.test(line)
  );
}

function shouldShowExplicitSessionStatus(
  session: AgentSessionListItem,
): boolean {
  return session.status === "crashed" || session.status === "stopped";
}

function shouldShowSessionRowStatus(session: AgentSessionListItem): boolean {
  return session.status === "crashed";
}
