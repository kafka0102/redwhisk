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
import { useI18n } from "../../shared/i18n/i18n";
import type {
  SessionWorkspaceChangeTab,
  SessionWorkspaceFileTab,
  SessionWorkspaceTabKind,
} from "./session-workspace-types";

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
            sessionContent={
              <div
                className="agents-terminal-host"
                onMouseDown={() =>
                  onAcknowledgeSessionAttention(selectedSession.sessionId)
                }
              >
                <AgentSessionView
                  projectId={projectId}
                  sessionId={selectedSession.sessionId}
                  agentType={selectedSession.agentType}
                  sessionStatus={selectedSession.status}
                  issueStatus={selectedSession.issueStatus ?? null}
                  isTurnRunning={
                    selectedSession.status === "running" &&
                    selectedSession.isTurnRunning
                  }
                />
              </div>
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
