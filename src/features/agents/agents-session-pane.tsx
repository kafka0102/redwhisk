import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Ellipsis, PanelRightOpen, X } from "lucide-react";

import type { AgentSessionListItem } from "./agent-session-commands";
import { AgentSessionView } from "./agent-session-view";
import { formatSessionTitle } from "./agent-session-formatters";
import { Input } from "../../components/ui/input";
import {
  SessionWorkspaceTabs,
  type SessionWorkspaceToolTab,
} from "./session-workspace-tabs";
import { useSessionPaneCache } from "./use-session-pane-cache";
import { useI18n } from "../../shared/i18n/i18n";
import type {
  SessionWorkspaceChangeTab,
  SessionWorkspaceFileTab,
  SessionWorkspaceTabKind,
} from "./session-workspace-types";

// 实例池上限：与 use-agent-message-stream.ts 的 MAX_CACHED_SESSIONS 对齐，
// 保证常驻 AgentSessionView 实例数量与消息流 state 缓存淘汰粒度一致。
const MAX_CACHED_SESSION_VIEWS = 5;

export interface LinkedSessionIssue {
  issueId: number;
  issueStatus: string | null;
  issueTitle: string;
}

export type SessionIssueTransition = "review" | "done";

interface TransitionMenuOption {
  action: SessionIssueTransition;
  label: string;
}

interface AgentsSessionPaneProps {
  canRenderTransitionButton: boolean;
  canRenderTransitionMenu: boolean;
  isTransitionMenuOpen: boolean;
  isTransitionPending: boolean;
  linkedIssue: LinkedSessionIssue | null;
  activeWorkspaceTab: SessionWorkspaceTabKind;
  changeTab: SessionWorkspaceChangeTab | null;
  fileTab: SessionWorkspaceFileTab | null;
  isDeletingSession: boolean;
  isRenamingSessionTitle: boolean;
  isSidePanelOpen: boolean;
  toolTabs: SessionWorkspaceToolTab[];
  onAcknowledgeSessionAttention: (sessionId: number) => void;
  onCloseWorkspaceTab: (
    tab: Exclude<SessionWorkspaceTabKind, "session">,
  ) => void;
  onCreateBrowserTab: () => void;
  onCreateTerminalTab: () => void;
  onDeleteSession: () => void;
  onRenameSessionTitle: (sessionId: number, title: string) => Promise<void>;
  onSelectWorkspaceTab: (tab: SessionWorkspaceTabKind) => void;
  onToggleSidePanel: () => void;
  onToggleTransitionMenu: () => void;
  onTransitionAction: (action: SessionIssueTransition) => void;
  projectId: number;
  selectedSession: AgentSessionListItem | null;
  // 当前可见的 session 列表，用于实例池中查找每个已缓存 sessionId 对应的最新数据
  //（agentType/status/issueStatus 等会随 session 列表刷新变化）。
  sessions: AgentSessionListItem[];
  transitionButtonLabel: string | null;
  transitionMenuOptions: TransitionMenuOption[];
  transitionPhase: "running" | "review" | "completed" | null;
}

export function AgentsSessionPane({
  canRenderTransitionButton,
  canRenderTransitionMenu,
  isTransitionMenuOpen,
  isTransitionPending,
  linkedIssue,
  activeWorkspaceTab,
  changeTab,
  fileTab,
  isDeletingSession,
  isRenamingSessionTitle,
  isSidePanelOpen,
  toolTabs,
  onAcknowledgeSessionAttention,
  onCloseWorkspaceTab,
  onCreateBrowserTab,
  onCreateTerminalTab,
  onDeleteSession,
  onRenameSessionTitle,
  onSelectWorkspaceTab,
  onToggleSidePanel,
  onToggleTransitionMenu,
  onTransitionAction,
  projectId,
  selectedSession,
  sessions,
  transitionButtonLabel,
  transitionMenuOptions,
  transitionPhase,
}: AgentsSessionPaneProps) {
  const { messages } = useI18n();
  const canRenderSessionActions = selectedSession !== null;
  const canRenderStandaloneActions =
    selectedSession !== null && selectedSession.issueId === null;
  const [sessionActionsMenuSessionId, setSessionActionsMenuSessionId] =
    useState<number | null>(null);
  const [editingTitleSessionId, setEditingTitleSessionId] = useState<
    number | null
  >(null);
  const [draftTitle, setDraftTitle] = useState("");
  const sessionActionsRef = useRef<HTMLDivElement | null>(null);
  const isSessionActionsMenuOpen =
    selectedSession !== null &&
    sessionActionsMenuSessionId === selectedSession.sessionId;
  const isEditingTitle =
    selectedSession !== null &&
    editingTitleSessionId === selectedSession.sessionId;

  // AgentSessionView 实例池：按 sessionId 缓存已挂载的消息流实例，切 session 时
  // 复用实例（不重挂载、不重建消息流 DOM），仅用 hidden 切换显隐。这是切 session
  // 主线程卡顿的根因修复——重挂载会同步重建整棵消息流 DOM（react-markdown 解析 +
  // diff 逐行 tokenize），React 无法先画 loading。
  const currentSessionId = selectedSession?.sessionId ?? null;
  const { cachedSessionIds, remove: removeCachedSession } = useSessionPaneCache(
    {
      currentSessionId,
      maxCached: MAX_CACHED_SESSION_VIEWS,
    },
  );

  // 当缓存的某个 sessionId 已不在可见 session 列表中（被删除或不再可见）时，
  // 从实例池移除，避免渲染指向已失效数据的实例。
  useEffect(() => {
    const visibleSessionIds = new Set(
      sessions.map((session) => session.sessionId),
    );
    for (const cachedSessionId of cachedSessionIds) {
      if (!visibleSessionIds.has(cachedSessionId)) {
        removeCachedSession(cachedSessionId);
      }
    }
  }, [cachedSessionIds, sessions, removeCachedSession]);

  useEffect(() => {
    if (!isSessionActionsMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (sessionActionsRef.current?.contains(target)) {
        return;
      }
      setSessionActionsMenuSessionId(null);
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isSessionActionsMenuOpen]);

  function beginTitleEdit() {
    if (!selectedSession) {
      return;
    }
    setDraftTitle(formatSessionTitle(selectedSession));
    setEditingTitleSessionId(selectedSession.sessionId);
    setSessionActionsMenuSessionId(null);
  }

  async function saveTitleEdit() {
    if (!selectedSession) {
      return;
    }

    try {
      await onRenameSessionTitle(selectedSession.sessionId, draftTitle);
      setEditingTitleSessionId(null);
    } catch {
      // The parent owns user-visible command errors.
    }
  }

  return (
    <div className="agents-terminal-pane">
      {selectedSession ? (
        <div className="agents-session-toolbar">
          <div className="agents-session-toolbar__copy">
            {isEditingTitle && selectedSession ? (
              <div className="agents-session-toolbar__title-edit">
                <Input
                  aria-label={messages.agentsFeature.sessionTitleField}
                  className="agents-session-toolbar__title-input"
                  disabled={isRenamingSessionTitle}
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveTitleEdit();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setEditingTitleSessionId(null);
                    }
                  }}
                />
                <button
                  aria-label={messages.agentsFeature.saveSessionTitle}
                  className="agents-session-toolbar__icon-action"
                  disabled={isRenamingSessionTitle}
                  type="button"
                  onClick={() => {
                    void saveTitleEdit();
                  }}
                >
                  <Check aria-hidden="true" size={15} strokeWidth={1.9} />
                </button>
                <button
                  aria-label={messages.agentsFeature.cancelSessionTitleEdit}
                  className="agents-session-toolbar__icon-action"
                  disabled={isRenamingSessionTitle}
                  type="button"
                  onClick={() => setEditingTitleSessionId(null)}
                >
                  <X aria-hidden="true" size={15} strokeWidth={1.9} />
                </button>
              </div>
            ) : linkedIssue ? (
              <h3 className="agents-session-toolbar__issue-heading">{`#${linkedIssue.issueId} ${linkedIssue.issueTitle}`}</h3>
            ) : (
              <h3>{formatSessionTitle(selectedSession)}</h3>
            )}
          </div>
          <div className="agents-session-toolbar__actions">
            {canRenderTransitionButton ? (
              <div className="agents-session-toolbar__split-action">
                <button
                  className="agents-session-toolbar__action agents-session-toolbar__action--split-main"
                  disabled={isTransitionPending}
                  type="button"
                  onClick={() =>
                    onTransitionAction(
                      transitionPhase === "running" ? "review" : "done",
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
                      aria-label={messages.agentsFeature.openStatusOptions}
                      className="agents-session-toolbar__action agents-session-toolbar__action--split-toggle"
                      disabled={isTransitionPending}
                      type="button"
                      onClick={onToggleTransitionMenu}
                    >
                      <ChevronDown
                        aria-hidden="true"
                        size={14}
                        strokeWidth={1.9}
                      />
                    </button>
                    {isTransitionMenuOpen ? (
                      <div className="agents-session-toolbar__menu" role="menu">
                        {transitionMenuOptions.map((option) => (
                          <button
                            key={option.action}
                            className="agents-session-toolbar__menu-item"
                            role="menuitem"
                            type="button"
                            onClick={() => onTransitionAction(option.action)}
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
            {canRenderStandaloneActions ? (
              <div
                ref={sessionActionsRef}
                className="agents-session-toolbar__split-menu"
              >
                <button
                  aria-expanded={isSessionActionsMenuOpen}
                  aria-haspopup="menu"
                  aria-label={messages.agentsFeature.openSessionActions}
                  className="agents-session-toolbar__icon-action"
                  disabled={isDeletingSession || isRenamingSessionTitle}
                  type="button"
                  onClick={() => {
                    setSessionActionsMenuSessionId((currentSessionId) =>
                      currentSessionId === selectedSession.sessionId
                        ? null
                        : selectedSession.sessionId,
                    );
                  }}
                >
                  <Ellipsis aria-hidden="true" size={16} strokeWidth={1.9} />
                </button>
                {isSessionActionsMenuOpen ? (
                  <div className="agents-session-toolbar__menu" role="menu">
                    <button
                      className="agents-session-toolbar__menu-item"
                      role="menuitem"
                      type="button"
                      onClick={beginTitleEdit}
                    >
                      {messages.agentsFeature.renameSessionTitle}
                    </button>
                    <button
                      className="agents-session-toolbar__menu-item agents-session-toolbar__menu-item--danger"
                      disabled={isDeletingSession}
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setSessionActionsMenuSessionId(null);
                        onDeleteSession();
                      }}
                    >
                      {messages.agentsFeature.deleteSessionAction}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {canRenderSessionActions ? (
              <button
                aria-label={messages.agentsFeature.openSessionSidePanel}
                aria-pressed={isSidePanelOpen}
                className="agents-session-toolbar__icon-action"
                type="button"
                onClick={onToggleSidePanel}
              >
                <PanelRightOpen
                  aria-hidden="true"
                  size={16}
                  strokeWidth={1.8}
                />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {selectedSession ? (
        <div className="agents-session-main-stack">
          <SessionWorkspaceTabs
            activeTab={activeWorkspaceTab}
            changeTab={changeTab}
            fileTab={fileTab}
            sessionAgentType={selectedSession.agentType}
            sessionContent={
              // 实例池：常驻渲染所有已缓存的 AgentSessionView，非当前选中的用
              // hidden 切换。切 session 时复用已挂载实例，不重挂载、不重建消息流 DOM。
              <>
                {cachedSessionIds.map((cachedSessionId) => {
                  const session = sessions.find(
                    (item) => item.sessionId === cachedSessionId,
                  );
                  // 列表里找不到时（刷新间隙），跳过该实例的渲染；useEffect 会清理。
                  if (!session) {
                    return null;
                  }
                  const isCurrent = session.sessionId === currentSessionId;
                  return (
                    <div
                      key={session.sessionId}
                      className="agents-terminal-host"
                      hidden={!isCurrent}
                      onMouseDown={() =>
                        onAcknowledgeSessionAttention(session.sessionId)
                      }
                    >
                      <AgentSessionView
                        projectId={projectId}
                        sessionId={session.sessionId}
                        agentType={session.agentType}
                        sessionStatus={session.status}
                        issueStatus={session.issueStatus ?? null}
                        isTurnRunning={
                          session.status === "running" && session.isTurnRunning
                        }
                      />
                    </div>
                  );
                })}
              </>
            }
            onCloseTab={onCloseWorkspaceTab}
            onCreateBrowserTab={onCreateBrowserTab}
            onCreateTerminalTab={onCreateTerminalTab}
            onSelectTab={onSelectWorkspaceTab}
            toolTabs={toolTabs}
          />
        </div>
      ) : null}
    </div>
  );
}
