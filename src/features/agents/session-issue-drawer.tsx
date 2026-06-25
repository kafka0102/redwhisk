import { useEffect, useState } from "react";

import { listIssues, type IssueRecord } from "../issues/issue-commands";
import { toCommandError } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";

interface SessionIssueDrawerProps {
  issueId: number;
  issueTitle: string;
  projectId: number;
  onClose: () => void;
}

export function SessionIssueDrawer({
  issueId,
  issueTitle,
  projectId,
  onClose,
}: SessionIssueDrawerProps) {
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

  return (
    <aside
      className="agents-issue-drawer"
      aria-label={messages.agentsFeature.issueDetails}
    >
      <div className="agents-issue-drawer__header">
        <div className="agents-issue-drawer__copy">
          <p className="agents-issue-drawer__eyebrow">
            {messages.agentsFeature.issueEyebrow}
          </p>
          <h4>{issue?.title ?? issueTitle}</h4>
        </div>
        <button
          aria-label={messages.agentsFeature.closeIssueDetails}
          className="issue-dialog__close"
          type="button"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="agents-issue-drawer__body">
        {isLoading ? (
          <p className="issues-status" role="status">
            {messages.agentsFeature.loadingIssue}
          </p>
        ) : errorMessage ? (
          <p className="issues-status" role="status">
            {errorMessage}
          </p>
        ) : (
          <>
            <section className="issue-dialog__panel">
              <h4>{messages.agentsFeature.titleField}</h4>
              <p className="issue-detail__title">
                {issue?.title ?? issueTitle}
              </p>
            </section>
            <section className="issue-dialog__panel">
              <h4>{messages.agentsFeature.detailsField}</h4>
              <div className="issue-detail__description">{description}</div>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
