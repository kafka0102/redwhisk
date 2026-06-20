import { ChevronDown } from "lucide-react";

import type { AgentSessionListItem } from "./agent-session-commands";
import { AgentSessionView } from "./agent-session-view";
import {
  formatSessionStatusLabel,
  formatSessionTitle,
  shouldShowExplicitSessionStatus,
} from "./agent-session-formatters";

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
  onAcknowledgeSessionAttention: (sessionId: number) => void;
  onOpenIssue: () => void;
  onOpenSummary: () => void;
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
  onAcknowledgeSessionAttention,
  onOpenIssue,
  onOpenSummary,
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
                className="agents-session-toolbar__action"
                type="button"
                onClick={onOpenIssue}
              >
                Open Issue
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
          />
        ) : (
          <p className="empty-state">
            Agent sessions will appear here after a session has been started for
            this project.
          </p>
        )}
      </div>
    </div>
  );
}
