import { useEffect, useMemo, useRef, useState } from "react";

import {
  createIssue,
  listIssues,
  updateIssue,
  type IssueRecord,
} from "./issue-commands";
import { toCommandError } from "../../shared/commands/command-error";

interface IssuesActivityProps {
  projectId: number;
}

interface IssueFormState {
  title: string;
  description: string;
}

const EMPTY_FORM: IssueFormState = {
  title: "",
  description: "",
};

export function IssuesActivity({ projectId }: IssuesActivityProps) {
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(null);
  const [mode, setMode] = useState<"idle" | "create" | "edit">("idle");
  const [form, setForm] = useState<IssueFormState>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const activeProjectIdRef = useRef(projectId);
  const previousSelectedIssueIdRef = useRef<number | null>(null);

  useEffect(() => {
    activeProjectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    let isMounted = true;

    async function loadIssues() {
      setIsLoading(true);
      setErrorMessage(null);
      setIssues([]);
      setSelectedIssueId(null);
      setMode("idle");
      setForm(EMPTY_FORM);
      setIsSaving(false);

      try {
        const response = await listIssues({ projectId });
        if (!isMounted || activeProjectIdRef.current !== projectId) {
          return;
        }

        setIssues(response.issues);
        const firstIssue = response.issues[0] ?? null;
        setSelectedIssueId(firstIssue?.id ?? null);
        if (firstIssue) {
          setMode("edit");
          setForm(issueToForm(firstIssue));
        } else {
          setMode("idle");
          setForm(EMPTY_FORM);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(toCommandError(error).message);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadIssues();

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  const selectedIssue = useMemo(
    () => issues.find((issue) => issue.id === selectedIssueId) ?? null,
    [issues, selectedIssueId],
  );

  function handleNewIssue() {
    setErrorMessage(null);
    previousSelectedIssueIdRef.current = selectedIssueId;
    setMode("create");
    setForm(EMPTY_FORM);
  }

  function handleCancelCreate() {
    setErrorMessage(null);
    const previousSelectedIssue =
      issues.find((issue) => issue.id === previousSelectedIssueIdRef.current) ??
      selectedIssue;

    if (previousSelectedIssue) {
      setSelectedIssueId(previousSelectedIssue.id);
      setMode("edit");
      setForm(issueToForm(previousSelectedIssue));
      return;
    }

    setMode("idle");
    setForm(EMPTY_FORM);
  }

  function handleIssueSelect(issue: IssueRecord) {
    setErrorMessage(null);
    setSelectedIssueId(issue.id);
    setMode("edit");
    setForm(issueToForm(issue));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    setErrorMessage(null);
    setIsSaving(true);
    const requestProjectId = projectId;

    try {
      if (mode === "create") {
        const createdIssue = await createIssue({
          projectId: requestProjectId,
          title: form.title,
          description: form.description,
        });
        if (activeProjectIdRef.current !== requestProjectId) {
          return;
        }
        setIssues((currentIssues) => mergeIssue(currentIssues, createdIssue));
        setSelectedIssueId(createdIssue.id);
        setMode("edit");
        setForm(issueToForm(createdIssue));
      } else if (mode === "edit" && selectedIssue) {
        const updatedIssue = await updateIssue({
          projectId: requestProjectId,
          issueId: selectedIssue.id,
          title: form.title,
          description: form.description,
        });
        if (activeProjectIdRef.current !== requestProjectId) {
          return;
        }
        setIssues((currentIssues) => mergeIssue(currentIssues, updatedIssue));
        setSelectedIssueId(updatedIssue.id);
        setForm(issueToForm(updatedIssue));
      }
    } catch (error) {
      if (activeProjectIdRef.current === requestProjectId) {
        setErrorMessage(toCommandError(error).message);
      }
    } finally {
      if (activeProjectIdRef.current === requestProjectId) {
        setIsSaving(false);
      }
    }
  }

  return (
    <main className="activity-surface">
      <div className="issues-header">
        <h2>Issues</h2>
        {issues.length > 0 ? (
          <button
            className="issues-button issues-button--primary"
            type="button"
            onClick={handleNewIssue}
          >
            New Issue
          </button>
        ) : null}
      </div>
      {errorMessage ? (
        <p className="issues-status" role="status" aria-label="Issues status">
          {errorMessage}
        </p>
      ) : null}
      <section className="issues-workspace" aria-label="Issues workspace">
        {isLoading ? <p className="empty-state">Loading issues...</p> : null}
        {!isLoading && issues.length === 0 ? (
          <div className="empty-state">
            <p>No issues yet.</p>
            {mode === "idle" ? (
              <button
                className="issues-button issues-button--primary"
                type="button"
                onClick={handleNewIssue}
              >
                New Issue
              </button>
            ) : null}
          </div>
        ) : null}
        {issues.length > 0 ? (
          <div className="issues-list" aria-label="Project issues" role="list">
            {issues.map((issue) => (
              <div key={issue.id} role="listitem">
                <button
                  aria-label={issue.title}
                  aria-pressed={issue.id === selectedIssueId}
                  className="issue-list-item"
                  type="button"
                  onClick={() => handleIssueSelect(issue)}
                >
                  <span className="issue-list-item__title">{issue.title}</span>
                  <span className="issue-list-item__meta">
                    {issue.status} · {formatLocalTimestamp(issue.updatedAt)}
                  </span>
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {mode === "create" || (mode === "edit" && selectedIssue) ? (
          <form className="issue-form" onSubmit={handleSubmit}>
            <label className="issue-field">
              <span>Title</span>
              <input
                name="title"
                value={form.title}
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    title: event.target.value,
                  }))
                }
              />
            </label>
            <label className="issue-field">
              <span>Description</span>
              <textarea
                name="description"
                rows={8}
                value={form.description}
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    description: event.target.value,
                  }))
                }
              />
            </label>
            <div className="issue-form__actions">
              {mode === "create" ? (
                <button
                  className="issues-button"
                  type="button"
                  onClick={handleCancelCreate}
                >
                  Cancel
                </button>
              ) : null}
              <button
                className="issues-button issues-button--primary"
                type="submit"
                disabled={isSaving}
              >
                {mode === "create" ? "Create Issue" : "Save"}
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </main>
  );
}

function issueToForm(issue: IssueRecord): IssueFormState {
  return {
    title: issue.title,
    description: issue.description,
  };
}

function mergeIssue(
  currentIssues: IssueRecord[],
  nextIssue: IssueRecord,
): IssueRecord[] {
  const remainingIssues = currentIssues.filter(
    (issue) => issue.id !== nextIssue.id,
  );

  return [nextIssue, ...remainingIssues];
}

function formatLocalTimestamp(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toLocaleString();
}
