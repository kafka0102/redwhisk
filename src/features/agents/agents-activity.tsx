import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";

import {
  deleteAgentSession,
  listAgentSessions,
  setAgentSessionAttention,
  startStructuredAgentSession,
  type StartStructuredAgentSessionResult,
  type AgentSessionListItem,
} from "./agent-session-commands";
import {
  DEFAULT_ACTIVITY_SIDEBAR_WIDTH,
  SIDEBAR_RESIZE_STEP,
} from "../../shared/layout/sidebar-width";
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
import { toast } from "../../shared/toast";
import { AgentsSessionList } from "./agents-session-list";
import {
  listAgentProfiles,
  type AgentProfileRecord,
  type AgentType,
} from "../settings/settings-commands";
import {
  AgentsSessionPane,
  type LinkedSessionIssue,
  type SessionIssueTransition,
} from "./agents-session-pane";
import { getSessionIssueGroup } from "./agent-session-formatters";
import { SessionSidePanel } from "./session-side-panel";
import { SessionInlineTerminalPanel } from "./session-inline-terminal-panel";
import {
  clampSessionTerminalPanelHeight,
  createDefaultSessionInlineTerminalPanelState,
  DEFAULT_SESSION_TERMINAL_PANEL_HEIGHT,
  type SessionInlineTerminalPanelState,
} from "./session-inline-terminal-panel-state";
import { useSessionWorkspaceCache } from "./use-session-workspace-cache";
import {
  closeProjectTerminal,
  createTemporaryProjectTerminal,
} from "../terminals/project-terminal-commands";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";

const SESSION_LIST_POLL_INTERVAL_MS = 1_500;
const AGENTS_SIDEBAR_DEFAULT_WIDTH = DEFAULT_ACTIVITY_SIDEBAR_WIDTH;
const AGENTS_SIDEBAR_MIN_WIDTH = DEFAULT_ACTIVITY_SIDEBAR_WIDTH;
const AGENTS_SIDEBAR_MAX_WIDTH = 450;
const SESSION_SIDE_PANEL_DEFAULT_WIDTH = 300;
const SESSION_SIDE_PANEL_MIN_WIDTH = 240;
const SESSION_SIDE_PANEL_MAX_WIDTH = 560;

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
  const { confirm, confirmationDialog } = useConfirmDialog();
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
  const [deleteSessionErrorMessage, setDeleteSessionErrorMessage] = useState<
    string | null
  >(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [isLoadingAgentTypes, setIsLoadingAgentTypes] = useState(true);
  const [availableAgentProfiles, setAvailableAgentProfiles] = useState<
    AgentProfileRecord[]
  >([]);
  const [availableAgentTypes, setAvailableAgentTypes] = useState<AgentType[]>(
    [],
  );
  const [isNewSessionMenuOpen, setIsNewSessionMenuOpen] = useState(false);
  const [agentCommitPreview, setAgentCommitPreview] =
    useState<AgentCommitCompletionPreview | null>(null);
  const [isSessionSidePanelOpen, setIsSessionSidePanelOpen] = useState(false);
  const [isTransitionMenuOpen, setIsTransitionMenuOpen] = useState(false);
  const [terminalPanelStateBySessionId, setTerminalPanelStateBySessionId] =
    useState<Record<number, SessionInlineTerminalPanelState>>({});
  const [sessions, setSessions] = useState<AgentSessionListItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    activeSessionId,
  );
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth);
  const [sessionSidePanelWidth, setSessionSidePanelWidth] = useState(
    SESSION_SIDE_PANEL_DEFAULT_WIDTH,
  );
  const dragStateRef = useRef<{
    startWidth: number;
    startX: number;
  } | null>(null);
  const sidePanelDragStateRef = useRef<{
    startWidth: number;
    startX: number;
  } | null>(null);
  const terminalPanelDragStateRef = useRef<{
    sessionId: number;
    startHeight: number;
    startY: number;
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

  useEffect(() => {
    let isMounted = true;

    async function loadAgentTypes() {
      setIsLoadingAgentTypes(true);

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
        const nextAgentTypes = Array.from(
          new Set(mergedProfiles.map((profile) => profile.agentType)),
        );
        setAvailableAgentTypes(nextAgentTypes);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setAvailableAgentProfiles([]);
        setAvailableAgentTypes([]);
        toast.error(toCommandError(error).message);
      } finally {
        if (isMounted) {
          setIsLoadingAgentTypes(false);
        }
      }
    }

    void loadAgentTypes();

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!isNewSessionMenuOpen) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (newSessionButtonRef.current?.contains(target)) {
        return;
      }

      const menu = document.querySelector(".agents-session-create-menu");
      if (menu?.contains(target)) {
        return;
      }

      setIsNewSessionMenuOpen(false);
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isNewSessionMenuOpen]);

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
  const workspaceCache = useSessionWorkspaceCache({
    projectId,
    sessionId: currentSessionId,
    isSidePanelOpen: isSessionSidePanelOpen && selectedSession !== null,
  });
  const sessionTransitionPhase = getSessionTransitionPhase(selectedSession);
  const selectedTerminalPanelState =
    currentSessionId == null
      ? null
      : (terminalPanelStateBySessionId[currentSessionId] ?? null);
  const isTerminalPanelVisible =
    selectedTerminalPanelState != null &&
    (selectedTerminalPanelState.terminals.length > 0 ||
      selectedTerminalPanelState.isCreating ||
      selectedTerminalPanelState.errorMessage != null);
  const transitionButtonLabel =
    sessionTransitionPhase === "running"
      ? messages.agentsFeature.markReview
      : sessionTransitionPhase === "review"
        ? messages.agentsFeature.markDone
        : null;
  const transitionMenuOptions =
    sessionTransitionPhase === "running"
      ? ([
          { action: "review", label: messages.agentsFeature.review },
          { action: "done", label: messages.agentsFeature.done },
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
    isDetectingAgentCommitCompletion ||
    isDeletingSession;
  const isAgentCommitPreviewPending =
    isCompletingManual ||
    isSendingAgentCommitPrompt ||
    isDetectingAgentCommitCompletion;
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
    if (isAgentCommitPreviewPending) {
      return;
    }
    setAgentCommitPreview(null);
  }

  async function handleCompleteAgentCommitPreviewManually() {
    if (!linkedIssue || !selectedSession) {
      return;
    }

    const currentSession =
      sessions.find(
        (session) => session.sessionId === selectedSession.sessionId,
      ) ?? selectedSession;

    setCompleteAgentCommitErrorMessage(null);
    await completeLinkedIssueManual(linkedIssue, currentSession);
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

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      const dragState = dragStateRef.current;
      if (dragState) {
        const deltaX = event.clientX - dragState.startX;
        const nextWidth = Math.max(
          AGENTS_SIDEBAR_MIN_WIDTH,
          Math.min(AGENTS_SIDEBAR_MAX_WIDTH, dragState.startWidth + deltaX),
        );
        setSidebarWidth(nextWidth);
      }

      const sidePanelDragState = sidePanelDragStateRef.current;
      if (sidePanelDragState) {
        const deltaX = event.clientX - sidePanelDragState.startX;
        const nextWidth = clampSessionSidePanelWidth(
          sidePanelDragState.startWidth - deltaX,
        );
        setSessionSidePanelWidth(nextWidth);
      }

      const terminalPanelDragState = terminalPanelDragStateRef.current;
      if (terminalPanelDragState) {
        const deltaY = event.clientY - terminalPanelDragState.startY;
        const nextHeight = clampSessionTerminalPanelHeight(
          terminalPanelDragState.startHeight - deltaY,
        );
        setTerminalPanelStateBySessionId((currentStateBySessionId) => ({
          ...currentStateBySessionId,
          [terminalPanelDragState.sessionId]: {
            ...(currentStateBySessionId[terminalPanelDragState.sessionId] ??
              createDefaultSessionInlineTerminalPanelState()),
            height: nextHeight,
          },
        }));
      }
    }

    function handleMouseUp() {
      dragStateRef.current = null;
      sidePanelDragStateRef.current = null;
      terminalPanelDragStateRef.current = null;
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

  function setTerminalPanelState(
    sessionId: number,
    updater: (
      currentState: SessionInlineTerminalPanelState,
    ) => SessionInlineTerminalPanelState | null,
  ) {
    setTerminalPanelStateBySessionId((currentStateBySessionId) => {
      const currentState =
        currentStateBySessionId[sessionId] ??
        createDefaultSessionInlineTerminalPanelState();
      const nextState = updater(currentState);
      if (nextState === null) {
        const { [sessionId]: _removedState, ...remainingStateBySessionId } =
          currentStateBySessionId;
        return remainingStateBySessionId;
      }

      return {
        ...currentStateBySessionId,
        [sessionId]: nextState,
      };
    });
  }

  async function createInlineTerminal(agentSessionId: number) {
    const currentState = terminalPanelStateBySessionId[agentSessionId];
    if (currentState?.isCreating) {
      return;
    }

    setTerminalPanelState(agentSessionId, (panelState) => ({
      ...panelState,
      errorMessage: null,
      isCreating: true,
    }));

    try {
      const terminal = await createTemporaryProjectTerminal({
        projectId,
        agentSessionId,
      });
      setTerminalPanelState(agentSessionId, (panelState) => ({
        ...panelState,
        activeTerminalSessionId: terminal.sessionId,
        errorMessage: null,
        isCreating: false,
        isMaximized: false,
        terminals: [
          ...panelState.terminals,
          {
            terminalSessionId: terminal.sessionId,
            name: terminal.name,
            workingDir: terminal.workingDir,
            launchCommand: terminal.launchCommand,
          },
        ],
      }));
    } catch (error) {
      setTerminalPanelState(agentSessionId, (panelState) => ({
        ...panelState,
        errorMessage: toCommandError(error).message,
        isCreating: false,
      }));
    }
  }

  function handleOpenTerminalPanel() {
    if (!selectedSession) {
      return;
    }

    const panelState = terminalPanelStateBySessionId[selectedSession.sessionId];
    if (panelState?.terminals.length) {
      setTerminalPanelState(selectedSession.sessionId, (currentState) => ({
        ...currentState,
        isMaximized: false,
      }));
      return;
    }

    void createInlineTerminal(selectedSession.sessionId);
  }

  async function handleDeleteSession() {
    if (!selectedSession || selectedSession.issueId !== null) {
      return;
    }

    const confirmed = await confirm({
      message: messages.agentsFeature.confirmDeleteSession,
    });
    if (!confirmed) {
      return;
    }

    const deletedSessionId = selectedSession.sessionId;
    setIsTransitionMenuOpen(false);
    setDeleteSessionErrorMessage(null);
    setIsDeletingSession(true);

    try {
      await deleteAgentSession({ projectId, sessionId: deletedSessionId });
      setTerminalPanelStateBySessionId(
        ({ [deletedSessionId]: _deletedState, ...remainingState }) =>
          remainingState,
      );
      setSessions((currentSessions) =>
        currentSessions.filter(
          (session) => session.sessionId !== deletedSessionId,
        ),
      );
      const refreshedSessions = await refreshSessions();
      const nextSelectedSession =
        refreshedSessions.find(
          (session) => getSessionIssueGroup(session) !== null,
        ) ?? null;
      setSelectedSessionId(nextSelectedSession?.sessionId ?? null);
      if (nextSelectedSession) {
        onSelectSession?.(nextSelectedSession.sessionId);
      }
      toast.success(messages.toast.deleteSuccess);
    } catch (error) {
      setDeleteSessionErrorMessage(toCommandError(error).message);
      try {
        await refreshSessions();
      } catch {
        // Keep the command failure visible; polling can retry the refresh.
      }
    } finally {
      setIsDeletingSession(false);
    }
  }

  async function handleCloseInlineTerminal(terminalSessionId: number) {
    if (!selectedSession) {
      return;
    }

    const agentSessionId = selectedSession.sessionId;
    setTerminalPanelState(agentSessionId, (panelState) => ({
      ...panelState,
      closingTerminalSessionIds: [
        ...panelState.closingTerminalSessionIds,
        terminalSessionId,
      ],
      errorMessage: null,
    }));

    try {
      await closeProjectTerminal({ projectId, sessionId: terminalSessionId });
      setTerminalPanelState(agentSessionId, (panelState) => {
        const remainingTerminals = panelState.terminals.filter(
          (terminal) => terminal.terminalSessionId !== terminalSessionId,
        );
        if (remainingTerminals.length === 0) {
          return null;
        }

        const activeTerminalSessionId =
          panelState.activeTerminalSessionId === terminalSessionId
            ? remainingTerminals[0].terminalSessionId
            : panelState.activeTerminalSessionId;

        return {
          ...panelState,
          activeTerminalSessionId,
          closingTerminalSessionIds:
            panelState.closingTerminalSessionIds.filter(
              (closingTerminalSessionId) =>
                closingTerminalSessionId !== terminalSessionId,
            ),
          terminals: remainingTerminals,
        };
      });
    } catch (error) {
      setTerminalPanelState(agentSessionId, (panelState) => ({
        ...panelState,
        closingTerminalSessionIds: panelState.closingTerminalSessionIds.filter(
          (closingTerminalSessionId) =>
            closingTerminalSessionId !== terminalSessionId,
        ),
        errorMessage: toCommandError(error).message,
      }));
    }
  }

  function handleSelectInlineTerminal(terminalSessionId: number) {
    if (!selectedSession) {
      return;
    }

    setTerminalPanelState(selectedSession.sessionId, (panelState) => ({
      ...panelState,
      activeTerminalSessionId: terminalSessionId,
    }));
  }

  function handleToggleTerminalPanelMaximized() {
    if (!selectedSession) {
      return;
    }

    setTerminalPanelState(selectedSession.sessionId, (panelState) => ({
      ...panelState,
      isMaximized: !panelState.isMaximized,
    }));
  }

  function handleTerminalPanelSplitterMouseDown(event: ReactMouseEvent) {
    if (event.button !== 0 || !selectedSession || !selectedTerminalPanelState) {
      return;
    }

    event.preventDefault();
    terminalPanelDragStateRef.current = {
      sessionId: selectedSession.sessionId,
      startHeight: selectedTerminalPanelState.height,
      startY: event.clientY,
    };
    window.document.body.style.cursor = "row-resize";
    window.document.body.style.userSelect = "none";
  }

  function handleSidePanelSplitterMouseDown(event: ReactMouseEvent) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    sidePanelDragStateRef.current = {
      startWidth: sessionSidePanelWidth,
      startX: event.clientX,
    };
    window.document.body.style.cursor = "col-resize";
    window.document.body.style.userSelect = "none";
  }

  async function handleTemporarySessionStarted(
    result: StartStructuredAgentSessionResult,
  ) {
    const response = await listAgentSessions(projectId);
    setSessions(applySessionListOverlays(response.sessions));
    setIsSessionSidePanelOpen(false);
    setSelectedSessionId(result.sessionId);
    onSelectSession?.(result.sessionId);
  }

  async function createSession(agentType: AgentType) {
    if (isCreatingSession) {
      return;
    }

    const selectedProfile = availableAgentProfiles.find(
      (profile) => profile.agentType === agentType,
    );
    if (selectedProfile == null) {
      toast.error(messages.agentsFeature.noProfilesForAgentType);
      return;
    }

    setIsCreatingSession(true);
    setIsNewSessionMenuOpen(false);

    try {
      const result = await startStructuredAgentSession({
        projectId,
        title: messages.agentsFeature.temporarySessionDefaultTitle,
        agentType,
        agentProfileId: selectedProfile.id,
      });
      await handleTemporarySessionStarted(result);
    } catch (error) {
      toast.error(toCommandError(error).message);
    } finally {
      setIsCreatingSession(false);
      window.requestAnimationFrame(() => {
        newSessionButtonRef.current?.focus();
      });
    }
  }

  return (
    <main
      className="activity-surface activity-surface--agents"
      style={
        {
          "--agents-sidebar-width": `${sidebarWidth}px`,
          "--session-side-panel-width": `${sessionSidePanelWidth}px`,
        } as CSSProperties
      }
    >
      <AgentsSessionList
        availableAgentTypes={availableAgentTypes}
        errorMessage={errorMessage}
        isLoading={isLoading}
        isNewSessionMenuOpen={isNewSessionMenuOpen}
        isNewSessionDisabled={
          isLoadingAgentTypes ||
          isCreatingSession ||
          availableAgentTypes.length === 0
        }
        newSessionButtonRef={newSessionButtonRef}
        onCreateSession={(agentType) => {
          void createSession(agentType);
        }}
        onNewSessionMenuOpenChange={setIsNewSessionMenuOpen}
        onSelectSession={handleSelectSession}
        selectedSessionId={selectedSession?.sessionId ?? null}
        sessions={visibleSessions}
        title={messages.app.agents}
      />

      <div
        aria-label={messages.agentsFeature.resizeSessionList}
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
          isSessionSidePanelOpen && selectedSession
            ? " agents-workspace--with-side-panel"
            : ""
        }`}
        aria-label={messages.agentsFeature.sessionWorkspace}
      >
        <AgentsSessionPane
          agentCommitErrorMessage={completeAgentCommitErrorMessage}
          attentionErrorMessage={attentionErrorMessage}
          canRenderTransitionButton={canRenderTransitionButton}
          canRenderTransitionMenu={canRenderTransitionMenu}
          cleanErrorMessage={completeCleanErrorMessage}
          deleteSessionErrorMessage={deleteSessionErrorMessage}
          isTransitionMenuOpen={isTransitionMenuOpen}
          isTransitionPending={isTransitionPending}
          activeWorkspaceTab={workspaceCache.activeWorkspaceTab}
          changeTab={workspaceCache.changeTab}
          fileTab={workspaceCache.fileTab}
          isDeletingSession={isDeletingSession}
          isSidePanelOpen={isSessionSidePanelOpen}
          isTerminalPanelActive={isTerminalPanelVisible}
          linkedIssue={linkedIssue}
          manualErrorMessage={completeManualErrorMessage}
          markReviewErrorMessage={markReviewErrorMessage}
          onAcknowledgeSessionAttention={(sessionId) => {
            void acknowledgeSessionAttention(sessionId);
          }}
          onCloseWorkspaceTab={workspaceCache.closeWorkspaceTab}
          onDeleteSession={() => {
            void handleDeleteSession();
          }}
          onOpenTerminalPanel={handleOpenTerminalPanel}
          onSelectWorkspaceTab={workspaceCache.selectWorkspaceTab}
          onTerminalPanelSplitterMouseDown={
            handleTerminalPanelSplitterMouseDown
          }
          onToggleSidePanel={() =>
            setIsSessionSidePanelOpen(
              (currentIsSessionSidePanelOpen) => !currentIsSessionSidePanelOpen,
            )
          }
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
          terminalPanel={
            selectedSession && selectedTerminalPanelState ? (
              <SessionInlineTerminalPanel
                agentSessionId={selectedSession.sessionId}
                projectId={projectId}
                state={selectedTerminalPanelState}
                onCloseTerminal={(terminalSessionId) => {
                  void handleCloseInlineTerminal(terminalSessionId);
                }}
                onCreateTerminal={(agentSessionId) => {
                  void createInlineTerminal(agentSessionId);
                }}
                onSelectTerminal={handleSelectInlineTerminal}
                onToggleMaximized={handleToggleTerminalPanelMaximized}
              />
            ) : null
          }
          terminalPanelHeight={
            selectedTerminalPanelState?.isMaximized
              ? 0
              : (selectedTerminalPanelState?.height ??
                DEFAULT_SESSION_TERMINAL_PANEL_HEIGHT)
          }
          transitionButtonLabel={transitionButtonLabel}
          transitionMenuOptions={transitionMenuOptions}
          transitionPhase={sessionTransitionPhase}
        />
        {isSessionSidePanelOpen && selectedSession ? (
          <>
            <div
              aria-label={messages.agentsFeature.resizeSessionSidePanel}
              aria-orientation="vertical"
              aria-valuemax={SESSION_SIDE_PANEL_MAX_WIDTH}
              aria-valuemin={SESSION_SIDE_PANEL_MIN_WIDTH}
              aria-valuenow={sessionSidePanelWidth}
              className="session-side-panel-splitter"
              role="separator"
              tabIndex={0}
              onMouseDown={handleSidePanelSplitterMouseDown}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  setSessionSidePanelWidth((currentWidth) =>
                    clampSessionSidePanelWidth(
                      currentWidth + SIDEBAR_RESIZE_STEP,
                    ),
                  );
                }

                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  setSessionSidePanelWidth((currentWidth) =>
                    clampSessionSidePanelWidth(
                      currentWidth - SIDEBAR_RESIZE_STEP,
                    ),
                  );
                }

                if (event.key === "Home") {
                  event.preventDefault();
                  setSessionSidePanelWidth(SESSION_SIDE_PANEL_DEFAULT_WIDTH);
                }

                if (event.key === "End") {
                  event.preventDefault();
                  setSessionSidePanelWidth(SESSION_SIDE_PANEL_MAX_WIDTH);
                }
              }}
            />
            <SessionSidePanel
              activeTab={workspaceCache.sidePanelTab}
              changes={workspaceCache.changes}
              changesErrorMessage={workspaceCache.changesErrorMessage}
              fileTree={workspaceCache.fileTree}
              fileTreeErrorMessage={workspaceCache.fileTreeErrorMessage}
              isChangesLoading={workspaceCache.isChangesLoading}
              isFileTreeLoading={workspaceCache.isFileTreeLoading}
              onActiveTabChange={workspaceCache.setSidePanelTab}
              onOpenChangedFile={(file) => {
                void workspaceCache.openChange(file);
              }}
              onOpenFile={(file) => {
                void workspaceCache.openFile(file);
              }}
              onRefreshChanges={() => {
                void workspaceCache.refreshChanges();
              }}
            />
          </>
        ) : null}
      </section>

      {agentCommitPreview ? (
        <div className="issue-dialog-overlay">
          <div
            aria-label={messages.agentsFeature.completionConfirmation}
            aria-modal="true"
            className="issue-dialog issue-dialog--compact"
            role="dialog"
          >
            <div className="issue-dialog__header">
              <h3>{messages.agentsFeature.completionConfirmation}</h3>
              <button
                aria-label={messages.agentsFeature.closeCompletionConfirmation}
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
                  <h4>{messages.agentsFeature.gitSummary}</h4>
                  <p>{messages.agentsFeature.head(agentCommitPreview.head)}</p>
                  <p>
                    {messages.agentsFeature.changedFilesCount(
                      agentCommitPreview.changedFilesCount,
                    )}
                  </p>
                  <p>
                    {messages.agentsFeature.completionOption(
                      agentCommitPreview.option,
                    )}
                  </p>
                </section>
                <section className="issue-dialog__panel">
                  <h4>{messages.agentsFeature.changedFiles}</h4>
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
                    <p>{messages.agentsFeature.noChangedFiles}</p>
                  )}
                </section>
              </div>
            </div>
            <div className="issue-dialog__footer issue-dialog__footer--end">
              <button
                className="issues-button issues-button--primary"
                disabled={isAgentCommitPreviewPending}
                type="button"
                onClick={() => void handleConfirmAgentCommit()}
              >
                提交代码
              </button>
              <button
                className="issues-button"
                disabled={isAgentCommitPreviewPending}
                type="button"
                onClick={() => void handleCompleteAgentCommitPreviewManually()}
              >
                标记完成
              </button>
              <button
                className="issues-button"
                disabled={isAgentCommitPreviewPending}
                type="button"
                onClick={handleCloseAgentCommitPreview}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmationDialog}
    </main>
  );
}

function clampSessionSidePanelWidth(width: number) {
  return Math.min(
    SESSION_SIDE_PANEL_MAX_WIDTH,
    Math.max(SESSION_SIDE_PANEL_MIN_WIDTH, width),
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
