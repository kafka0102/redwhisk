import { useEffect, useRef, useState } from "react";

import { getIssueSummary, type IssueSummaryRecord } from "./issue-commands";
import { toCommandError } from "../../shared/commands/command-error";

interface IssueSummaryDialogProps {
  issueId: number;
  projectId: number;
  onClose: () => void;
}

export function IssueSummaryDialog({
  issueId,
  projectId,
  onClose,
}: IssueSummaryDialogProps) {
  const [summary, setSummary] = useState<IssueSummaryRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadSummary() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const nextSummary = await getIssueSummary({ issueId, projectId });
        if (isMounted) {
          setSummary(nextSummary);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(toCommandError(error).message);
          setSummary(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadSummary();

    return () => {
      isMounted = false;
    };
  }, [issueId, projectId]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = getFocusableDialogElements(dialogRef.current);
    if (focusableElements.length === 0) {
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  return (
    <div
      className="issue-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        aria-label="Issue Summary"
        aria-modal="true"
        className="issue-dialog issue-dialog--compact"
        role="dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="issue-dialog__header">
          <h3>Issue Summary</h3>
          <button
            ref={closeButtonRef}
            aria-label="Close issue summary"
            className="issue-dialog__close"
            type="button"
            onClick={onClose}
          >
            x
          </button>
        </div>
        <div className="issue-dialog__body issue-dialog__body--single">
          <div className="issue-dialog__editor">
            {isLoading ? (
              <p className="issues-loading" role="status">
                Loading summary...
              </p>
            ) : null}
            {summary ? (
              <>
                <section className="issue-dialog__panel">
                  <h4>Issue</h4>
                  <p>{`#${summary.issue.id} ${summary.issue.title}`}</p>
                  <p>{`Status: ${summary.issue.status}`}</p>
                  <p>{`Updated: ${formatLocalTimestamp(summary.issue.updatedAt)}`}</p>
                </section>
                <section className="issue-dialog__panel">
                  <h4>Session</h4>
                  <p>
                    {summary.issue.linkedSessionId != null
                      ? `Linked session #${summary.issue.linkedSessionId}`
                      : "No linked session"}
                  </p>
                  <p>{`Session status: ${summary.issue.linkedSessionStatus ?? "unknown"}`}</p>
                  <p>
                    {`Started: ${formatOptionalTimestamp(summary.sessionStartedAt)}`}
                  </p>
                  <p>
                    {`Closed: ${formatOptionalTimestamp(summary.sessionClosedAt)}`}
                  </p>
                  <p>
                    {`Log path: ${summary.issue.linkedSessionLogPath ?? "missing"}`}
                  </p>
                </section>
                <section className="issue-dialog__panel">
                  <h4>Completion</h4>
                  <p>{`Option: ${summary.completion?.option ?? "unknown"}`}</p>
                  <p>{`Result: ${summary.completion?.result ?? "unknown"}`}</p>
                  <p>
                    {`Commit hash: ${summary.completion?.commitHash ?? "未产生提交"}`}
                  </p>
                  {summary.completion?.failureReason ? (
                    <p>{`Failure reason: ${summary.completion.failureReason}`}</p>
                  ) : null}
                  {summary.completion?.createdAt ? (
                    <p>
                      {`Recorded: ${formatLocalTimestamp(summary.completion.createdAt)}`}
                    </p>
                  ) : null}
                  {summary.completion?.source ? (
                    <p>{`Source: ${summary.completion.source}`}</p>
                  ) : null}
                </section>
                <section className="issue-dialog__panel">
                  <h4>Diagnostics</h4>
                  {summary.diagnostics.length > 0 ? (
                    <ul className="completion-preview__files">
                      {summary.diagnostics.map((diagnostic) => (
                        <li key={diagnostic}>{diagnostic}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No diagnostics.</p>
                  )}
                </section>
              </>
            ) : null}
          </div>
        </div>
        <p
          className="issue-dialog__status"
          role="status"
          aria-label="Summary status"
        >
          {errorMessage}
        </p>
      </div>
    </div>
  );
}

function formatLocalTimestamp(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toLocaleString();
}

function formatOptionalTimestamp(epochMilliseconds?: number | null): string {
  return epochMilliseconds != null
    ? formatLocalTimestamp(epochMilliseconds)
    : "unknown";
}

function getFocusableDialogElements(
  dialogElement: HTMLDivElement | null,
): HTMLElement[] {
  if (!dialogElement) {
    return [];
  }

  return Array.from(
    dialogElement.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [contenteditable="true"], a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.tabIndex >= 0);
}
