import { useEffect, useRef, useState } from "react";

import { getIssueSummary, type IssueSummaryRecord } from "./issue-commands";
import { toCommandError } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";

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
  const { messages } = useI18n();
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
        aria-label={messages.issues.issueSummary}
        aria-modal="true"
        className="issue-dialog issue-dialog--compact"
        role="dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="issue-dialog__header">
          <h3>{messages.issues.issueSummary}</h3>
          <button
            ref={closeButtonRef}
            aria-label={messages.issues.summaryClose}
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
                {messages.issues.loadingSummary}
              </p>
            ) : null}
            {summary ? (
              <>
                <section className="issue-dialog__panel">
                  <h4>{messages.issueSummary.issue}</h4>
                  <p>{`#${summary.issue.number} ${summary.issue.title}`}</p>
                  <p>{`${messages.issueSummary.status}: ${summary.issue.status}`}</p>
                  <p>
                    {`${messages.issueSummary.updatedAt}: ${formatLocalTimestamp(summary.issue.updatedAt)}`}
                  </p>
                </section>
                <section className="issue-dialog__panel">
                  <h4>{messages.issueSummary.session}</h4>
                  <p>
                    {summary.issue.linkedSessionId != null
                      ? messages.issueSummary.linkedSession(
                          summary.issue.linkedSessionId,
                        )
                      : messages.issueSummary.noLinkedSession}
                  </p>
                  <p>
                    {`${messages.issueSummary.sessionStatus}: ${
                      summary.issue.linkedSessionStatus ??
                      messages.issueSummary.unknown
                    }`}
                  </p>
                  <p>
                    {`${messages.issueSummary.startedAt}: ${formatOptionalTimestamp(
                      summary.sessionStartedAt,
                      messages.issueSummary.unknown,
                    )}`}
                  </p>
                  <p>
                    {`${messages.issueSummary.closedAt}: ${formatOptionalTimestamp(
                      summary.sessionClosedAt,
                      messages.issueSummary.unknown,
                    )}`}
                  </p>
                  <p>
                    {`${messages.issueSummary.logPath}: ${
                      summary.issue.linkedSessionLogPath ??
                      messages.issueSummary.unknown
                    }`}
                  </p>
                </section>
                <section className="issue-dialog__panel">
                  <h4>{messages.issueSummary.completion}</h4>
                  <p>
                    {`${messages.issueSummary.option}: ${
                      summary.completion?.option ??
                      messages.issueSummary.unknown
                    }`}
                  </p>
                  <p>
                    {`${messages.issueSummary.result}: ${
                      summary.completion?.result ??
                      messages.issueSummary.unknown
                    }`}
                  </p>
                  <p>
                    {`${messages.issueSummary.commitHash}: ${
                      summary.completion?.commitHash ??
                      messages.issueSummary.noCommit
                    }`}
                  </p>
                  {summary.completion?.failureReason ? (
                    <p>
                      {`${messages.issueSummary.failureReason}: ${summary.completion.failureReason}`}
                    </p>
                  ) : null}
                  {summary.completion?.createdAt ? (
                    <p>
                      {`${messages.issueSummary.recordedAt}: ${formatLocalTimestamp(summary.completion.createdAt)}`}
                    </p>
                  ) : null}
                  {summary.completion?.source ? (
                    <p>
                      {`${messages.issueSummary.source}: ${summary.completion.source}`}
                    </p>
                  ) : null}
                </section>
                <section className="issue-dialog__panel">
                  <h4>{messages.issueSummary.diagnostics}</h4>
                  {summary.diagnostics.length > 0 ? (
                    <ul className="completion-preview__files">
                      {summary.diagnostics.map((diagnostic) => (
                        <li key={diagnostic}>{diagnostic}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>{messages.issues.noDiagnostics}</p>
                  )}
                </section>
              </>
            ) : null}
          </div>
        </div>
        <p
          className="issue-dialog__status"
          role="status"
          aria-label={messages.issues.issueSummaryStatus}
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

function formatOptionalTimestamp(
  epochMilliseconds: number | null | undefined,
  fallback: string,
): string {
  return epochMilliseconds != null
    ? formatLocalTimestamp(epochMilliseconds)
    : fallback;
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
