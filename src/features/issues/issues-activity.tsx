import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createIssue,
  listIssues,
  updateIssue,
  type IssueRecord,
  type IssueStatus,
} from "./issue-commands";
import { IssueDescriptionEditor } from "./issue-description-editor";
import { toCommandError } from "../../shared/commands/command-error";

interface IssuesActivityProps {
  projectId: number;
}

interface IssueFormState {
  title: string;
  description: string;
}

interface LaneDefinition {
  status: IssueStatus;
  label: string;
}

const EMPTY_FORM: IssueFormState = {
  title: "",
  description: "",
};

const ISSUE_LANES: LaneDefinition[] = [
  {
    status: "backlog",
    label: "Backlog",
  },
  {
    status: "running",
    label: "Running",
  },
  {
    status: "review",
    label: "Review",
  },
  {
    status: "completed",
    label: "Completed",
  },
];

type DialogMode = "create" | "edit";

export function IssuesActivity({ projectId }: IssuesActivityProps) {
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null);
  const [form, setForm] = useState<IssueFormState>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dialogErrorMessage, setDialogErrorMessage] = useState<string | null>(
    null,
  );
  const activeProjectIdRef = useRef(projectId);
  const previousSelectedIssueIdRef = useRef<number | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const dialogFormRef = useRef<HTMLFormElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const cardRefs = useRef(new Map<number, HTMLButtonElement>());
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);

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
      setDialogMode(null);
      setForm(EMPTY_FORM);
      setIsSaving(false);
      setDialogErrorMessage(null);

      try {
        const response = await listIssues({ projectId });
        if (!isMounted || activeProjectIdRef.current !== projectId) {
          return;
        }

        setIssues(response.issues);
        setSelectedIssueId(response.issues[0]?.id ?? null);
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

  useEffect(() => {
    if (!dialogMode) {
      return;
    }

    titleInputRef.current?.focus();
  }, [dialogMode]);

  const selectedIssue = useMemo(
    () => issues.find((issue) => issue.id === selectedIssueId) ?? null,
    [issues, selectedIssueId],
  );

  const lanes = useMemo(
    () =>
      ISSUE_LANES.map((lane) => ({
        ...lane,
        issues: issues.filter((issue) => issue.status === lane.status),
      })),
    [issues],
  );

  function openCreateDialog(trigger: HTMLElement | null) {
    setErrorMessage(null);
    setDialogErrorMessage(null);
    previousSelectedIssueIdRef.current = selectedIssueId;
    dialogTriggerRef.current = trigger;
    setDialogMode("create");
    setForm(EMPTY_FORM);
  }

  function openIssueDialog(issue: IssueRecord, trigger: HTMLElement | null) {
    setErrorMessage(null);
    setDialogErrorMessage(null);
    setSelectedIssueId(issue.id);
    dialogTriggerRef.current = trigger;
    setDialogMode("edit");
    setForm(issueToForm(issue));
  }

  function closeDialog() {
    if (isSaving) {
      return;
    }

    setDialogErrorMessage(null);
    const closingMode = dialogMode;
    const previousSelectedIssue =
      issues.find((issue) => issue.id === previousSelectedIssueIdRef.current) ??
      selectedIssue;

    if (closingMode === "create") {
      if (previousSelectedIssue) {
        setSelectedIssueId(previousSelectedIssue.id);
      } else {
        setSelectedIssueId(null);
      }
    }

    setDialogMode(null);
    setForm(EMPTY_FORM);
    setIsSaving(false);
    restoreDialogTriggerFocus(previousSelectedIssue);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving || !dialogMode) {
      return;
    }

    setDialogErrorMessage(null);
    setIsSaving(true);
    const requestProjectId = projectId;

    try {
      if (dialogMode === "create") {
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
        setDialogMode(null);
        setForm(EMPTY_FORM);
        restoreDialogTriggerFocus(createdIssue);
      } else if (selectedIssue) {
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
        setDialogMode(null);
        setForm(EMPTY_FORM);
        restoreDialogTriggerFocus(updatedIssue);
      }
    } catch (error) {
      if (activeProjectIdRef.current === requestProjectId) {
        setDialogErrorMessage(toCommandError(error).message);
      }
    } finally {
      if (activeProjectIdRef.current === requestProjectId) {
        setIsSaving(false);
      }
    }
  }

  function restoreDialogTriggerFocus(fallbackIssue: IssueRecord | null) {
    const trigger = dialogTriggerRef.current;
    if (trigger?.isConnected) {
      trigger.focus();
      return;
    }

    if (fallbackIssue) {
      cardRefs.current.get(fallbackIssue.id)?.focus();
      return;
    }

    createButtonRef.current?.focus();
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const activeElement = document.activeElement;
    const closeButton = closeButtonRef.current;
    const cancelButton = cancelButtonRef.current;
    const saveButton = saveButtonRef.current;

    if (
      event.shiftKey &&
      activeElement === titleInputRef.current &&
      cancelButton &&
      !cancelButton.disabled
    ) {
      event.preventDefault();
      cancelButton.focus();
      return;
    }

    if (!event.shiftKey && activeElement === saveButton && closeButton) {
      event.preventDefault();
      closeButton.focus();
      return;
    }

    const focusableElements = getFocusableDialogElements(dialogFormRef.current);
    if (focusableElements.length === 0) {
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  const dialogTitle = dialogMode === "create" ? "New Issue" : "Issue Detail";

  return (
    <main className="activity-surface activity-surface--issues">
      <div className="issues-header">
        <h2>Issues</h2>
      </div>
      {errorMessage ? (
        <p className="issues-status" role="status" aria-label="Issues status">
          {errorMessage}
        </p>
      ) : null}
      <section className="issues-kanban" aria-label="Issues kanban">
        {isLoading ? (
          <p className="issues-loading" role="status">
            Loading issues...
          </p>
        ) : null}
        {lanes.map((lane) => (
          <section
            key={lane.status}
            aria-label={lane.label}
            className={`issue-lane issue-lane--${lane.status}`}
          >
            <div className="issue-lane__header">
              <div className="issue-lane__title-row">
                <span className="issue-lane__status-dot" aria-hidden="true" />
                <h3>{lane.label}</h3>
                <span className="issue-lane__count">{lane.issues.length}</span>
                {lane.status === "backlog" ? (
                  <button
                    ref={createButtonRef}
                    aria-label="New Issue"
                    className="issue-lane__create"
                    title="New Issue"
                    type="button"
                    onClick={(event) => openCreateDialog(event.currentTarget)}
                  >
                    <Plus aria-hidden="true" size={14} strokeWidth={2} />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="issue-lane__cards" role="list">
              {lane.issues.map((issue) => {
                const metaId = `issue-card-meta-${issue.id}`;
                const descriptionId = `issue-card-description-${issue.id}`;

                return (
                  <div key={issue.id} role="listitem">
                    <button
                      ref={(element) => {
                        if (element) {
                          cardRefs.current.set(issue.id, element);
                        } else {
                          cardRefs.current.delete(issue.id);
                        }
                      }}
                      aria-describedby={
                        issue.description
                          ? `${metaId} ${descriptionId}`
                          : metaId
                      }
                      aria-label={issue.title}
                      aria-pressed={issue.id === selectedIssueId}
                      className="issue-card"
                      type="button"
                      onClick={(event) =>
                        openIssueDialog(issue, event.currentTarget)
                      }
                    >
                      <span id={metaId} className="issue-card__meta-row">
                        <span className="issue-card__id">#{issue.id}</span>
                        <span className="issue-card__updated">
                          {formatLocalTimestamp(issue.updatedAt)}
                        </span>
                      </span>
                      <span className="issue-card__title">{issue.title}</span>
                      {issue.description ? (
                        <span
                          id={descriptionId}
                          className="issue-card__description"
                        >
                          {markdownToExcerpt(issue.description)}
                        </span>
                      ) : null}
                    </button>
                  </div>
                );
              })}
              {!isLoading && lane.issues.length === 0 ? (
                <p className="issue-lane__empty">no issues</p>
              ) : null}
            </div>
          </section>
        ))}
      </section>

      {dialogMode ? (
        <div
          className="issue-dialog-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDialog();
            }
          }}
        >
          <form
            ref={dialogFormRef}
            aria-label={dialogTitle}
            aria-modal="true"
            className="issue-dialog"
            role="dialog"
            onKeyDown={handleDialogKeyDown}
            onSubmit={handleSubmit}
          >
            <div className="issue-dialog__header">
              <h3>{dialogTitle}</h3>
              <button
                ref={closeButtonRef}
                aria-label="Close issue dialog"
                className="issue-dialog__close"
                type="button"
                disabled={isSaving}
                onClick={closeDialog}
              >
                x
              </button>
            </div>
            <div className="issue-dialog__body">
              <div className="issue-dialog__editor">
                <div className="issue-field">
                  <Input
                    ref={titleInputRef}
                    aria-label="Title"
                    autoCapitalize="none"
                    autoCorrect="off"
                    name="title"
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
                    ariaLabel="Description"
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
              <aside className="issue-dialog__side" aria-label="Issue actions">
                <section className="issue-dialog__panel">
                  <h4>Session</h4>
                  <p>No session linked.</p>
                </section>
                <section className="issue-dialog__panel">
                  <h4>Actions</h4>
                  {dialogMode === "edit" &&
                  selectedIssue?.status === "backlog" ? (
                    <Button
                      className="issues-button"
                      type="button"
                      variant="outline"
                      disabled
                    >
                      Run
                    </Button>
                  ) : (
                    <p>No actions available.</p>
                  )}
                </section>
              </aside>
            </div>
            <p
              className="issue-dialog__status"
              role="status"
              aria-label="Dialog status"
            >
              {dialogErrorMessage}
            </p>
            <div className="issue-dialog__footer">
              <Button
                ref={cancelButtonRef}
                className="issues-button"
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={closeDialog}
              >
                Cancel
              </Button>
              <Button
                ref={saveButtonRef}
                className="issues-button issues-button--primary"
                type="submit"
                disabled={isSaving}
              >
                {dialogMode === "create" ? "Create Issue" : "Save"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
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

function markdownToExcerpt(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/```([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|\d+\.|[-*+]|>)\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getFocusableDialogElements(
  dialogElement: HTMLFormElement | null,
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
