import {
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  LoaderCircle,
  Plus,
} from "lucide-react";
import { useState, type RefObject } from "react";

import type { AgentSessionListItem } from "./agent-session-commands";
import { formatAgentTypeLabel, getAgentLogoSrc } from "./agent-visuals";
import {
  formatSessionStatusLabel,
  formatSessionTitle,
  type SessionIssueGroup,
} from "./agent-session-formatters";

export interface SessionGroupViewModel {
  count: number;
  emptyCopy: string;
  key: SessionIssueGroup;
  label: string;
  sessions: AgentSessionListItem[];
}

interface AgentsSessionListProps {
  errorMessage: string | null;
  groups: SessionGroupViewModel[];
  isLoading: boolean;
  newSessionButtonRef: RefObject<HTMLButtonElement | null>;
  onNewSession: () => void;
  onSelectSession: (sessionId: number) => void;
  selectedSessionId: number | null;
  title: string;
}

export function AgentsSessionList({
  errorMessage,
  groups,
  isLoading,
  newSessionButtonRef,
  onNewSession,
  onSelectSession,
  selectedSessionId,
  title,
}: AgentsSessionListProps) {
  return (
    <aside className="agents-sidebar" aria-label="Agent sessions">
      <div className="agents-sidebar__header">
        <div className="agents-sidebar__header-main">
          <h2>{title}</h2>
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
            onClick={onNewSession}
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
          {groups.map((group) => (
            <SessionGroup
              key={group.key}
              emptyCopy={group.emptyCopy}
              count={group.count}
              label={group.label}
              groupKey={group.key}
              onSelect={onSelectSession}
              selectedSessionId={selectedSessionId}
              sessions={group.sessions}
            />
          ))}
        </div>
      ) : null}
    </aside>
  );
}

interface SessionGroupProps {
  count: number;
  emptyCopy: string;
  groupKey: SessionIssueGroup;
  label: string;
  onSelect: (sessionId: number) => void;
  selectedSessionId: number | null;
  sessions: AgentSessionListItem[];
}

function SessionGroup({
  count,
  emptyCopy,
  groupKey,
  label,
  onSelect,
  selectedSessionId,
  sessions,
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
            const statusTone = getSessionStatusTone(session);
            const statusLabel = formatSessionStatusLabel(session);
            const agentLabel = formatAgentTypeLabel(session.agentType);

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

function buildSessionStatusDotClassName(tone: string): string {
  return `agents-session-row__status-dot agents-session-row__status-dot--${tone}`;
}

function getSessionStatusTone(session: AgentSessionListItem): string {
  if (session.issueStatus === "completed") {
    return "done";
  }

  if (session.issueStatus === "review") {
    return "viewed";
  }

  if (session.status !== "running") {
    return "done";
  }

  return session.attention === "requested" ? "viewed" : "running";
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
