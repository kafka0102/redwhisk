import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { listIssues, type IssueRecord } from "../issues/issue-commands";
import { toCommandError } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";

interface SessionIssuePanelProps {
  issueId: number;
  issueTitle: string;
  projectId: number;
  onOpenIssue: (issueId: number) => void;
}

export function SessionIssuePanel({
  issueId,
  issueTitle,
  projectId,
  onOpenIssue,
}: SessionIssuePanelProps) {
  const { messages } = useI18n();
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
      <div className="session-issue-panel__header">
        <h3 className="issue-detail__title">{issue?.title ?? issueTitle}</h3>
        <Button
          className="session-issue-panel__link"
          size="xs"
          type="button"
          variant="link"
          onClick={() => onOpenIssue(issueId)}
        >
          {messages.agentsFeature.viewIssue}
        </Button>
      </div>
      <div className="issue-detail__divider" aria-hidden="true" />
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
    </div>
  );
}
