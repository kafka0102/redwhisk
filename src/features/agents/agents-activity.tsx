import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  LoaderCircle,
  Plus,
} from "lucide-react";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import claudeLogoSrc from "../../assets/images/claude.svg";
import codexLogoSrc from "../../assets/images/codex.svg";
import {
  listAgentSessions,
  setAgentSessionAttention,
  type StartStandaloneAgentSessionResult,
  type AgentSessionListItem,
} from "./agent-session-commands";
import { CodexTerminal } from "./codex-terminal";
import { TemporarySessionDialog } from "./temporary-session-dialog";
import { IssueInspector } from "./issue-inspector";
import { IssueSummaryDialog } from "../issues/issue-summary-dialog";
import {
  completeIssueClean,
  completeIssueManual,
  detectAgentCommitCompletion,
  markIssueReview,
  prepareAgentCommitCompletion,
  sendAgentCommitPrompt,
  type AgentCommitCompletionPreview,
  type IssueRecord,
} from "../issues/issue-commands";
import { toCommandError } from "../../shared/commands/command-error";
import type { ProjectCompletionPolicy } from "../project/project-commands";

const SESSION_LIST_POLL_INTERVAL_MS = 1_500;
const AGENTS_SIDEBAR_DEFAULT_WIDTH = 230;
const AGENTS_SIDEBAR_MIN_WIDTH = 230;
const AGENTS_SIDEBAR_MAX_WIDTH = 450;

interface AgentsActivityProps {
  activeSessionId: number | null;
  onSelectSession?: (sessionId: number) => void;
  onOpenIssuesActivity?: (issueId: number) => void;
  projectCompletionPolicy?: ProjectCompletionPolicy;
  projectId: number;
}

type DragPane = "info" | "sidebar";
type SessionIssueGroup = "inProcess" | "review" | "done";

const SESSION_GROUPS: Array<{
  key: SessionIssueGroup;
  label: string;
  emptyCopy: string;
}> = [
  {
    key: "inProcess",
    label: "In Progress",
    emptyCopy: "No in-progress sessions.",
  },
  {
    key: "review",
    label: "Review",
    emptyCopy: "No review sessions.",
  },
  {
    key: "done",
    label: "Done",
    emptyCopy: "No done sessions.",
  },
];

export function AgentsActivity({
  activeSessionId,
  onSelectSession,
  onOpenIssuesActivity,
  projectCompletionPolicy = "manual",
  projectId,
}: AgentsActivityProps) {
  const defaultSidebarWidth = AGENTS_SIDEBAR_DEFAULT_WIDTH;
  const infoPaneDefaultWidth = 200;
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
  const [isCompletingManual, setIsCompletingManual] = useState(false);
  const [isCompletingClean, setIsCompletingClean] = useState(false);
  const [isPreparingAgentCommit, setIsPreparingAgentCommit] = useState(false);
  const [isSendingAgentCommitPrompt, setIsSendingAgentCommitPrompt] =
    useState(false);
  const [
    isDetectingAgentCommitCompletion,
    setIsDetectingAgentCommitCompletion,
  ] = useState(false);
  const [isOpeningLog, setIsOpeningLog] = useState(false);
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
  const completedIssueIdsRef = useRef<Set<number>>(new Set());
  const closedSessionIdsRef = useRef<Set<number>>(new Set());
  const issueTitleButtonRef = useRef<HTMLButtonElement | null>(null);
  const inspectorPaneRef = useRef<HTMLElement | null>(null);
  const infoSplitterRef = useRef<HTMLDivElement | null>(null);

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
      SESSION_GROUPS.map((group) => ({
        ...group,
        sessions: sessions.filter(
          (session) => getSessionIssueGroup(session) === group.key,
        ),
      })),
    [sessions],
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
  const isInspectorOpen =
    linkedIssue != null && openInspectorIssueId === linkedIssue.issueId;
  const canMarkReview =
    selectedSession?.status === "running" &&
    linkedIssue?.issueStatus === "running";
  const canCompleteManual =
    selectedSession?.status === "running" &&
    linkedIssue?.issueStatus === "review" &&
    projectCompletionPolicy === "manual";
  const canCompleteClean =
    selectedSession?.status === "running" &&
    linkedIssue?.issueStatus === "review" &&
    projectCompletionPolicy === "agent_auto_commit" &&
    selectedSession?.canCompleteClean === true;
  const canCompleteAgentCommit =
    selectedSession?.status === "running" &&
    linkedIssue?.issueStatus === "review" &&
    projectCompletionPolicy === "agent_auto_commit" &&
    selectedSession?.canCompleteAgentCommit === true;
  const canOpenLog =
    linkedIssue?.issueStatus === "completed" ||
    selectedSession?.status === "crashed" ||
    selectedSession?.status === "stopped";
  const canViewSummary = linkedIssue?.issueStatus === "completed";

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

  async function handleCompleteManual() {
    if (!linkedIssue || !selectedSession) {
      return;
    }

    const isConfirmed = window.confirm(
      `确认手动完成 #issue${linkedIssue.issueId} ${linkedIssue.issueTitle} 吗？`,
    );
    if (!isConfirmed) {
      return;
    }

    setCompleteManualErrorMessage(null);
    setIsCompletingManual(true);

    let completedIssueId: number | null = null;
    let completedSessionId: number | null = null;

    try {
      const completedIssue = await completeIssueManual({
        projectId,
        issueId: linkedIssue.issueId,
      });
      completedIssueId = completedIssue.id;
      completedSessionId = selectedSession.sessionId;
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
                    ? Math.max(session.closedAt ?? 0, completedIssue.updatedAt)
                    : session.closedAt,
              }
            : session,
        ),
      );
    } catch (error) {
      setCompleteManualErrorMessage(toCommandError(error).message);
      try {
        const response = await listAgentSessions(projectId);
        setSessions(applySessionListOverlays(response.sessions));
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
      const response = await listAgentSessions(projectId);
      setSessions(applySessionListOverlays(response.sessions));
    } catch (error) {
      setCompleteManualErrorMessage(toCommandError(error).message);
    } finally {
      setIsCompletingManual(false);
    }
  }

  async function handleCompleteClean() {
    if (!linkedIssue || !selectedSession) {
      return;
    }

    const isConfirmed = window.confirm(
      `确认直接完成 #issue${linkedIssue.issueId} ${linkedIssue.issueTitle} 吗？`,
    );
    if (!isConfirmed) {
      return;
    }

    setCompleteCleanErrorMessage(null);
    setIsCompletingClean(true);

    let completedIssueId: number | null = null;
    let completedSessionId: number | null = null;

    try {
      const completedIssue = await completeIssueClean({
        projectId,
        issueId: linkedIssue.issueId,
      });
      completedIssueId = completedIssue.id;
      completedSessionId = selectedSession.sessionId;
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
                    ? Math.max(session.closedAt ?? 0, completedIssue.updatedAt)
                    : session.closedAt,
              }
            : session,
        ),
      );
    } catch (error) {
      setCompleteCleanErrorMessage(toCommandError(error).message);
      try {
        const response = await listAgentSessions(projectId);
        setSessions(applySessionListOverlays(response.sessions));
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
      const response = await listAgentSessions(projectId);
      setSessions(applySessionListOverlays(response.sessions));
    } catch (error) {
      setCompleteCleanErrorMessage(toCommandError(error).message);
    } finally {
      setIsCompletingClean(false);
    }
  }

  async function handlePrepareAgentCommit() {
    if (!linkedIssue) {
      return;
    }

    setCompleteAgentCommitErrorMessage(null);
    setIsPreparingAgentCommit(true);

    try {
      const preview = await prepareAgentCommitCompletion({
        projectId,
        issueId: linkedIssue.issueId,
      });
      setAgentCommitPreview(preview);
    } catch (error) {
      setCompleteAgentCommitErrorMessage(toCommandError(error).message);
    } finally {
      setIsPreparingAgentCommit(false);
    }
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

  async function handleOpenLog() {
    if (!selectedSession || isOpeningLog) {
      return;
    }

    setSessionActionErrorMessage(null);

    if (!selectedSession.logPath) {
      setSessionActionErrorMessage("No log path recorded for this session.");
      return;
    }

    setIsOpeningLog(true);

    try {
      await openPath(selectedSession.logPath);
    } catch (error) {
      setSessionActionErrorMessage(toCommandError(error).message);
    } finally {
      setIsOpeningLog(false);
    }
  }

  function handleOpenSummary() {
    if (!linkedIssue || linkedIssue.issueStatus !== "completed") {
      return;
    }

    setSummaryIssueId(linkedIssue.issueId);
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
          AGENTS_SIDEBAR_MIN_WIDTH,
          Math.min(AGENTS_SIDEBAR_MAX_WIDTH, dragState.startWidth + deltaX),
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
                viewedSessionActivity={viewedSessionActivity}
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
            setSidebarWidth((currentWidth) =>
              Math.max(AGENTS_SIDEBAR_MIN_WIDTH, currentWidth - 16),
            );
          }

          if (event.key === "ArrowRight") {
            event.preventDefault();
            setSidebarWidth((currentWidth) =>
              Math.min(AGENTS_SIDEBAR_MAX_WIDTH, currentWidth + 16),
            );
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
                {canCompleteManual ? (
                  <button
                    className="agents-session-toolbar__action"
                    disabled={isCompletingManual}
                    type="button"
                    onClick={() => void handleCompleteManual()}
                  >
                    {isCompletingManual ? "完成中..." : "Complete Manually"}
                  </button>
                ) : null}
                {canCompleteClean ? (
                  <button
                    className="agents-session-toolbar__action"
                    disabled={isCompletingClean}
                    type="button"
                    onClick={() => void handleCompleteClean()}
                  >
                    {isCompletingClean ? "完成中..." : "Complete"}
                  </button>
                ) : null}
                {canCompleteAgentCommit ? (
                  <button
                    className="agents-session-toolbar__action"
                    disabled={isPreparingAgentCommit}
                    type="button"
                    onClick={() => void handlePrepareAgentCommit()}
                  >
                    {isPreparingAgentCommit
                      ? "准备中..."
                      : "Complete with Agent Commit"}
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
            {sessionActionErrorMessage ? (
              <p className="issues-status" role="status">
                {sessionActionErrorMessage}
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
                  linkedSessionLogPath={selectedSession.logPath ?? null}
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
            <div className="issue-dialog__footer">
              <button
                disabled={
                  isSendingAgentCommitPrompt || isDetectingAgentCommitCompletion
                }
                type="button"
                onClick={handleCloseAgentCommitPreview}
              >
                Cancel
              </button>
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

interface SessionGroupProps {
  count: number;
  emptyCopy: string;
  groupKey: SessionIssueGroup;
  label: string;
  onSelect: (sessionId: number) => void;
  selectedSessionId: number | null;
  sessions: AgentSessionListItem[];
  viewedSessionActivity: Record<number, number>;
}

function SessionGroup({
  count,
  emptyCopy,
  groupKey,
  label,
  onSelect,
  selectedSessionId,
  sessions,
  viewedSessionActivity,
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
            const statusTone = getSessionStatusTone(
              session,
              viewedSessionActivity,
              selectedSessionId,
            );
            const statusLabel = formatSessionStatusLabel(
              session,
              viewedSessionActivity,
              selectedSessionId,
            );
            const agentLabel = formatAgentType(session.agentType);

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

function formatAgentType(agentType: AgentSessionListItem["agentType"]): string {
  switch (agentType) {
    case "codex":
      return "Codex";
    case "claude":
    case "claude_code":
      return "Claude";
    default:
      return agentType;
  }
}

function getAgentLogoSrc(
  agentType: AgentSessionListItem["agentType"],
): string {
  if (agentType === "claude" || agentType === "claude_code") {
    return claudeLogoSrc;
  }

  return codexLogoSrc;
}

function buildSessionStatusDotClassName(tone: string): string {
  return `agents-session-row__status-dot agents-session-row__status-dot--${tone}`;
}

function formatSessionStatusLabel(
  session: AgentSessionListItem,
  viewedSessionActivity: Record<number, number>,
  selectedSessionId: number | null = null,
): string {
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
    if (
      selectedSessionId === session.sessionId ||
      isViewedSession(session, viewedSessionActivity)
    ) {
      return "已查看";
    }

    return "运行中";
  }

  return "closed";
}

function getSessionStatusTone(
  session: AgentSessionListItem,
  viewedSessionActivity: Record<number, number>,
  selectedSessionId: number | null,
): string {
  if (session.issueStatus === "completed") {
    return "done";
  }

  if (session.issueStatus === "review") {
    return "viewed";
  }

  if (session.status !== "running") {
    return "done";
  }

  if (session.attention === "requested") {
    return "viewed";
  }

  if (
    selectedSessionId === session.sessionId ||
    isViewedSession(session, viewedSessionActivity)
  ) {
    return "viewed";
  }

  return "running";
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

function isViewedSession(
  session: AgentSessionListItem,
  viewedSessionActivity: Record<number, number>,
): boolean {
  const viewedAt = viewedSessionActivity[session.sessionId];
  return viewedAt != null && viewedAt >= session.lastActiveAt;
}
