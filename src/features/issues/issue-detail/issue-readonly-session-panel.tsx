import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  listAgentSessions,
  type AgentSessionListItem,
} from "../../agents/agent-session-commands";
import { formatProcessingDuration } from "../../agents/agent-session-formatters";
import { getCommandErrorMessage } from "../../../shared/commands/command-error";
import { useI18n } from "../../../shared/i18n/i18n";

interface IssueReadonlySessionPanelProps {
  linkedSessionId: number | null;
  projectId: number;
  canOpenSession: boolean;
  onOpenSession: () => void;
}

export function IssueReadonlySessionPanel({
  linkedSessionId,
  projectId,
  canOpenSession,
  onOpenSession,
}: IssueReadonlySessionPanelProps) {
  const { locale, messages, t } = useI18n();
  const [session, setSession] = useState<AgentSessionListItem | null>(null);
  const [isLoading, setIsLoading] = useState(linkedSessionId != null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSession() {
      if (linkedSessionId == null) {
        setSession(null);
        setErrorMessage(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await listAgentSessions(projectId);
        if (!isMounted) {
          return;
        }

        const nextSession =
          response.sessions.find(
            (candidate) => candidate.sessionId === linkedSessionId,
          ) ?? null;
        setSession(nextSession);
        if (!nextSession) {
          setErrorMessage(messages.agentsFeature.issueNotFound);
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setSession(null);
        setErrorMessage(getCommandErrorMessage(error, t));
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadSession();

    return () => {
      isMounted = false;
    };
  }, [linkedSessionId, messages.agentsFeature.issueNotFound, projectId, t]);

  const runtimeParameters = useMemo(() => {
    const workflowSkillName =
      session?.workflowSkillName?.trim() || messages.agentsFeature.none;
    return [
      {
        label: messages.agentsFeature.agent,
        value: session?.agentProfileName?.trim() || messages.agentsFeature.none,
      },
      {
        label: messages.agentsFeature.workflowSkill,
        value: workflowSkillName,
      },
      {
        label: messages.agentsFeature.developmentMode,
        value: formatDevelopmentMode(session, messages),
      },
    ];
  }, [messages, session]);

  const sessionInfo = useMemo(
    () => [
      {
        label: messages.issueSummary.startedAt,
        value: formatTimestamp(session?.startedAt ?? null, locale),
      },
      {
        label: messages.agentsFeature.endedAt,
        value: formatTimestamp(session?.lastOutputAt ?? null, locale),
      },
      {
        label: messages.agentsFeature.totalDuration,
        value: formatProcessingDuration(session, locale),
      },
      {
        label: messages.issueSummary.sessionStatus,
        value: formatSessionStatus(session?.status, messages),
      },
    ],
    [locale, messages, session],
  );

  const logPathLabel =
    session?.status === "running"
      ? messages.agentsFeature.runtimeLogPath
      : messages.agentsFeature.archivedLogPath;
  const logPathValue = session?.logPath?.trim() || messages.agentsFeature.none;

  if (linkedSessionId == null) {
    return (
      <div className="session-issue-panel issue-readonly-session-panel">
        <p className="session-side-panel__empty" role="status">
          {messages.agentsFeature.none}
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="session-issue-panel issue-readonly-session-panel">
        <p className="session-side-panel__empty" role="status">
          {messages.agentsFeature.loadingSessions}
        </p>
      </div>
    );
  }

  if (errorMessage || !session) {
    return (
      <div className="session-issue-panel issue-readonly-session-panel">
        <p className="session-side-panel__empty" role="status">
          {errorMessage ?? messages.agentsFeature.issueNotFound}
        </p>
      </div>
    );
  }

  return (
    <div className="session-issue-panel issue-readonly-session-panel">
      <section className="session-issue-panel__card">
        <div className="session-issue-panel__header">
          <h3 className="issue-detail__title">
            {messages.agentsFeature.sessionInfo}
          </h3>
          <Button
            className="session-issue-panel__action"
            disabled={!canOpenSession}
            size="sm"
            type="button"
            variant="secondary"
            onClick={onOpenSession}
          >
            {messages.issues.viewSession}
          </Button>
        </div>
        <div className="issue-detail__divider" aria-hidden="true" />
        <dl className="session-issue-panel__meta-list">
          {sessionInfo.map((item) => (
            <div className="session-issue-panel__meta-row" key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
        <div className="session-issue-panel__meta-row">
          <span>{logPathLabel}</span>
          <code className="session-issue-panel__log-path">{logPathValue}</code>
        </div>
      </section>

      <section className="session-issue-panel__card">
        <h3 className="issue-detail__title">
          {messages.agentsFeature.runParameters}
        </h3>
        <div className="issue-detail__divider" aria-hidden="true" />
        <dl className="session-issue-panel__meta-list">
          {runtimeParameters.map((item) => (
            <div className="session-issue-panel__meta-row" key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function formatTimestamp(value: number | null, locale: string): string {
  if (value == null) {
    return "-";
  }

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

function formatDevelopmentMode(
  session: AgentSessionListItem | null,
  messages: ReturnType<typeof useI18n>["messages"],
): string {
  if (!session?.workspaceMode) {
    return messages.agentsFeature.none;
  }

  const branchName = session.workspaceBranch || session.originBranch || "-";
  if (session.workspaceMode === "current_branch") {
    return `${messages.issues.currentBranch} (${branchName})`;
  }

  const worktreeName = getWorktreeName(
    session.workspacePath ?? session.workingDir,
  );
  return `${messages.issues.worktree} (${branchName}) ${worktreeName}`.trim();
}

function formatSessionStatus(
  status: AgentSessionListItem["status"] | undefined,
  messages: ReturnType<typeof useI18n>["messages"],
): string {
  switch (status) {
    case "running":
      return messages.agentsFeature.sessionRunning;
    case "closed":
      return messages.agentsFeature.sessionClosed;
    case "crashed":
      return messages.agentsFeature.sessionCrashed;
    case "stopped":
      return messages.agentsFeature.sessionStopped;
    default:
      return messages.agentsFeature.none;
  }
}

function getWorktreeName(path: string | null | undefined): string {
  if (!path) {
    return "";
  }

  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? "";
}
