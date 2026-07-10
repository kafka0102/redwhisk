import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatProcessingDuration } from "./agent-session-formatters";
import type { AgentSessionListItem } from "./agent-session-commands";
import { listIssues, type IssueRecord } from "../issues/issue-commands";
import { toCommandError } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";

interface SessionIssuePanelProps {
  issueId: number;
  issueTitle: string;
  projectId: number;
  session: AgentSessionListItem | null;
  onOpenIssue: (issueId: number) => void;
}

export function SessionIssuePanel({
  issueId,
  issueTitle,
  projectId,
  session,
  onOpenIssue,
}: SessionIssuePanelProps) {
  const { locale, messages } = useI18n();
  const [issue, setIssue] = useState<IssueRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadIssue() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await listIssues({ projectId });
        if (!isMounted) {
          return;
        }

        const nextIssue =
          response.issues.find((candidate) => candidate.id === issueId) ?? null;
        setIssue(nextIssue);
        if (!nextIssue) {
          setErrorMessage(messages.agentsFeature.issueNotFound);
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setIssue(null);
        setErrorMessage(toCommandError(error).message);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadIssue();

    return () => {
      isMounted = false;
    };
  }, [issueId, messages.agentsFeature.issueNotFound, projectId]);

  const description = issue?.description?.trim().length
    ? issue.description
    : messages.agentsFeature.noDetailsProvided;
  const labels = issue?.labels ?? [];
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
        label: messages.issueSummary.status,
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

  if (isLoading) {
    return (
      <div className="session-issue-panel">
        <p className="session-side-panel__empty" role="status">
          {messages.agentsFeature.loadingIssue}
        </p>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="session-issue-panel">
        <p className="session-side-panel__empty" role="status">
          {errorMessage}
        </p>
      </div>
    );
  }

  return (
    <div className="session-issue-panel">
      <section className="session-issue-panel__card">
        <div className="session-issue-panel__header">
          <h3 className="issue-detail__title">
            {messages.agentsFeature.issueInfo}
          </h3>
          <Button
            className="session-issue-panel__action"
            size="sm"
            type="button"
            variant="secondary"
            onClick={() => onOpenIssue(issueId)}
          >
            {messages.agentsFeature.viewIssue}
          </Button>
        </div>
        <div className="issue-detail__divider" aria-hidden="true" />
        <h4 className="session-issue-panel__issue-title">
          {issue?.title ?? issueTitle}
        </h4>
        <div className="issue-detail__description">{description}</div>
        {labels.length > 0 ? (
          <>
            <div className="issue-detail__divider" aria-hidden="true" />
            <div className="issue-label-picker__selected issue-detail__labels">
              {labels.map((label) => (
                <span
                  key={label.id}
                  className="issue-label-chip"
                  style={{ backgroundColor: label.color }}
                >
                  <span>{label.name}</span>
                </span>
              ))}
            </div>
          </>
        ) : null}
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

      <section className="session-issue-panel__card">
        <h3 className="issue-detail__title">
          {messages.agentsFeature.sessionInfo}
        </h3>
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
