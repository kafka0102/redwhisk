import { GitBranch, LoaderCircle } from "lucide-react";
import { memo, useMemo } from "react";

import type { AgentSessionListItem } from "./agent-session-commands";
import { AgentsNewSessionButton } from "./agents-new-session-button";
import { formatAgentTypeLabel, getAgentLogoSrc } from "./agent-visuals";
import {
  formatSessionStatusLabel,
  formatSessionTitle,
} from "./agent-session-formatters";
import { useI18n } from "../../shared/i18n/i18n";
import type { AgentProfileRecord } from "../settings/settings-commands";

interface AgentsSessionListProps {
  availableAgentProfiles: AgentProfileRecord[];
  errorMessage: string | null;
  hasAgentProfilesLoadError: boolean;
  isLoading: boolean;
  isCreatingSession: boolean;
  isLoadingAgentProfiles: boolean;
  onCreateSession: (profile: AgentProfileRecord) => Promise<void> | void;
  onOpenProjectAgentSettings?: () => void;
  onSelectSession: (sessionId: number) => void;
  selectedSessionId: number | null;
  sessions: AgentSessionListItem[];
  title: string;
}

export function AgentsSessionList({
  availableAgentProfiles,
  errorMessage,
  hasAgentProfilesLoadError,
  isLoading,
  isCreatingSession,
  isLoadingAgentProfiles,
  onCreateSession,
  onOpenProjectAgentSettings,
  onSelectSession,
  selectedSessionId,
  sessions,
  title,
}: AgentsSessionListProps) {
  const { messages } = useI18n();

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
          <AgentsNewSessionButton
            availableAgentProfiles={availableAgentProfiles}
            hasAgentProfilesLoadError={hasAgentProfilesLoadError}
            isCreatingSession={isCreatingSession}
            isLoadingAgentProfiles={isLoadingAgentProfiles}
            onCreateSession={onCreateSession}
            onOpenProjectAgentSettings={onOpenProjectAgentSettings}
          />
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

interface SessionRowProps {
  session: AgentSessionListItem;
  messages: ReturnType<typeof useI18n>["messages"];
  onSelect: (sessionId: number) => void;
  selectedSessionId: number | null;
}

const SessionRow = memo(function SessionRow({
  session,
  messages,
  onSelect,
  selectedSessionId,
}: SessionRowProps) {
  const outputLine = formatSessionOutputLine(session.latestOutput);
  const statusTone = getSessionStatusTone(session);
  const statusLabel = formatSessionStatusLabel(messages, session);
  const agentLabel = formatAgentTypeLabel(session.agentType);
  const branchName = resolveSessionBranchName(session);

  return (
    <div role="listitem">
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
            {formatSessionRowTitle(session)}
          </span>
        </span>
        <span className="agents-session-row__output">
          <span
            aria-label={messages.agentsFeature.sessionStatus(statusLabel)}
            className={buildSessionStatusDotClassName(statusTone)}
          />
          <span className="agents-session-row__latest-output">
            {outputLine}
          </span>
        </span>
        <span className="agents-session-row__agent">
          <img
            alt={messages.agentsFeature.sessionAgentType(agentLabel)}
            className="agents-session-row__agent-logo"
            src={getAgentLogoSrc(session.agentType)}
          />
          {session.issueNumber != null ? (
            <span className="agents-session-row__meta-issue">
              {`#${session.issueNumber}`}
            </span>
          ) : null}
          {branchName ? (
            <span className="agents-session-row__meta-branch">
              <GitBranch
                aria-hidden="true"
                className="agents-session-row__meta-branch-icon"
                size={11}
                strokeWidth={1.8}
              />
              <span className="agents-session-row__meta-branch-name">
                {branchName}
              </span>
            </span>
          ) : null}
          <span className="sr-only">{`，${statusLabel}`}</span>
        </span>
      </button>
    </div>
  );
});

function SessionRows({
  messages,
  onSelect,
  selectedSessionId,
  sessions,
}: SessionRowsProps) {
  // 限制同时渲染的session数量，优化性能
  const displaySessions = useMemo(() => {
    if (sessions.length <= 20) {
      return sessions;
    }
    // 优先显示运行中的session和有attention请求的session
    const prioritySessions = sessions.filter(
      (s) => s.status === "running" || s.attention === "requested",
    );
    const otherSessions = sessions.filter(
      (s) => s.status !== "running" && s.attention !== "requested",
    );
    return [...prioritySessions, ...otherSessions].slice(0, 20);
  }, [sessions]);

  return (
    <div
      aria-label={messages.agentsFeature.agentSessions}
      className="agents-session-list"
      role="list"
    >
      {displaySessions.length === 0 ? (
        <p className="agents-session-list__empty">
          {messages.agentsFeature.noSessions}
        </p>
      ) : (
        displaySessions.map((session) => (
          <SessionRow
            key={session.sessionId}
            session={session}
            messages={messages}
            onSelect={onSelect}
            selectedSessionId={selectedSessionId}
          />
        ))
      )}
      {sessions.length > 20 && (
        <p className="agents-session-list__more">
          {messages.agentsFeature.moreSessions(sessions.length - 20)}
        </p>
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

function formatSessionRowTitle(session: AgentSessionListItem): string {
  if (session.issueId != null && session.issueTitle) {
    return session.issueTitle;
  }

  return formatSessionTitle(session);
}

function resolveSessionBranchName(
  session: AgentSessionListItem,
): string | null {
  if (session.workspaceMode === "worktree") {
    return session.workspaceBranch ?? session.originBranch ?? null;
  }

  return session.originBranch ?? session.workspaceBranch ?? null;
}
