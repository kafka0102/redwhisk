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
import { TemporarySessionDialog } from "./temporary-session-dialog";
import { IssueSummaryDialog } from "../issues/issue-summary-dialog";
import {
  completeIssueClean,
  completeIssueManual,
  detectAgentCommitCompletion,
  markIssueReview,
  prepareAgentCommitCompletion,
  sendAgentCommitPrompt,
  type AgentCommitCompletionPreview,
} from "../issues/issue-commands";
import { toCommandError } from "../../shared/commands/command-error";
import type { ProjectCompletionPolicy } from "../project/project-commands";
import { useI18n } from "../../shared/i18n/i18n";
import { AgentsSessionList } from "./agents-session-list";
import {
  AgentsSessionPane,
  type LinkedSessionIssue,
  type SessionIssueTransition,
} from "./agents-session-pane";
import { SessionIssueDrawer } from "./session-issue-drawer";
import { getSessionIssueGroup } from "./agent-session-formatters";

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

  const visibleSessions = useMemo(
    () => sessions.filter((session) => getSessionIssueGroup(session) !== null),
    [sessions],
  );

  const currentSessionId =
    (visibleSessions.some((session) => session.sessionId === selectedSessionId)
      ? selectedSessionId
      : null) ??
    visibleSessions[0]?.sessionId ??
    null;

  const selectedSession =
    visibleSessions.find((session) => session.sessionId === currentSessionId) ??
    null;
  const linkedIssue: LinkedSessionIssue | null = useMemo(
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
      <AgentsSessionList
        errorMessage={errorMessage}
        isLoading={isLoading}
        newSessionButtonRef={newSessionButtonRef}
        onNewSession={openTemporarySessionDialog}
        onSelectSession={handleSelectSession}
        selectedSessionId={selectedSession?.sessionId ?? null}
        sessions={visibleSessions}
        title={messages.app.agents}
      />

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
        <AgentsSessionPane
          agentCommitErrorMessage={completeAgentCommitErrorMessage}
          attentionErrorMessage={attentionErrorMessage}
          canRenderTransitionButton={canRenderTransitionButton}
          canRenderTransitionMenu={canRenderTransitionMenu}
          canViewSummary={canViewSummary}
          cleanErrorMessage={completeCleanErrorMessage}
          isTransitionMenuOpen={isTransitionMenuOpen}
          isTransitionPending={isTransitionPending}
          linkedIssue={linkedIssue}
          manualErrorMessage={completeManualErrorMessage}
          markReviewErrorMessage={markReviewErrorMessage}
          onAcknowledgeSessionAttention={(sessionId) => {
            void acknowledgeSessionAttention(sessionId);
          }}
          onOpenIssue={() => setIsIssueDrawerOpen(true)}
          onOpenSummary={handleOpenSummary}
          onToggleTransitionMenu={() =>
            setIsTransitionMenuOpen(
              (currentIsTransitionMenuOpen) => !currentIsTransitionMenuOpen,
            )
          }
          onTransitionAction={(action) => {
            void handleTransitionAction(action);
          }}
          projectId={projectId}
          selectedSession={selectedSession}
          transitionButtonLabel={transitionButtonLabel}
          transitionMenuOptions={transitionMenuOptions}
          transitionPhase={sessionTransitionPhase}
        />
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
