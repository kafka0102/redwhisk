import { LayoutGrid, LoaderCircle, Plus } from "lucide-react";
import type { RefObject } from "react";

import type { AgentSessionListItem } from "./agent-session-commands";
import type { AgentType } from "../settings/settings-commands";
import { formatAgentTypeLabel, getAgentLogoSrc } from "./agent-visuals";
import {
  formatSessionStatusLabel,
  formatSessionTitle,
} from "./agent-session-formatters";
import { useI18n } from "../../shared/i18n/i18n";

interface AgentsSessionListProps {
  availableAgentTypes: AgentType[];
  errorMessage: string | null;
  isLoading: boolean;
  isNewSessionMenuOpen: boolean;
  isNewSessionDisabled: boolean;
  newSessionButtonRef: RefObject<HTMLButtonElement | null>;
  onCreateSession: (agentType: AgentType) => void;
  onNewSessionMenuOpenChange: (open: boolean) => void;
  onSelectSession: (sessionId: number) => void;
  selectedSessionId: number | null;
  sessions: AgentSessionListItem[];
  title: string;
}

export function AgentsSessionList({
  availableAgentTypes,
  errorMessage,
  isLoading,
  isNewSessionMenuOpen,
  isNewSessionDisabled,
  newSessionButtonRef,
  onCreateSession,
  onNewSessionMenuOpenChange,
  onSelectSession,
  selectedSessionId,
  sessions,
  title,
}: AgentsSessionListProps) {
  const { messages } = useI18n();
  const shouldShowAgentTypePicker = availableAgentTypes.length > 1;

  return (
    <aside
      className="agents-sidebar"
      aria-label={messages.agentsFeature.agentSessions}
    >
      <div className="agents-sidebar__header">
        <div className="agents-sidebar__header-main">
          <h2>{title}</h2>
        </div>
        <div
          className="agents-sidebar__toolbar"
          aria-label={messages.agentsFeature.sessionListControls}
        >
          <button
            aria-label={messages.agentsFeature.sessionListView}
            className="agents-toolbar-button"
            disabled
            type="button"
          >
            <LayoutGrid aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
          {shouldShowAgentTypePicker ? (
            <div className="agents-session-create-menu">
              <button
                aria-expanded={isNewSessionMenuOpen}
                aria-haspopup="menu"
                aria-label={messages.agentsFeature.newSession}
                className="agents-toolbar-button"
                disabled={isNewSessionDisabled}
                ref={newSessionButtonRef}
                type="button"
                onClick={() =>
                  onNewSessionMenuOpenChange(!isNewSessionMenuOpen)
                }
              >
                <Plus aria-hidden="true" size={16} strokeWidth={1.8} />
              </button>
              {isNewSessionMenuOpen ? (
                <div className="agents-session-toolbar__menu" role="menu">
                  {availableAgentTypes.map((agentType) => (
                    <button
                      key={agentType}
                      className="agents-session-toolbar__menu-item"
                      role="menuitem"
                      type="button"
                      onClick={() => onCreateSession(agentType)}
                    >
                      {formatAgentTypeLabel(agentType)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <button
              aria-label={messages.agentsFeature.newSession}
              className="agents-toolbar-button"
              disabled={isNewSessionDisabled}
              ref={newSessionButtonRef}
              type="button"
              onClick={() => {
                const [agentType] = availableAgentTypes;
                if (agentType) {
                  onCreateSession(agentType);
                }
              }}
            >
              <Plus aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>

      {errorMessage ? (
        <p
          className="issues-status"
          role="status"
          aria-label={messages.agentsFeature.agentsStatus}
        >
          {errorMessage}
        </p>
      ) : null}
      {isLoading ? (
        <p className="issues-loading" role="status">
          {messages.agentsFeature.loadingSessions}
        </p>
      ) : null}

      {!isLoading && !errorMessage ? (
        <SessionRows
          messages={messages}
          onSelect={onSelectSession}
          selectedSessionId={selectedSessionId}
          sessions={sessions}
        />
      ) : null}
    </aside>
  );
}

interface SessionRowsProps {
  messages: ReturnType<typeof useI18n>["messages"];
  onSelect: (sessionId: number) => void;
  selectedSessionId: number | null;
  sessions: AgentSessionListItem[];
}

function SessionRows({
  messages,
  onSelect,
  selectedSessionId,
  sessions,
}: SessionRowsProps) {
  return (
    <div
      aria-label={messages.agentsFeature.agentSessions}
      className="agents-session-list"
      role="list"
    >
      {sessions.length === 0 ? (
        <p className="agents-session-list__empty">
          {messages.agentsFeature.noSessions}
        </p>
      ) : (
        sessions.map((session) => {
          const outputLine = formatSessionOutputLine(session.latestOutput);
          const statusTone = getSessionStatusTone(session);
          const statusLabel = formatSessionStatusLabel(messages, session);
          const agentLabel = formatAgentTypeLabel(session.agentType);

          return (
            <div key={session.sessionId} role="listitem">
              <button
                aria-pressed={selectedSessionId === session.sessionId}
                className="agents-session-row"
                type="button"
                onClick={() => onSelect(session.sessionId)}
              >
                <span className="agents-session-row__header">
                  {shouldShowRunningSpinner(session) ? (
                    <LoaderCircle
                      aria-label={messages.agentsFeature.sessionRunning}
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
                    aria-label={messages.agentsFeature.sessionStatus(
                      statusLabel,
                    )}
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
            </div>
          );
        })
      )}
    </div>
  );
}

function buildSessionStatusDotClassName(tone: string): string {
  return `agents-session-row__status-dot agents-session-row__status-dot--${tone}`;
}

function getSessionStatusTone(session: AgentSessionListItem): string {
  if (session.status !== "running") {
    return "done";
  }

  if (session.attention === "requested") {
    return "attention";
  }

  if (session.issueStatus === "completed") {
    return "done";
  }

  if (session.issueStatus === "review") {
    return "review";
  }

  if (session.issueStatus === "running" && session.isTurnRunning === false) {
    return "in-progress";
  }

  return "running";
}

function shouldShowRunningSpinner(session: AgentSessionListItem): boolean {
  const isTurnRunning =
    session.status === "running" &&
    (session.isTurnRunning ?? session.status === "running");

  return (
    isTurnRunning &&
    session.attention !== "requested" &&
    session.issueStatus !== "review" &&
    session.issueStatus !== "completed"
  );
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

function shouldShowSessionRowStatus(session: AgentSessionListItem): boolean {
  return session.status === "crashed";
}
