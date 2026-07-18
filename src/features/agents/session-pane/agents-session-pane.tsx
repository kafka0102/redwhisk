import { memo, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Ellipsis, PanelRightOpen, X } from "lucide-react";

import type { AgentSessionListItem } from "../agent-session-commands";
import { AgentSessionView } from "./agent-session-view";
import { formatSessionTitle } from "../agent-session-formatters";
import { Input } from "../../../components/ui/input";
import {
  SessionWorkspaceTabs,
  type SessionWorkspaceToolTab,
} from "../session-workspace/session-workspace-tabs";
import { useI18n } from "../../../shared/i18n/i18n";
import type {
  SessionWorkspaceChangeTab,
  SessionWorkspaceFileTab,
  SessionWorkspaceTabKind,
} from "../session-workspace/session-workspace-types";

export interface LinkedSessionIssue {
  issueId: number;
  /** 关联 Issue 的项目内编号（展示用）。 */
  issueNumber: number;
  issueStatus: string | null;
  issueTitle: string;
}

export type SessionIssueTransition = "review" | "done";

interface TransitionMenuOption {
  action: SessionIssueTransition;
  label: string;
}

/**
 * 单个已缓存 session 的 workspace 渲染数据。
 *
 * 由 `AgentsActivity` 为实例池中每个 cached sessionId 构造：包含该 session 的
 * tab 选中态、file/change tab 内容、terminal/browser tool tabs，以及操作该
 * session tab 所需的回调。`SessionWorkspacePane` 用 memo 消费此结构——只要
 * sessionId 相同且各字段引用稳定，切 session 时不会重渲染、不重挂载。
 */
export interface SessionWorkspaceEntry {
  sessionId: number;
  agentType: AgentSessionListItem["agentType"];
  sessionStatus: AgentSessionListItem["status"];
  issueStatus: NonNullable<AgentSessionListItem["issueStatus"]> | null;
  isTurnRunning: boolean;
  activeWorkspaceTab: SessionWorkspaceTabKind;
  changeTab: SessionWorkspaceChangeTab | null;
  fileTab: SessionWorkspaceFileTab | null;
  toolTabs: SessionWorkspaceToolTab[];
}

interface AgentsSessionPaneProps {
  canRenderTransitionButton: boolean;
  canRenderTransitionMenu: boolean;
  isTransitionMenuOpen: boolean;
  isTransitionPending: boolean;
  linkedIssue: LinkedSessionIssue | null;
  isDeletingSession: boolean;
  isRenamingSessionTitle: boolean;
  isSidePanelOpen: boolean;
  onAcknowledgeSessionAttention: (sessionId: number) => void;
  onCloseWorkspaceTab: (
    sessionId: number,
    tab: Exclude<SessionWorkspaceTabKind, "session">,
  ) => void;
  onCreateBrowserTab: (sessionId: number) => void;
  onCreateTerminalTab: (sessionId: number) => void;
  onDeleteSession: () => void;
  onRenameSessionTitle: (sessionId: number, title: string) => Promise<void>;
  onSelectWorkspaceTab: (
    sessionId: number,
    tab: SessionWorkspaceTabKind,
  ) => void;
  onToggleSidePanel: () => void;
  onToggleTransitionMenu: () => void;
  onTransitionAction: (action: SessionIssueTransition) => void;
  onTransitionMainAction: (action: SessionIssueTransition) => void;
  projectId: number;
  selectedSession: AgentSessionListItem | null;
  // 实例池中所有已缓存 session 的 id 列表（LRU 顺序，末尾为最近访问）。
  // 由 AgentsActivity 的 useSessionPaneCache 产出并下发，保证两者共用同一份缓存
  // 状态（避免在 AgentsActivity 构造 workspace 数据与 AgentsSessionPane 渲染实例
  // 之间出现缓存不一致）。
  cachedSessionIds: number[];
  // 实例池中所有已缓存 session 的 workspace 渲染数据（含当前 session）。
  // 顺序与 cachedSessionIds 对齐；非当前 session 用 hidden 切换显隐。
  sessionWorkspaces: SessionWorkspaceEntry[];
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
  isDeletingSession,
  isRenamingSessionTitle,
  isSidePanelOpen,
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
  onTransitionMainAction,
  projectId,
  selectedSession,
  cachedSessionIds,
  sessionWorkspaces,
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

  // 当前选中 session 的 id。实例池（cachedSessionIds / sessionWorkspaces）由
  // AgentsActivity 的 useSessionPaneCache 产出并下发，此处仅用于判断哪个 cached
  // session 是当前可见的（hidden 切换）。
  const currentSessionId = selectedSession?.sessionId ?? null;

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
              <h3 className="agents-session-toolbar__issue-heading">{`#${linkedIssue.issueNumber} ${linkedIssue.issueTitle}`}</h3>
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
                    onTransitionMainAction(
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
          {/*
           * 实例池：常驻渲染所有已缓存 session 的整个 workspace（含
           * `SessionWorkspaceTabs` 的 tab 栏 + AgentSessionView + terminal/browser
           * tool tabs），非当前选中的用 hidden 切换。切 session 时复用已挂载实例，
           * 不重挂载、不重建消息流 DOM、不重建 terminal xterm，避免：
           * 1) 消息流刷新回到顶部（重挂载导致 useAgentMessageStream RESET + 重新
           *    readAgentTimeline）；
           * 2) terminal 内容刷新 / 部分丢失（重挂载导致 xterm 重建 + restoreTerminal
           *    重新拉 snapshot）。
           * 见 agent-development-rules.md L153/L225「不得卸载结构化消息流」。
           */}
          {cachedSessionIds.map((cachedSessionId) => {
            const workspace = sessionWorkspaces.find(
              (item) => item.sessionId === cachedSessionId,
            );
            // 列表里找不到时（刷新间隙），跳过该实例的渲染；useEffect 会清理。
            if (!workspace) {
              return null;
            }
            const isCurrent = workspace.sessionId === currentSessionId;
            return (
              <SessionWorkspacePane
                key={workspace.sessionId}
                isCurrent={isCurrent}
                onCloseWorkspaceTab={onCloseWorkspaceTab}
                onCreateBrowserTab={onCreateBrowserTab}
                onCreateTerminalTab={onCreateTerminalTab}
                onSelectWorkspaceTab={onSelectWorkspaceTab}
                onAcknowledgeSessionAttention={onAcknowledgeSessionAttention}
                projectId={projectId}
                workspace={workspace}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

interface SessionWorkspacePaneProps {
  isCurrent: boolean;
  onCloseWorkspaceTab: (
    sessionId: number,
    tab: Exclude<SessionWorkspaceTabKind, "session">,
  ) => void;
  onCreateBrowserTab: (sessionId: number) => void;
  onCreateTerminalTab: (sessionId: number) => void;
  onSelectWorkspaceTab: (
    sessionId: number,
    tab: SessionWorkspaceTabKind,
  ) => void;
  onAcknowledgeSessionAttention: (sessionId: number) => void;
  projectId: number;
  workspace: SessionWorkspaceEntry;
}

/**
 * 单个 session 的 workspace 面板：渲染 `SessionWorkspaceTabs`（tab 栏 +
 * AgentSessionView + terminal/browser tool tabs）。
 *
 * 用 `memo` 包裹，props 引用稳定时切 session 不重渲染——配合 `agents-session-main-stack`
 * 中的 `hidden` 切换，实现整个 workspace（含消息流 + 终端）的实例池化，避免切
 * session 时重挂载。
 *
 * 注意：tab 栏虽在 hidden 时不可交互，但仍保留 DOM。`onSelectWorkspaceTab` 等
 * 回调接收 `sessionId` 参数，确保即便用户通过键盘等途径触发也作用于本 session，
 * 而非当前选中 session。
 */
const SessionWorkspacePane = memo(function SessionWorkspacePane({
  isCurrent,
  onCloseWorkspaceTab,
  onCreateBrowserTab,
  onCreateTerminalTab,
  onSelectWorkspaceTab,
  onAcknowledgeSessionAttention,
  projectId,
  workspace,
}: SessionWorkspacePaneProps) {
  return (
    <div
      className="agents-terminal-host session-workspace-host"
      hidden={!isCurrent}
      onMouseDown={() => onAcknowledgeSessionAttention(workspace.sessionId)}
    >
      <SessionWorkspaceTabs
        activeTab={workspace.activeWorkspaceTab}
        changeTab={workspace.changeTab}
        fileTab={workspace.fileTab}
        sessionAgentType={workspace.agentType}
        sessionContent={
          <AgentSessionView
            projectId={projectId}
            sessionId={workspace.sessionId}
            agentType={workspace.agentType}
            sessionStatus={workspace.sessionStatus}
            issueStatus={workspace.issueStatus}
            isTurnRunning={workspace.isTurnRunning}
            isActive={isCurrent}
          />
        }
        onCloseTab={(tab) => onCloseWorkspaceTab(workspace.sessionId, tab)}
        onCreateBrowserTab={() => onCreateBrowserTab(workspace.sessionId)}
        onCreateTerminalTab={() => onCreateTerminalTab(workspace.sessionId)}
        onSelectTab={(tab) => onSelectWorkspaceTab(workspace.sessionId, tab)}
        toolTabs={workspace.toolTabs}
      />
    </div>
  );
});
