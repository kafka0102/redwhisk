import { openPath } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  listIssues,
  updateIssue,
  type AgentSessionStatus,
  type IssueRecord,
} from "../issues/issue-commands";
import { IssueDescriptionEditor } from "../issues/issue-description-editor";
import { IssueSummaryDialog } from "../issues/issue-summary-dialog";
import { toCommandError } from "../../shared/commands/command-error";

interface IssueInspectorProps {
  issueId: number;
  issueTitle: string;
  linkedSessionId: number;
  linkedSessionStatus: AgentSessionStatus | null;
  linkedSessionLogPath?: string | null;
  onClose: () => void;
  onIssueUpdated: (issue: IssueRecord) => void;
  onOpenIssuesActivity?: (issueId: number) => void;
  projectId: number;
}

interface IssueFormState {
  title: string;
  description: string;
}

export function IssueInspector({
  issueId,
  issueTitle,
  linkedSessionId,
  linkedSessionStatus,
  linkedSessionLogPath = null,
  onClose,
  onIssueUpdated,
  onOpenIssuesActivity,
  projectId,
}: IssueInspectorProps) {
  const [issue, setIssue] = useState<IssueRecord | null>(null);
  const [form, setForm] = useState<IssueFormState>({
    title: issueTitle,
    description: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isOpeningLog, setIsOpeningLog] = useState(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const activeProjectIdRef = useRef(projectId);

  useEffect(() => {
    activeProjectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    let isMounted = true;

    async function loadIssue() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await listIssues({ projectId });
        if (!isMounted || activeProjectIdRef.current !== projectId) {
          return;
        }

        const nextIssue =
          response.issues.find((candidate) => candidate.id === issueId) ?? null;
        if (!nextIssue) {
          setIssue(null);
          setForm({
            title: issueTitle,
            description: "",
          });
          setErrorMessage("Linked issue no longer exists.");
          return;
        }

        setIssue(nextIssue);
        setForm(issueToForm(nextIssue));
      } catch (error) {
        if (isMounted && activeProjectIdRef.current === projectId) {
          setErrorMessage(toCommandError(error).message);
          setIssue(null);
          setForm({
            title: issueTitle,
            description: "",
          });
        }
      } finally {
        if (isMounted && activeProjectIdRef.current === projectId) {
          setIsLoading(false);
        }
      }
    }

    void loadIssue();

    return () => {
      isMounted = false;
    };
  }, [issueId, issueTitle, projectId]);

  const effectiveLogPath = issue?.linkedSessionLogPath ?? linkedSessionLogPath;
  const canOpenLog =
    issue?.status === "completed" ||
    linkedSessionStatus === "crashed" ||
    linkedSessionStatus === "stopped";
  const canViewSummary = issue?.status === "completed";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    setErrorMessage(null);
    setIsSaving(true);

    try {
      const updatedIssue = await updateIssue({
        projectId,
        issueId,
        title: form.title,
        description: form.description,
      });
      if (activeProjectIdRef.current !== projectId) {
        return;
      }

      setIssue(updatedIssue);
      setForm(issueToForm(updatedIssue));
      onIssueUpdated(updatedIssue);
    } catch (error) {
      if (activeProjectIdRef.current === projectId) {
        setErrorMessage(toCommandError(error).message);
      }
    } finally {
      if (activeProjectIdRef.current === projectId) {
        setIsSaving(false);
      }
    }
  }

  async function handleOpenLog() {
    if (isOpeningLog) {
      return;
    }

    setErrorMessage(null);

    if (!effectiveLogPath) {
      setErrorMessage("No log path recorded for this session.");
      return;
    }

    setIsOpeningLog(true);

    try {
      await openPath(effectiveLogPath);
    } catch (error) {
      if (activeProjectIdRef.current === projectId) {
        setErrorMessage(toCommandError(error).message);
      }
    } finally {
      if (activeProjectIdRef.current === projectId) {
        setIsOpeningLog(false);
      }
    }
  }

  return (
    <form
      aria-label="Issue Inspector"
      className="issue-inspector"
      onSubmit={handleSubmit}
    >
      <div className="issue-inspector__header">
        <div className="issue-inspector__copy">
          <p className="issue-inspector__eyebrow">Issue Inspector</p>
          <h4>{issue?.title ?? issueTitle}</h4>
        </div>
        <button
          aria-label="Close issue inspector"
          className="issue-dialog__close"
          type="button"
          onClick={onClose}
        >
          x
        </button>
      </div>

      <div className="issue-inspector__body">
        <div className="issue-inspector__editor">
          <div className="issue-field">
            <Input
              aria-label="Issue title"
              autoCapitalize="none"
              autoCorrect="off"
              disabled={isLoading || isSaving}
              placeholder="Issue title"
              spellCheck={false}
              value={form.title}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  title: event.target.value,
                }))
              }
            />
          </div>
          <div className="issue-field">
            <IssueDescriptionEditor
              ariaLabel="Issue description"
              placeholder="Describe the task"
              value={form.description}
              onChange={(description) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  description,
                }))
              }
            />
          </div>
        </div>

        <div className="issue-inspector__side">
          <section className="issue-dialog__panel">
            <h4>Session</h4>
            <p>{`Linked session #${linkedSessionId}`}</p>
            <p>{`Status: ${formatAgentSessionStatus(linkedSessionStatus)}`}</p>
            {effectiveLogPath ? <p>{`Log path: ${effectiveLogPath}`}</p> : null}
          </section>
          <section className="issue-dialog__panel">
            <h4>Actions</h4>
            {canViewSummary ? (
              <>
                <Button
                  className="issues-button"
                  disabled={isLoading}
                  type="button"
                  variant="outline"
                  onClick={() => setIsSummaryOpen(true)}
                >
                  View Summary
                </Button>
                <p>Review the completed issue summary.</p>
                <Button
                  className="issues-button"
                  disabled={isLoading || isOpeningLog}
                  type="button"
                  variant="outline"
                  onClick={() => void handleOpenLog()}
                >
                  {isOpeningLog ? "打开中..." : "Open Log"}
                </Button>
                <p>Open the completed session log for review.</p>
                {onOpenIssuesActivity ? (
                  <>
                    <Button
                      className="issues-button"
                      disabled={isLoading}
                      type="button"
                      variant="outline"
                      onClick={() => onOpenIssuesActivity(issueId)}
                    >
                      Open in Issues
                    </Button>
                    <p>Open this issue in the issues board.</p>
                  </>
                ) : null}
              </>
            ) : canOpenLog ? (
              <>
                <Button
                  className="issues-button"
                  disabled={isLoading || isOpeningLog}
                  type="button"
                  variant="outline"
                  onClick={() => void handleOpenLog()}
                >
                  {isOpeningLog ? "打开中..." : "Open Log"}
                </Button>
                <p>Open the abnormal session log for diagnosis.</p>
                {onOpenIssuesActivity ? (
                  <>
                    <Button
                      className="issues-button"
                      disabled={isLoading}
                      type="button"
                      variant="outline"
                      onClick={() => onOpenIssuesActivity(issueId)}
                    >
                      Open in Issues
                    </Button>
                    <p>Open this issue in the issues board.</p>
                  </>
                ) : null}
              </>
            ) : onOpenIssuesActivity ? (
              <>
                <Button
                  className="issues-button"
                  disabled={isLoading}
                  type="button"
                  variant="outline"
                  onClick={() => onOpenIssuesActivity(issueId)}
                >
                  Open in Issues
                </Button>
                <p>Open this issue in the issues board.</p>
              </>
            ) : (
              <p>No actions available.</p>
            )}
          </section>
        </div>
      </div>

      <p
        aria-label="Inspector status"
        className="issue-dialog__status"
        role="status"
      >
        {errorMessage}
      </p>

      <div className="issue-inspector__footer">
        <Button
          className="issues-button"
          disabled={isSaving}
          type="button"
          variant="outline"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          className="issues-button issues-button--primary"
          disabled={isLoading || isSaving}
          type="submit"
        >
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </div>
      {isSummaryOpen ? (
        <IssueSummaryDialog
          issueId={issueId}
          projectId={projectId}
          onClose={() => setIsSummaryOpen(false)}
        />
      ) : null}
    </form>
  );
}

function issueToForm(issue: IssueRecord): IssueFormState {
  return {
    title: issue.title,
    description: issue.description,
  };
}

function formatAgentSessionStatus(status: AgentSessionStatus | null): string {
  switch (status) {
    case "running":
      return "running";
    case "closed":
      return "closed";
    case "crashed":
      return "crashed";
    case "stopped":
      return "stopped";
    default:
      return "unknown";
  }
}
