import { ChevronDown, PanelRightOpen, Terminal } from "lucide-react";

import type { AgentSessionListItem } from "./agent-session-commands";
import { AgentSessionView } from "./agent-session-view";
import { formatSessionTitle } from "./agent-session-formatters";
import { SessionWorkspaceTabs } from "./session-workspace-tabs";
import type {
  SessionWorkspaceFile,
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
  agentCommitErrorMessage: string | null;
  attentionErrorMessage: string | null;
  canRenderTransitionButton: boolean;
  canRenderTransitionMenu: boolean;
  canViewSummary: boolean;
  cleanErrorMessage: string | null;
  isTransitionMenuOpen: boolean;
  isTransitionPending: boolean;
  linkedIssue: LinkedSessionIssue | null;
  manualErrorMessage: string | null;
  markReviewErrorMessage: string | null;
  activeWorkspaceTab: SessionWorkspaceTabKind;
  changeTab: SessionWorkspaceFile | null;
  fileTab: SessionWorkspaceFile | null;
  isSidePanelOpen: boolean;
  onAcknowledgeSessionAttention: (sessionId: number) => void;
  onCloseWorkspaceTab: (
    tab: Exclude<SessionWorkspaceTabKind, "session">,
  ) => void;
  onOpenSummary: () => void;
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
  agentCommitErrorMessage,
  attentionErrorMessage,
  canRenderTransitionButton,
  canRenderTransitionMenu,
  canViewSummary,
  cleanErrorMessage,
  isTransitionMenuOpen,
  isTransitionPending,
  linkedIssue,
  manualErrorMessage,
  markReviewErrorMessage,
  activeWorkspaceTab,
  changeTab,
  fileTab,
  isSidePanelOpen,
  onAcknowledgeSessionAttention,
  onCloseWorkspaceTab,
  onOpenSummary,
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
  return (
    <div className="agents-terminal-pane">
      {selectedSession ? (
        <div className="agents-session-toolbar">
          <div className="agents-session-toolbar__copy">
            {linkedIssue ? (
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
                      aria-label="Open status options"
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
            {linkedIssue ? (
              <button
                aria-label="打开终端"
                className="agents-session-toolbar__icon-action"
                type="button"
              >
                <Terminal aria-hidden="true" size={16} strokeWidth={1.8} />
              </button>
            ) : null}
            {linkedIssue ? (
              <button
                aria-label="打开 Session 侧边栏"
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
            {canViewSummary ? (
              <button
                className="agents-session-toolbar__action"
                type="button"
                onClick={onOpenSummary}
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
        {manualErrorMessage ? (
          <p className="issues-status" role="status">
            {manualErrorMessage}
          </p>
        ) : null}
        {cleanErrorMessage ? (
          <p className="issues-status" role="status">
            {cleanErrorMessage}
          </p>
        ) : null}
        {agentCommitErrorMessage ? (
          <p className="issues-status" role="status">
            {agentCommitErrorMessage}
          </p>
        ) : null}
        {attentionErrorMessage ? (
          <p className="issues-status" role="status">
            {attentionErrorMessage}
          </p>
        ) : null}
      </div>
      <SessionWorkspaceTabs
        activeTab={activeWorkspaceTab}
        changeTab={changeTab}
        fileTab={fileTab}
        sessionContent={
          <div
            className="agents-terminal-host"
            onMouseDown={() => {
              if (selectedSession) {
                onAcknowledgeSessionAttention(selectedSession.sessionId);
              }
            }}
          >
            {selectedSession ? (
              <AgentSessionView
                projectId={projectId}
                sessionId={selectedSession.sessionId}
                agentType={selectedSession.agentType}
                isTurnRunning={selectedSession.isTurnRunning}
              />
            ) : (
              <p className="empty-state">
                Agent sessions will appear here after a session has been started
                for this project.
              </p>
            )}
          </div>
        }
        onCloseTab={onCloseWorkspaceTab}
        onSelectTab={onSelectWorkspaceTab}
      />
    </div>
  );
}
