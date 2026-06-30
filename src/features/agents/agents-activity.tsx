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
  updateAgentSessionTitle,
  type StartStructuredAgentSessionResult,
  type AgentSessionListItem,
} from "./agent-session-commands";
import {
  DEFAULT_ACTIVITY_SIDEBAR_WIDTH,
  SIDEBAR_RESIZE_STEP,
} from "../../shared/layout/sidebar-width";
import {
  completeIssueFlow,
  markIssueReview,
  prepareAgentCommitCompletion,
  type AgentCommitCompletionPreview,
  type IssueRecord,
} from "../issues/issue-commands";
import { toCommandError } from "../../shared/commands/command-error";
import type { ProjectCompletionPolicy } from "../project/project-commands";
import { useI18n } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
import { LoadingDialog } from "@/components/ui/loading-dialog";
import { useAlertDialog } from "@/components/ui/use-alert-dialog";
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
import { subscribeAgentSessionListChanged } from "./agent-session-events";
import { getSessionIssueGroup } from "./agent-session-formatters";
import { SessionSidePanel } from "./session-side-panel";
import {
  createDefaultSessionInlineTerminalPanelState,
  type SessionInlineTerminalPanelState,
} from "./session-inline-terminal-panel-state";
import { SessionBrowserTab } from "./session-browser-tab";
import { SessionTerminalTab } from "./session-terminal-tab";
import type { SessionWorkspaceToolTabKind } from "./session-workspace-types";
import { useSessionWorkspaceCache } from "./use-session-workspace-cache";
import {
  closeProjectTerminal,
  createTemporaryProjectTerminal,
} from "../terminals/project-terminal-commands";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";

const SESSION_LIST_EVENT_REFRESH_DEBOUNCE_MS = 500;
const AGENTS_SIDEBAR_DEFAULT_WIDTH = DEFAULT_ACTIVITY_SIDEBAR_WIDTH;
const AGENTS_SIDEBAR_MIN_WIDTH = DEFAULT_ACTIVITY_SIDEBAR_WIDTH;
const AGENTS_SIDEBAR_MAX_WIDTH = 450;
const SESSION_SIDE_PANEL_DEFAULT_WIDTH = 400;
const SESSION_SIDE_PANEL_MIN_WIDTH = 240;
const SESSION_SIDE_PANEL_MAX_WIDTH = 560;
const MAX_SESSION_TERMINAL_TABS = 10;

interface SessionBrowserToolTab {
  id: number;
}

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
  const { alertDialog, showAlert } = useAlertDialog();
  const showCommandErrorAlert = useCallback(
    (error: unknown) => {
      showAlert({ message: toCommandError(error).message, type: "error" });
    },
    [showAlert],
  );
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
  const [
    isCompletionLoadingDialogDismissed,
    setIsCompletionLoadingDialogDismissed,
  ] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [isRenamingSessionTitle, setIsRenamingSessionTitle] = useState(false);
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
  const [browserTabsBySessionId, setBrowserTabsBySessionId] = useState<
    Record<number, SessionBrowserToolTab[]>
  >({});
  // 分离allSessions和visibleSessions，优化性能
  const [allSessions, setAllSessions] = useState<AgentSessionListItem[]>([]);
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
  const nextBrowserTabIdRef = useRef(1);
  const newSessionButtonRef = useRef<HTMLButtonElement | null>(null);
  const reviewedIssueIdsRef = useRef<Set<number>>(new Set());
  const completedIssueIdsRef = useRef<Set<number>>(new Set());
  const closedSessionIdsRef = useRef<Set<number>>(new Set());

  // 只在需要时计算visibleSessions
  const visibleSessions = useMemo(
    () => allSessions.filter((session) => getSessionIssueGroup(session) !== null),
    [allSessions],
  );

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

        setErrorMessage(toCommandError(error).message);
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
  const selectedBrowserTabs = useMemo(
    () =>
      currentSessionId == null
        ? []
        : (browserTabsBySessionId[currentSessionId] ?? []),
    [browserTabsBySessionId, currentSessionId],
  );
  const sessionToolTabs = useMemo(
    () => [
      ...(selectedTerminalPanelState?.terminals ?? []).map((terminal) => ({
        id: `terminal:${terminal.terminalSessionId}` as const,
        kind: "terminal" as const,
        label: terminal.name,
        content: (
          <SessionTerminalTab
            projectId={projectId}
            sessionId={terminal.terminalSessionId}
          />
        ),
      })),
      ...selectedBrowserTabs.map((tab, index) => ({
        id: `browser:${tab.id}` as const,
        kind: "browser" as const,
        label:
          index === 0
            ? messages.agentsFeature.browserTool
            : messages.agentsFeature.browserToolWithIndex(index + 1),
        content: <SessionBrowserTab />,
      })),
    ],
    [
      messages.agentsFeature,
      projectId,
      selectedBrowserTabs,
      selectedTerminalPanelState?.terminals,
    ],
  );
  const transitionButtonLabel =
    sessionTransitionPhase === "running"
      ? messages.agentsFeature.markReview
      : sessionTransitionPhase === "review"
        ? messages.agentsFeature.markDone
        : null;
  const transitionMenuOptions: Array<{
    action: SessionIssueTransition;
    label: string;
  }> =
    sessionTransitionPhase === "running"
      ? [
          { action: "review", label: messages.agentsFeature.review },
          { action: "done", label: messages.agentsFeature.done },
        ]
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
  const isCompletionCheckPending =
    isCompletingManual ||
    isCompletingClean ||
    isPreparingAgentCommit ||
    isSendingAgentCommitPrompt ||
    isDetectingAgentCommitCompletion;
  const isCompletionLoadingDialogOpen =
    isCompletionCheckPending && !isCompletionLoadingDialogDismissed;

  useEffect(() => {
    if (!isCompletionCheckPending) {
      setIsCompletionLoadingDialogDismissed(false);
    }
  }, [isCompletionCheckPending]);
  const refreshSessions = useCallback(async () => {
    const response = await listAgentSessions(projectId);
    const nextSessions = applySessionListOverlays(response.sessions);
    setAllSessions(nextSessions);
    return nextSessions;
  }, [applySessionListOverlays, projectId]);

  async function acknowledgeSessionAttention(sessionId: number) {
    const targetSession = allSessions.find(
      (session) => session.sessionId === sessionId,
    );
    if (targetSession == null || targetSession.status !== "running") {
      return;
    }

    if (targetSession.attention === "requested") {
      if (isUpdatingAttention) {
        return;
      }

      setIsUpdatingAttention(true);

      try {
        await setAgentSessionAttention({
          projectId,
          sessionId,
          attention: "none",
        });
        const response = await listAgentSessions(projectId);
        const nextSessions = applySessionListOverlays(response.sessions);
        setAllSessions(nextSessions);
      } catch (error) {
        showCommandErrorAlert(error);
      } finally {
        setIsUpdatingAttention(false);
      }

      return;
    }
  }

  function handleSelectSession(sessionId: number) {
    setIsTransitionMenuOpen(false);
    // 立即更新 selectedSessionId，确保 UI 立即响应
    setSelectedSessionId(sessionId);
    onSelectSession?.(sessionId);
    // 异步处理 attention 确认，不阻塞 UI
    void acknowledgeSessionAttention(sessionId);
  }

  async function markLinkedIssueReview(issue: NonNullable<typeof linkedIssue>) {
    setIsTransitionMenuOpen(false);
    setIsMarkingReview(true);

    let reviewedIssueId: number | null = null;

    try {
      const reviewedIssue = await markIssueReview({
        projectId,
        issueId: issue.issueId,
      });
      reviewedIssueId = reviewedIssue.id;
      reviewedIssueIdsRef.current.add(reviewedIssue.id);
      setAllSessions((currentSessions) =>
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
      showCommandErrorAlert(error);
      try {
        await refreshSessions();
      } catch {
        // Keep the command failure visible; future session events can retry refresh.
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
      showCommandErrorAlert(error);
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

  function applyCompletedIssueToSessions(
    completedIssue: IssueRecord,
    targetSessionId: number,
  ) {
    completedIssueIdsRef.current.add(completedIssue.id);
    closedSessionIdsRef.current.add(targetSessionId);
    setAllSessions((currentSessions) =>
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
              canCompleteClean: false,
              canCompleteAgentCommit: false,
            }
          : session,
      ),
    );
  }

  function showIssueMarkedDoneToast() {
    toast.success(messages.toast.issueMarkedDone);
  }

  async function completeLinkedIssueViaFlow(
    issueId: number,
    options: { ignoreDirty?: boolean } = {},
  ) {
    const result = await completeIssueFlow({
      projectId,
      issueId,
      ignoreDirty: options.ignoreDirty ?? undefined,
    });
    if (result.action !== "completed") {
      throw new Error(result.message);
    }
    return result.issue;
  }

  async function completeLinkedIssueManual(
    issue: NonNullable<typeof linkedIssue>,
    session: AgentSessionListItem,
    options: { ignoreDirty?: boolean } = {},
  ) {
    const targetSessionId = session.sessionId;
    setIsTransitionMenuOpen(false);
    setIsCompletingManual(true);

    let completedIssueId: number | null = null;
    let completedSessionId: number | null = null;

    try {
      const completedIssue = await completeLinkedIssueViaFlow(
        issue.issueId,
        options,
      );
      completedIssueId = completedIssue.id;
      completedSessionId = session.sessionId;
      applyCompletedIssueToSessions(completedIssue, targetSessionId);
      showIssueMarkedDoneToast();
    } catch (error) {
      showCommandErrorAlert(error);
      try {
        await refreshSessions();
      } catch {
        // Keep the command failure visible; future session events can retry refresh.
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
      showCommandErrorAlert(error);
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
    setIsCompletingClean(true);

    let completedIssueId: number | null = null;
    let completedSessionId: number | null = null;

    try {
      const completedIssue = await completeLinkedIssueViaFlow(issue.issueId);
      completedIssueId = completedIssue.id;
      completedSessionId = session.sessionId;
      applyCompletedIssueToSessions(completedIssue, targetSessionId);
      showIssueMarkedDoneToast();
    } catch (error) {
      showCommandErrorAlert(error);
      try {
        await refreshSessions();
      } catch {
        // Keep the command failure visible; future session events can retry refresh.
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
      showCommandErrorAlert(error);
    } finally {
      setIsCompletingClean(false);
    }
  }

  async function prepareLinkedIssueAgentCommit(
    issue: NonNullable<typeof linkedIssue>,
    session: AgentSessionListItem,
  ) {
    setIsTransitionMenuOpen(false);
    setIsPreparingAgentCommit(true);

    try {
      const preview = await prepareAgentCommitCompletion({
        projectId,
        issueId: issue.issueId,
      });
      setAgentCommitPreview(preview);
    } catch (error) {
      const commandError = toCommandError(error);
      if (isCleanWorktreeAgentCommitPreviewError(commandError)) {
        await completeLinkedIssueClean(issue, session);
      } else {
        showAlert({ message: commandError.message, type: "error" });
      }
    } finally {
      setIsPreparingAgentCommit(false);
    }
  }

  async function handleMarkDone() {
    if (!linkedIssue || !selectedSession) {
      return;
    }

    const currentSession =
      allSessions.find(
        (session: AgentSessionListItem) => session.sessionId === selectedSession.sessionId,
      ) ?? selectedSession;
    let nextSession = currentSession;

    // 如果 session 已关闭，直接完成，不需要先标记为 review
    const isSessionClosed = currentSession.status === "closed";

    if (currentSession.issueStatus === "running" && !isSessionClosed) {
      const refreshedSessions = await markLinkedIssueReview(linkedIssue);
      if (!refreshedSessions) {
        return;
      }

      nextSession = refreshedSessions.find(
        (session) => session.sessionId === currentSession.sessionId,
      ) ?? { ...currentSession, issueStatus: "review" as const };
    }

    if (projectCompletionPolicy === "manual" || isSessionClosed) {
      await completeLinkedIssueManual(linkedIssue, nextSession);
      return;
    }

    if (nextSession.canCompleteClean) {
      await completeLinkedIssueClean(linkedIssue, nextSession);
      return;
    }

    if (nextSession.canCompleteAgentCommit) {
      await prepareLinkedIssueAgentCommit(linkedIssue, nextSession);
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
      allSessions.find(
        (session: AgentSessionListItem) => session.sessionId === selectedSession.sessionId,
      ) ?? selectedSession;

    await completeLinkedIssueManual(linkedIssue, currentSession, {
      ignoreDirty: true,
    });
    setAgentCommitPreview(null);
  }

  async function handleConfirmAgentCommit() {
    if (!linkedIssue || !agentCommitPreview || !selectedSession) {
      return;
    }

    setIsSendingAgentCommitPrompt(true);

    try {
      let completionResult = await completeIssueFlow({
        projectId,
        issueId: linkedIssue.issueId,
      });
      setIsDetectingAgentCommitCompletion(true);
      if (completionResult.action === "waiting_agent_commit") {
        completionResult = await completeIssueFlow({
          projectId,
          issueId: linkedIssue.issueId,
        });
      }
      if (completionResult.action === "completed") {
        applyCompletedIssueToSessions(
          completionResult.issue,
          selectedSession.sessionId,
        );
        showIssueMarkedDoneToast();
        setAgentCommitPreview(null);
        const response = await listAgentSessions(projectId);
        setAllSessions(applySessionListOverlays(response.sessions));
      } else {
        setAgentCommitPreview(null);
        showAlert({ message: completionResult.message, type: "error" });
      }
    } catch (error) {
      showCommandErrorAlert(error);
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
    }

    function handleMouseUp() {
      dragStateRef.current = null;
      sidePanelDragStateRef.current = null;
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

    if ((currentState?.terminals.length ?? 0) >= MAX_SESSION_TERMINAL_TABS) {
      toast.error(messages.agentsFeature.sessionTerminalLimit);
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
      workspaceCache.selectWorkspaceTab(`terminal:${terminal.sessionId}`);
    } catch (error) {
      toast.error(toCommandError(error).message);
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

    void createInlineTerminal(selectedSession.sessionId);
  }

  function handleCreateBrowserTab() {
    if (!selectedSession) {
      return;
    }

    const browserTab: SessionBrowserToolTab = {
      id: nextBrowserTabIdRef.current,
    };
    nextBrowserTabIdRef.current += 1;
    setBrowserTabsBySessionId((currentTabsBySessionId) => ({
      ...currentTabsBySessionId,
      [selectedSession.sessionId]: [
        ...(currentTabsBySessionId[selectedSession.sessionId] ?? []),
        browserTab,
      ],
    }));
    workspaceCache.selectWorkspaceTab(`browser:${browserTab.id}`);
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
    setIsDeletingSession(true);

    try {
      await deleteAgentSession({ projectId, sessionId: deletedSessionId });
      setTerminalPanelStateBySessionId(
        ({ [deletedSessionId]: _deletedState, ...remainingState }) =>
          remainingState,
      );
      setBrowserTabsBySessionId(
        ({ [deletedSessionId]: _deletedState, ...remainingState }) =>
          remainingState,
      );
      setAllSessions((currentSessions) =>
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
      showCommandErrorAlert(error);
      try {
        await refreshSessions();
      } catch {
        // Keep the command failure visible; future session events can retry refresh.
      }
    } finally {
      setIsDeletingSession(false);
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

  function handleCloseWorkspaceTab(
    tab: Exclude<SessionWorkspaceToolTabKind | "file" | "changes", "session">,
  ) {
    if (isTerminalToolTab(tab)) {
      void handleCloseInlineTerminal(Number(tab.slice("terminal:".length)));
      return;
    }

    if (isBrowserToolTab(tab)) {
      const browserTabId = Number(tab.slice("browser:".length));
      if (!selectedSession) {
        return;
      }

      setBrowserTabsBySessionId((currentTabsBySessionId) => {
        const remainingTabs = (
          currentTabsBySessionId[selectedSession.sessionId] ?? []
        ).filter((browserTab) => browserTab.id !== browserTabId);
        if (remainingTabs.length === 0) {
          const { [selectedSession.sessionId]: _removed, ...remaining } =
            currentTabsBySessionId;
          return remaining;
        }

        return {
          ...currentTabsBySessionId,
          [selectedSession.sessionId]: remainingTabs,
        };
      });
      if (workspaceCache.activeWorkspaceTab === tab) {
        workspaceCache.selectWorkspaceTab("session");
      }
      return;
    }

    workspaceCache.closeWorkspaceTab(tab);
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
    setAllSessions(applySessionListOverlays(response.sessions));
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
          canRenderTransitionButton={canRenderTransitionButton}
          canRenderTransitionMenu={canRenderTransitionMenu}
          isTransitionMenuOpen={isTransitionMenuOpen}
          isTransitionPending={isTransitionPending}
          activeWorkspaceTab={workspaceCache.activeWorkspaceTab}
          changeTab={workspaceCache.changeTab}
          fileTab={workspaceCache.fileTab}
          isDeletingSession={isDeletingSession}
          isRenamingSessionTitle={isRenamingSessionTitle}
          isSidePanelOpen={isSessionSidePanelOpen}
          linkedIssue={linkedIssue}
          onAcknowledgeSessionAttention={(sessionId) => {
            void acknowledgeSessionAttention(sessionId);
          }}
          onCloseWorkspaceTab={handleCloseWorkspaceTab}
          onCreateBrowserTab={handleCreateBrowserTab}
          onCreateTerminalTab={handleOpenTerminalPanel}
          onDeleteSession={() => {
            void handleDeleteSession();
          }}
          onRenameSessionTitle={handleRenameSessionTitle}
          onSelectWorkspaceTab={workspaceCache.selectWorkspaceTab}
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
          toolTabs={sessionToolTabs}
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
              commitHistory={workspaceCache.commitHistory}
              commitHistoryErrorMessage={
                workspaceCache.commitHistoryErrorMessage
              }
              fileTree={workspaceCache.fileTree}
              fileTreeErrorMessage={workspaceCache.fileTreeErrorMessage}
              isCommitHistoryLoading={workspaceCache.isCommitHistoryLoading}
              isChangesLoading={workspaceCache.isChangesLoading}
              isFileTreeLoading={workspaceCache.isFileTreeLoading}
              onActiveTabChange={workspaceCache.setSidePanelTab}
              onOpenChangedFile={(file) => {
                void workspaceCache.openChange(file);
              }}
              onOpenCommittedChangedFile={(commitHash, file) => {
                void workspaceCache.openCommittedChange(commitHash, file);
              }}
              onOpenFile={(file) => {
                void workspaceCache.openFile(file);
              }}
              onRefreshCommitHistory={() => {
                void workspaceCache.refreshCommitHistory();
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
                {messages.agentsFeature.completionSubmitCode}
              </button>
              <button
                className="issues-button"
                disabled={isAgentCommitPreviewPending}
                type="button"
                onClick={() => void handleCompleteAgentCommitPreviewManually()}
              >
                {messages.agentsFeature.completionMarkDone}
              </button>
              <button
                className="issues-button"
                disabled={isAgentCommitPreviewPending}
                type="button"
                onClick={handleCloseAgentCommitPreview}
              >
                {messages.agentsFeature.completionCancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <LoadingDialog
        closeLabel={messages.agentsFeature.closeCompletionLoading}
        message={messages.agentsFeature.completionSubmitting}
        open={isCompletionLoadingDialogOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setIsCompletionLoadingDialogDismissed(true);
          }
        }}
      />
      {alertDialog}
      {confirmationDialog}
    </main>
  );
}

function isCleanWorktreeAgentCommitPreviewError(error: {
  code: string;
  message: string;
  details?: Array<Record<string, unknown>>;
}) {
  return (
    error.code === "ISSUE_VALIDATION_FAILED" &&
    error.details?.some(
      (detail) => detail["@type"] === "GitStatus" && detail.isClean === true,
    ) === true
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

function isTerminalToolTab(
  tab: Exclude<SessionWorkspaceToolTabKind | "file" | "changes", "session">,
): tab is `terminal:${number}` {
  return tab.startsWith("terminal:");
}

function isBrowserToolTab(
  tab: Exclude<SessionWorkspaceToolTabKind | "file" | "changes", "session">,
): tab is `browser:${number}` {
  return tab.startsWith("browser:");
}
