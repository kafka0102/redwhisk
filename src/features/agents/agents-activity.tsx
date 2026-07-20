import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  deleteAgentSession,
  type AgentSessionListItem,
} from "./agent-session-commands";
import { clearComposerDraft } from "./composer/use-agent-composer";
import type { IssueOpenRequest } from "../issues/issue-open-request";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
import { LoadingDialog } from "@/components/ui/loading-dialog";
import { useAlertDialog } from "@/components/ui/use-alert-dialog";
import { AgentsSessionList } from "./session-list/agents-session-list";
import { type AgentProfileRecord } from "../settings/settings-commands";
import {
  AgentsSessionPane,
  type LinkedSessionIssue,
  type SessionWorkspaceEntry,
} from "./session-pane/agents-session-pane";
import { getSessionIssueGroup } from "./agent-session-formatters";
import { applySessionOverlays } from "./agent-session-overlays";
import {
  AGENTS_SIDEBAR_MAX_WIDTH,
  AGENTS_SIDEBAR_MIN_WIDTH,
  SESSION_SIDE_PANEL_MAX_WIDTH,
  SESSION_SIDE_PANEL_MIN_WIDTH,
  useSplitterDrag,
} from "./use-splitter-drag";
import { useSessionToolTabs } from "./use-session-tool-tabs";
import { useAgentSessionList } from "./use-agent-session-list";
import { useAgentSessionCompletionFlow } from "./use-agent-session-completion-flow";
import { AgentCompletionPreviewDialog } from "./agent-completion-preview-dialog";
import { AgentMergePromptDialog } from "./agent-merge-prompt-dialog";
import { SessionSidePanel } from "./session-side-panel/session-side-panel";
import { SessionBrowserTab } from "./session-workspace/session-browser-tab";
import { SessionTerminalTab } from "./session-workspace/session-terminal-tab";
import type { SessionWorkspaceToolTab } from "./session-workspace/session-workspace-tabs";
import { useSessionWorkspaceCache } from "./session-workspace/use-session-workspace-cache";
import { useSessionPaneCache } from "./session-pane/use-session-pane-cache";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import {
  getSessionReturnState,
  setSessionReturnState,
} from "./session-pane/session-return-cache";

// 实例池上限：与 use-agent-message-stream.ts 的 MAX_CACHED_SESSIONS 对齐，
// 保证常驻 AgentSessionView 实例数量与消息流 state 缓存淘汰粒度一致。
const MAX_CACHED_SESSION_VIEWS = 5;

interface AgentsActivityProps {
  activeSessionId: number | null;
  onOpenIssue?: (request: IssueOpenRequest) => void;
  onOpenProjectAgentSettings?: () => void;
  onSelectSession?: (sessionId: number) => void;
  projectId: number;
}

export function AgentsActivity({
  activeSessionId,
  onOpenIssue,
  onOpenProjectAgentSettings,
  onSelectSession,
  projectId,
}: AgentsActivityProps) {
  const { locale, messages, t } = useI18n();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const { alertDialog, showAlert } = useAlertDialog();
  const showCommandErrorAlert = useCallback(
    (error: unknown) => {
      showAlert({ message: getCommandErrorMessage(error, t), type: "error" });
    },
    [showAlert, t],
  );
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [isRenamingSessionTitle, setIsRenamingSessionTitle] = useState(false);
  const [isLoadingAgentProfiles, setIsLoadingAgentProfiles] = useState(true);
  const [hasAgentProfilesLoadError, setHasAgentProfilesLoadError] =
    useState(false);
  const [availableAgentProfiles, setAvailableAgentProfiles] = useState<
    AgentProfileRecord[]
  >([]);
  const [isSessionSidePanelOpen, setIsSessionSidePanelOpen] = useState(false);
  const [isTransitionMenuOpen, setIsTransitionMenuOpen] = useState(false);
  // 分离allSessions和visibleSessions，优化性能
  const [allSessions, setAllSessions] = useState<AgentSessionListItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    activeSessionId,
  );
  // 控制是否延迟加载非关键内容，避免首次加载阻塞
  const [shouldLoadDeferredContent, setShouldLoadDeferredContent] =
    useState(false);

  const {
    sidebarWidth,
    sessionSidePanelWidth,
    handleSidebarSplitterMouseDown,
    handleSidebarSplitterKeyDown,
    handleSidePanelSplitterMouseDown,
    handleSidePanelSplitterKeyDown,
  } = useSplitterDrag();
  const reviewedIssueIdsRef = useRef<Set<number>>(new Set());
  const completedIssueIdsRef = useRef<Set<number>>(new Set());
  const closedSessionIdsRef = useRef<Set<number>>(new Set());

  // 只在需要时计算visibleSessions
  const visibleSessions = useMemo(
    () =>
      allSessions.filter((session) => getSessionIssueGroup(session) !== null),
    [allSessions],
  );

  const applySessionListOverlays = useCallback(
    (nextSessions: AgentSessionListItem[]) =>
      applySessionOverlays(
        nextSessions,
        reviewedIssueIdsRef.current,
        completedIssueIdsRef.current,
        closedSessionIdsRef.current,
      ),
    [],
  );

  const currentSessionId = shouldLoadDeferredContent
    ? ((visibleSessions.some(
        (session) => session.sessionId === selectedSessionId,
      )
        ? selectedSessionId
        : null) ??
      visibleSessions[0]?.sessionId ??
      null)
    : (selectedSessionId ?? visibleSessions[0]?.sessionId ?? null);

  const selectedSession =
    visibleSessions.find((session) => session.sessionId === currentSessionId) ??
    null;
  // 仅当 session 在可见列表中时才允许进入实例池。与 AgentsSessionPane 中
  // `selectedSession?.sessionId` 语义一致：避免在 loadSessions 完成前把
  // selectedSessionId 提前加入缓存，否则清理 effect 会因 visibleSessions 仍为空
  // 立刻把它移除，导致首次进入后实例池为空、workspace 不渲染。
  const cacheableSessionId = selectedSession?.sessionId ?? null;

  const linkedIssue: LinkedSessionIssue | null = useMemo(
    () =>
      selectedSession?.issueId != null && selectedSession.issueTitle
        ? {
            issueId: selectedSession.issueId,
            issueNumber: selectedSession.issueNumber ?? 0,
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
  const { setSidePanelTab, setSidePanelTabForSession, sidePanelTab } =
    workspaceCache;
  const {
    terminalPanelStateBySessionId,
    browserTabsBySessionId,
    handleOpenTerminalPanelForSession,
    handleCreateBrowserTabForSession,
    handleCloseWorkspaceTab,
    clearToolTabsForSession,
  } = useSessionToolTabs({
    projectId,
    messages,
    t,
    workspaceCache,
  });

  // 从缓存恢复离开时的侧栏状态（projectId / activeSessionId 变化，含首次挂载）。
  // 用渲染期 state 调整替代 effect 内 setState，避开 react-hooks/set-state-in-effect。
  const [prevRestoreKey, setPrevRestoreKey] = useState<string | null>(null);
  const restoreKey = `${projectId}:${activeSessionId ?? ""}`;
  if (restoreKey !== prevRestoreKey) {
    setPrevRestoreKey(restoreKey);
    const cachedReturnState = getSessionReturnState(projectId);
    if (cachedReturnState) {
      if (activeSessionId == null) {
        setSelectedSessionId(cachedReturnState.selectedSessionId);
      }
      setIsSessionSidePanelOpen(cachedReturnState.isSidePanelOpen);
      setSidePanelTabForSession(
        cachedReturnState.selectedSessionId,
        cachedReturnState.sidePanelTab,
      );
    }
  }
  // 判断某个 session 是否处于 open（运行中）状态：实例池据此跳过淘汰，
  // 避免 running session 的 handle 被 drop 导致 agent 进程被 kill
  //（典型场景：claude code 单轮进程被 shutdown 后报「客户端主动关闭」）。
  const isOpenSession = useCallback(
    (sessionId: number) =>
      visibleSessions.find((session) => session.sessionId === sessionId)
        ?.status === "running",
    [visibleSessions],
  );
  // 实例池：与 AgentsSessionPane 共用同一份 cachedSessionIds。在此调用以拿到
  // 缓存列表，为每个 cached session 构造 workspace 渲染数据（tab 状态 + tool
  // tabs），供 AgentsSessionPane 池化渲染。
  const { cachedSessionIds, remove: removeCachedSession } = useSessionPaneCache(
    {
      currentSessionId: cacheableSessionId,
      maxCached: MAX_CACHED_SESSION_VIEWS,
      isOpenSession,
    },
  );

  // 当缓存的某个 sessionId 已不在可见 session 列表中（被删除或不再可见）时，
  // 从实例池移除，避免渲染指向已失效数据的实例、避免泄漏已关闭 session 的
  // terminal / 消息流常驻实例。
  useEffect(() => {
    const visibleSessionIds = new Set(
      visibleSessions.map((session) => session.sessionId),
    );
    for (const cachedSessionId of cachedSessionIds) {
      if (!visibleSessionIds.has(cachedSessionId)) {
        removeCachedSession(cachedSessionId);
      }
    }
  }, [cachedSessionIds, visibleSessions, removeCachedSession]);
  // 为实例池中每个 cached session 构造 workspace 渲染数据：tab 选中态（来自
  // workspaceCache 的 per-session 快照）+ terminal/browser tool tabs（来自
  // terminalPanelStateBySessionId / browserTabsBySessionId）。
  //
  // 关键：tool tabs 的 content（SessionTerminalTab / SessionBrowserTab）在此处创建
  // 为 React 元素。配合 AgentsSessionPane 中按 sessionId 池化的 SessionWorkspacePane
  //（常驻挂载 + hidden 切换），切 session 时这些元素不会卸载，terminal 的 xterm
  // 实例与 browser iframe 因此得以保留——这是终端内容刷新 / 丢失问题的根因修复
  //（见 agent-development-rules.md L153/L225「不得卸载结构化消息流」）。
  const sessionWorkspaces = useMemo<SessionWorkspaceEntry[]>(() => {
    return cachedSessionIds.flatMap((sessionId) => {
      const session = visibleSessions.find(
        (item) => item.sessionId === sessionId,
      );
      // 列表里找不到时（刷新间隙），跳过；AgentsSessionPane 的清理 effect 会
      // 把该 sessionId 从缓存移除。
      if (!session) {
        return [];
      }
      const tabState = workspaceCache.getWorkspaceTabState(sessionId);
      const terminals =
        terminalPanelStateBySessionId[sessionId]?.terminals ?? [];
      const browserTabs = browserTabsBySessionId[sessionId] ?? [];
      const toolTabs: SessionWorkspaceToolTab[] = [
        ...terminals.map((terminal) => ({
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
        ...browserTabs.map((tab, index) => ({
          id: `browser:${tab.id}` as const,
          kind: "browser" as const,
          label:
            index === 0
              ? messages.agentsFeature.browserTool
              : messages.agentsFeature.browserToolWithIndex(index + 1),
          content: <SessionBrowserTab />,
        })),
      ];
      return [
        {
          sessionId,
          agentType: session.agentType,
          sessionStatus: session.status,
          issueStatus: session.issueStatus ?? null,
          isTurnRunning:
            session.status === "running" && session.isTurnRunning === true,
          displayMode: session.displayMode,
          activeWorkspaceTab: tabState.activeWorkspaceTab,
          changeTab: tabState.changeTab,
          fileTab: tabState.fileTab,
          toolTabs,
        },
      ];
    });
  }, [
    browserTabsBySessionId,
    cachedSessionIds,
    messages.agentsFeature,
    projectId,
    terminalPanelStateBySessionId,
    visibleSessions,
    workspaceCache,
  ]);
  const { refreshSessions, createSession, handleRenameSessionTitle } =
    useAgentSessionList({
      projectId,
      applySessionListOverlays,
      selectedSession,
      isCreatingSession,
      setAllSessions,
      setIsLoading,
      setErrorMessage,
      setShouldLoadDeferredContent,
      setAvailableAgentProfiles,
      setIsLoadingAgentProfiles,
      setHasAgentProfilesLoadError,
      setIsCreatingSession,
      setIsRenamingSessionTitle,
      setIsSessionSidePanelOpen,
      setSelectedSessionId,
      onSelectSession,
      showCommandErrorAlert,
      t,
      messages,
    });
  const {
    setIsCompletionLoadingDialogDismissed,
    agentCommitPreview,
    mergePromptSessionId,
    isSubmittingMergePrompt,
    isAgentCommitPreviewPending,
    isCompletionLoadingDialogOpen,
    canRenderTransitionButton,
    canRenderTransitionMenu,
    isTransitionPending,
    transitionButtonLabel,
    transitionMenuOptions,
    sessionTransitionPhase,
    acknowledgeSessionAttention,
    handleTransitionAction,
    handleTransitionMainAction,
    handleCloseAgentCommitPreview,
    handleCompleteAgentCommitPreviewManually,
    handleConfirmAgentCommit,
    handleConfirmMergePrompt,
    handleCloseMergePrompt,
  } = useAgentSessionCompletionFlow({
    projectId,
    locale,
    messages,
    t,
    allSessions,
    setAllSessions,
    refreshSessions,
    selectedSession,
    linkedIssue,
    confirm,
    showAlert,
    showCommandErrorAlert,
    setIsTransitionMenuOpen,
    isDeletingSession,
    reviewedIssueIdsRef,
    completedIssueIdsRef,
    closedSessionIdsRef,
  });

  function handleSelectSession(sessionId: number) {
    setIsTransitionMenuOpen(false);
    if (isSessionSidePanelOpen) {
      const nextSession =
        visibleSessions.find((session) => session.sessionId === sessionId) ??
        null;
      setSidePanelTabForSession(
        sessionId,
        nextSession?.issueId != null && nextSession.issueTitle
          ? "issue"
          : "changes",
      );
    }
    // 立即更新 selectedSessionId，确保 UI 立即响应
    setSelectedSessionId(sessionId);
    onSelectSession?.(sessionId);
    // 异步处理 attention 确认，不阻塞 UI
    void acknowledgeSessionAttention(sessionId);
  }

  function handleToggleSessionSidePanel() {
    if (!isSessionSidePanelOpen) {
      setSidePanelTab(linkedIssue ? "issue" : "changes");
    }

    setIsSessionSidePanelOpen(
      (currentIsSessionSidePanelOpen) => !currentIsSessionSidePanelOpen,
    );
  }

  async function handleDeleteSession() {
    if (!selectedSession || selectedSession.issueId !== null) {
      return;
    }

    const confirmed = await confirm({
      message: messages.agentsFeature.confirmDeleteSession,
      confirmVariant: "destructive",
    });
    if (!confirmed) {
      return;
    }

    const deletedSessionId = selectedSession.sessionId;
    setIsTransitionMenuOpen(false);
    setIsDeletingSession(true);

    try {
      await deleteAgentSession({ projectId, sessionId: deletedSessionId });
      // 清除该 session 的输入草稿缓存：agent_sessions.id 无 AUTOINCREMENT 会复用，
      // 不清则旧草稿串入复用该 id 的新 session（ADR 0006）。
      clearComposerDraft(deletedSessionId);
      clearToolTabsForSession(deletedSessionId);
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
        availableAgentProfiles={availableAgentProfiles}
        errorMessage={errorMessage}
        hasAgentProfilesLoadError={hasAgentProfilesLoadError}
        isLoading={isLoading}
        isCreatingSession={isCreatingSession}
        isLoadingAgentProfiles={isLoadingAgentProfiles}
        onCreateSession={(profile) => {
          void createSession(profile);
        }}
        onOpenProjectAgentSettings={onOpenProjectAgentSettings}
        onSelectSession={handleSelectSession}
        selectedSessionId={selectedSession?.sessionId ?? null}
        sessions={visibleSessions}
        title={messages.app.sessions}
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
        onMouseDown={handleSidebarSplitterMouseDown}
        onKeyDown={handleSidebarSplitterKeyDown}
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
          isDeletingSession={isDeletingSession}
          isRenamingSessionTitle={isRenamingSessionTitle}
          isSidePanelOpen={isSessionSidePanelOpen}
          linkedIssue={linkedIssue}
          cachedSessionIds={cachedSessionIds}
          onAcknowledgeSessionAttention={(sessionId) => {
            void acknowledgeSessionAttention(sessionId);
          }}
          onCloseWorkspaceTab={handleCloseWorkspaceTab}
          onCreateBrowserTab={handleCreateBrowserTabForSession}
          onCreateTerminalTab={handleOpenTerminalPanelForSession}
          onDeleteSession={() => {
            void handleDeleteSession();
          }}
          onRenameSessionTitle={handleRenameSessionTitle}
          onSelectWorkspaceTab={workspaceCache.selectWorkspaceTabForSession}
          onToggleSidePanel={handleToggleSessionSidePanel}
          onToggleTransitionMenu={() =>
            setIsTransitionMenuOpen(
              (currentIsTransitionMenuOpen) => !currentIsTransitionMenuOpen,
            )
          }
          onTransitionAction={(action) => {
            void handleTransitionAction(action);
          }}
          onTransitionMainAction={(action) => {
            void handleTransitionMainAction(action);
          }}
          projectId={projectId}
          selectedSession={selectedSession}
          sessionWorkspaces={sessionWorkspaces}
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
              onKeyDown={handleSidePanelSplitterKeyDown}
            />
            <SessionSidePanel
              activeTab={sidePanelTab}
              changes={workspaceCache.changes}
              changesErrorMessage={workspaceCache.changesErrorMessage}
              commitHistory={workspaceCache.commitHistory}
              isCommitFromWorktree={workspaceCache.isCommitFromWorktree}
              baseBranch={workspaceCache.baseBranch}
              commitHistoryErrorMessage={
                workspaceCache.commitHistoryErrorMessage
              }
              fileTree={workspaceCache.fileTree}
              fileTreeErrorMessage={workspaceCache.fileTreeErrorMessage}
              isCommitHistoryLoading={workspaceCache.isCommitHistoryLoading}
              isChangesLoading={workspaceCache.isChangesLoading}
              isFileTreeLoading={workspaceCache.isFileTreeLoading}
              linkedIssue={linkedIssue}
              session={selectedSession}
              onActiveTabChange={workspaceCache.setSidePanelTab}
              onOpenChangedFile={workspaceCache.openChange}
              onOpenCommittedChangedFile={workspaceCache.openCommittedChange}
              onOpenIssue={(issueId) => {
                if (selectedSession) {
                  setSessionReturnState(projectId, {
                    selectedSessionId: selectedSession.sessionId,
                    isSidePanelOpen: isSessionSidePanelOpen,
                    sidePanelTab,
                  });
                }
                onOpenIssue?.({
                  issueId,
                  source: "session",
                  sessionId: selectedSession?.sessionId,
                  restoreSidePanel: isSessionSidePanelOpen,
                  sidePanelTab,
                });
              }}
              // 必须传稳定引用：内联包装会在 agent 流式重渲染时换掉
              // FileTreePanel 的行渲染器 identity，导致点击明显迟钝。
              onOpenFile={workspaceCache.openFile}
              onToggleCommittedChangesExpanded={
                workspaceCache.toggleCommittedChangesExpanded
              }
              onToggleUncommittedChangesExpanded={
                workspaceCache.toggleUncommittedChangesExpanded
              }
              isCommittedChangesExpanded={
                workspaceCache.committedChangesExpanded
              }
              isUncommittedChangesExpanded={
                workspaceCache.uncommittedChangesExpanded
              }
              projectId={projectId}
              workspacePath={selectedSession.workspacePath}
            />
          </>
        ) : null}
      </section>

      {agentCommitPreview ? (
        <AgentCompletionPreviewDialog
          preview={agentCommitPreview}
          isPending={isAgentCommitPreviewPending}
          onClose={handleCloseAgentCommitPreview}
          onConfirm={handleConfirmAgentCommit}
          onCompleteManually={handleCompleteAgentCommitPreviewManually}
          messages={messages}
        />
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
      <AgentMergePromptDialog
        open={mergePromptSessionId !== null}
        isSubmitting={isSubmittingMergePrompt}
        onClose={handleCloseMergePrompt}
        onConfirm={handleConfirmMergePrompt}
        messages={messages}
      />
      {alertDialog}
      {confirmationDialog}
    </main>
  );
}
