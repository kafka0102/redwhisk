import { convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  advanceIssueStatus,
  completeIssueManual,
  createIssue,
  deleteIssue,
  exportIssueAttachment,
  listIssues,
  markIssueReview,
  previewIssueAttachment,
  updateIssue,
  type IssueStatus,
  type IssueAttachmentRecord,
  type IssueAttachmentPreviewRecord,
  type IssueRecord,
} from "./issue-commands";
import { IssueAttachmentPreviewDialog } from "./issue-attachment-preview-dialog";
import {
  EMPTY_FORM,
  type AttachmentPreviewState,
  type DialogMode,
  type IssueFormState,
} from "./issue-activity-types";
import { IssueFormDialog } from "./issue-form-dialog";
import { IssuesKanban } from "./issues-kanban";
import { IssueRunDialog } from "./issue-run-dialog";
import { IssueSummaryDialog } from "./issue-summary-dialog";
import type { IssueAttachmentDraft } from "./issue-description-editor";
import { toCommandError } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";

interface IssuesActivityProps {
  projectId: number;
  onOpenAgentsActivity?: (sessionId: number) => void;
  requestedIssueId?: number | null;
}

export function IssuesActivity({
  projectId,
  onOpenAgentsActivity,
  requestedIssueId = null,
}: IssuesActivityProps) {
  const { messages } = useI18n();
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(
    requestedIssueId,
  );
  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null);
  const [runDialogIssue, setRunDialogIssue] = useState<Pick<
    IssueRecord,
    "id" | "title" | "description" | "attachments"
  > | null>(null);
  const [summaryIssueId, setSummaryIssueId] = useState<number | null>(null);
  const [attachmentPreview, setAttachmentPreview] =
    useState<AttachmentPreviewState | null>(null);
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
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const cardRefs = useRef(new Map<number, HTMLButtonElement>());
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const runDialogTriggerRef = useRef<HTMLElement | null>(null);

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
      setRunDialogIssue(null);
      setForm(EMPTY_FORM);
      setIsSaving(false);
      setDialogErrorMessage(null);

      try {
        const response = await listIssues({ projectId });
        if (!isMounted || activeProjectIdRef.current !== projectId) {
          return;
        }

        setIssues(response.issues);
        setSelectedIssueId(
          response.issues.find((issue) => issue.id === requestedIssueId)?.id ??
            response.issues[0]?.id ??
            null,
        );
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
  }, [projectId, requestedIssueId]);

  const selectedIssue = useMemo(
    () => issues.find((issue) => issue.id === selectedIssueId) ?? null,
    [issues, selectedIssueId],
  );

  useEffect(() => {
    if (!dialogMode) {
      return;
    }

    if (dialogMode === "create" || selectedIssue?.status === "backlog") {
      titleInputRef.current?.focus();
      return;
    }

    dialogFormRef.current?.focus();
  }, [dialogMode, selectedIssue?.status]);

  const lanes = useMemo(
    () =>
      [
        {
          status: "backlog" as const,
          label: messages.issues.backlog,
        },
        {
          status: "running" as const,
          label: messages.issues.inProgress,
        },
        {
          status: "review" as const,
          label: messages.issues.review,
        },
        {
          status: "completed" as const,
          label: messages.issues.done,
        },
      ].map((lane) => ({
        ...lane,
        issues: issues.filter((issue) => issue.status === lane.status),
      })),
    [
      issues,
      messages.issues.backlog,
      messages.issues.done,
      messages.issues.inProgress,
      messages.issues.review,
    ],
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
    setRunDialogIssue(null);
    setSummaryIssueId(null);
    setAttachmentPreview(null);
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
          description: buildIssueDescription(
            form.description,
            form.attachments,
          ),
          attachments: serializeAttachments(form.attachments),
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
          description: buildIssueDescription(
            form.description,
            form.attachments,
          ),
          attachments: serializeAttachments(form.attachments),
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
      if (canDismissWithoutCloseButton) {
        event.preventDefault();
        closeDialog();
      }
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const activeElement = document.activeElement;
    const closeButton = closeButtonRef.current;
    const saveButton = saveButtonRef.current;

    if (
      event.shiftKey &&
      activeElement === titleInputRef.current &&
      saveButton &&
      !saveButton.disabled
    ) {
      event.preventDefault();
      saveButton.focus();
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

  function openRunDialog(
    issue: Pick<
      IssueRecord,
      | "id"
      | "title"
      | "description"
      | "attachments"
      | "status"
      | "linkedSessionId"
    >,
    trigger: HTMLElement | null,
  ) {
    if (!canRunIssueFor(issue)) {
      return;
    }

    runDialogTriggerRef.current = trigger;
    setRunDialogIssue(issue);
  }

  function openLinkedSession() {
    if (!selectedIssue?.linkedSessionId) {
      return;
    }

    setDialogErrorMessage(null);
    setRunDialogIssue(null);
    setDialogMode(null);
    setForm(EMPTY_FORM);
    onOpenAgentsActivity?.(selectedIssue.linkedSessionId);
  }

  function handleOpenSummary() {
    if (selectedIssue?.status !== "completed") {
      return;
    }

    setDialogErrorMessage(null);
    setSummaryIssueId(selectedIssue.id);
  }

  function closeRunDialog() {
    setRunDialogIssue(null);
    runDialogTriggerRef.current?.focus();
  }

  async function handleRunStarted(result: {
    issueId: number;
    sessionId?: number | null;
  }) {
    setRunDialogIssue(null);

    try {
      const response = await listIssues({ projectId });
      if (activeProjectIdRef.current !== projectId) {
        return;
      }

      setIssues(response.issues);
      setSelectedIssueId(result.issueId);
    } catch (error) {
      if (activeProjectIdRef.current === projectId) {
        setErrorMessage(toCommandError(error).message);
      }
    } finally {
      if (
        activeProjectIdRef.current === projectId &&
        result.sessionId != null
      ) {
        onOpenAgentsActivity?.(result.sessionId);
      }
    }
  }

  const isBacklogDialog =
    dialogMode === "create" || selectedIssue?.status === "backlog";
  const hasLinkedSession = selectedIssue?.linkedSessionId != null;
  const canViewSummary =
    dialogMode === "edit" && selectedIssue?.status === "completed";
  const canOpenLinkedSession = hasLinkedSession && Boolean(onOpenAgentsActivity);
  const canDismissWithoutCloseButton = !hasUnsavedDialogChanges(
    dialogMode,
    form,
    selectedIssue,
  );

  async function handleSelectAttachment() {
    const selectedPath = await open({
      directory: false,
      multiple: false,
      title: "Select attachment",
    });

    if (typeof selectedPath !== "string") {
      return;
    }

    const attachment = buildDraftAttachment(selectedPath);
    setForm((currentForm) => ({
      ...currentForm,
      attachments: [...currentForm.attachments, attachment],
    }));
  }

  function handleRemoveAttachment(
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) {
    setForm((currentForm) => ({
      ...currentForm,
      attachments: currentForm.attachments.filter((item) =>
        "id" in attachment
          ? !("id" in item && item.id === attachment.id)
          : !("token" in item && item.token === attachment.token),
      ),
    }));
  }

  async function handlePreviewAttachment(
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) {
    try {
      const preview = await previewIssueAttachment(
        "id" in attachment
          ? {
              projectId,
              attachmentId: attachment.id,
            }
          : {
              projectId,
              sourcePath: attachment.sourcePath,
              displayName: attachment.displayName,
            },
      );
      setAttachmentPreview(toAttachmentPreviewState(preview));
    } catch (error) {
      setDialogErrorMessage(toCommandError(error).message);
    }
  }

  async function handleDownloadAttachment(
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) {
    const targetPath = await save({
      defaultPath: attachment.displayName,
      title: `Save ${attachment.displayName}`,
    });

    if (typeof targetPath !== "string") {
      return;
    }

    try {
      await exportIssueAttachment(
        "id" in attachment
          ? {
              projectId,
              attachmentId: attachment.id,
              targetPath,
            }
          : {
              projectId,
              sourcePath: attachment.sourcePath,
              displayName: attachment.displayName,
              targetPath,
            },
      );
    } catch (error) {
      setDialogErrorMessage(toCommandError(error).message);
    }
  }

  async function handleAdvanceStatus(targetStatus: IssueStatus) {
    if (!selectedIssue || isSaving) {
      return;
    }

    if (targetStatus === selectedIssue.status) {
      return;
    }

    if (
      targetStatus === "completed" &&
      selectedIssue.linkedSessionStatus === "running" &&
      selectedIssue.linkedSessionLatestOutput?.trim()
    ) {
      const isConfirmed = window.confirm("session 未结束，确认要完成吗？");
      if (!isConfirmed) {
        return;
      }
    }

    setDialogErrorMessage(null);
    setIsSaving(true);
    const requestProjectId = projectId;
    const currentIssue = selectedIssue;

    try {
      let updatedIssue: IssueRecord;

      if (
        targetStatus === "review" &&
        currentIssue.status === "running" &&
        currentIssue.linkedSessionStatus === "running"
      ) {
        updatedIssue = await markIssueReview({
          projectId: requestProjectId,
          issueId: currentIssue.id,
        });
      } else if (
        targetStatus === "completed" &&
        currentIssue.status === "running" &&
        currentIssue.linkedSessionStatus === "running"
      ) {
        const reviewedIssue = await markIssueReview({
          projectId: requestProjectId,
          issueId: currentIssue.id,
        });
        if (activeProjectIdRef.current !== requestProjectId) {
          return;
        }
        setIssues((currentIssues) => mergeIssue(currentIssues, reviewedIssue));
        setSelectedIssueId(reviewedIssue.id);
        setForm(issueToForm(reviewedIssue));
        updatedIssue = await completeIssueManual({
          projectId: requestProjectId,
          issueId: currentIssue.id,
        });
      } else if (
        targetStatus === "completed" &&
        currentIssue.status === "review" &&
        currentIssue.linkedSessionStatus === "running"
      ) {
        updatedIssue = await completeIssueManual({
          projectId: requestProjectId,
          issueId: currentIssue.id,
        });
      } else {
        updatedIssue = await advanceIssueStatus({
          projectId: requestProjectId,
          issueId: currentIssue.id,
          targetStatus,
        });
      }

      if (activeProjectIdRef.current !== requestProjectId) {
        return;
      }

      setIssues((currentIssues) => mergeIssue(currentIssues, updatedIssue));
      setSelectedIssueId(updatedIssue.id);
      setForm(issueToForm(updatedIssue));
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

  async function handleDeleteIssue() {
    if (!selectedIssue || isSaving) {
      return;
    }

    const isConfirmed = window.confirm("确认删除这个 issue 吗？");
    if (!isConfirmed) {
      return;
    }

    setDialogErrorMessage(null);
    setIsSaving(true);
    const requestProjectId = projectId;
    const issueToDelete = selectedIssue;

    try {
      await deleteIssue({
        projectId: requestProjectId,
        issueId: issueToDelete.id,
      });

      if (activeProjectIdRef.current !== requestProjectId) {
        return;
      }

      const remainingIssues = issues.filter((issue) => issue.id !== issueToDelete.id);
      setIssues(remainingIssues);
      setSelectedIssueId(remainingIssues[0]?.id ?? null);
      setDialogMode(null);
      setRunDialogIssue(null);
      setSummaryIssueId(null);
      setAttachmentPreview(null);
      setForm(EMPTY_FORM);
      restoreDialogTriggerFocus(remainingIssues[0] ?? null);
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

  return (
    <main className="activity-surface activity-surface--issues">
      <div className="issues-header">
        <h2>{messages.issues.title}</h2>
      </div>
      {errorMessage ? (
        <p className="issues-status" role="status" aria-label="Issues status">
          {errorMessage}
        </p>
      ) : null}
      <IssuesKanban
        isLoading={isLoading}
        lanes={lanes}
        selectedIssueId={selectedIssueId}
        cardRefs={cardRefs}
        createButtonRef={createButtonRef}
        canRunIssue={canRunIssueFor}
        formatTimestamp={formatLocalTimestamp}
        toDescriptionExcerpt={markdownToExcerpt}
        onCreateIssue={openCreateDialog}
        onOpenIssue={openIssueDialog}
        onRunIssue={openRunDialog}
      />

      {dialogMode ? (
        <IssueFormDialog
          mode={dialogMode}
          form={form}
          selectedIssue={selectedIssue}
          isSaving={isSaving}
          canDismissWithoutCloseButton={canDismissWithoutCloseButton}
          errorMessage={dialogErrorMessage}
          hasLinkedSession={hasLinkedSession}
          isBacklogDialog={isBacklogDialog}
          canViewSummary={canViewSummary}
          titleInputRef={titleInputRef}
          dialogFormRef={dialogFormRef}
          closeButtonRef={closeButtonRef}
          saveButtonRef={saveButtonRef}
          canOpenAgentsActivity={canOpenLinkedSession}
          onClose={closeDialog}
          onSubmit={handleSubmit}
          onKeyDown={handleDialogKeyDown}
          onFormChange={setForm}
          onSelectAttachment={() => void handleSelectAttachment()}
          onPreviewAttachment={(attachment) =>
            void handlePreviewAttachment(attachment)
          }
          onDownloadAttachment={(attachment) =>
            void handleDownloadAttachment(attachment)
          }
          onRemoveAttachment={handleRemoveAttachment}
          onAdvanceStatus={(targetStatus) => void handleAdvanceStatus(targetStatus)}
          onDeleteIssue={() => void handleDeleteIssue()}
          onOpenLinkedSession={openLinkedSession}
          onOpenSummary={handleOpenSummary}
        />
      ) : null}

      {runDialogIssue ? (
        <IssueRunDialog
          issue={runDialogIssue}
          projectId={projectId}
          onClose={closeRunDialog}
          onStarted={handleRunStarted}
        />
      ) : null}
      {summaryIssueId != null ? (
        <IssueSummaryDialog
          issueId={summaryIssueId}
          projectId={projectId}
          onClose={() => setSummaryIssueId(null)}
        />
      ) : null}
      {attachmentPreview ? (
        <IssueAttachmentPreviewDialog
          preview={attachmentPreview}
          onClose={() => setAttachmentPreview(null)}
        />
      ) : null}
    </main>
  );
}

function issueToForm(issue: IssueRecord): IssueFormState {
  const parsed = parseIssueDescription(
    issue.description,
    issue.attachments ?? [],
  );
  return {
    title: issue.title,
    description: parsed.description,
    attachments: parsed.attachments,
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
    .replace(/^\s*\{\{issue-attachment(?:-temp)?:[^}]+\}\}\s*$/gm, "")
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

function buildIssueDescription(
  description: string,
  attachments: Array<IssueAttachmentRecord | IssueAttachmentDraft>,
): string {
  const trimmedDescription = description.trimEnd();
  const attachmentTokens = attachments.map((attachment) =>
    "id" in attachment
      ? `{{issue-attachment:${attachment.id}}}`
      : `{{issue-attachment-temp:${attachment.token}}}`,
  );

  return [trimmedDescription, ...attachmentTokens]
    .filter((value) => value.length > 0)
    .join("\n\n");
}

function serializeAttachments(
  attachments: Array<IssueAttachmentRecord | IssueAttachmentDraft>,
): Array<{
  attachmentId?: number | null;
  tempToken?: string | null;
  sourcePath?: string | null;
  displayName: string;
  mimeType?: string | null;
}> {
  return attachments.map((attachment) =>
    "id" in attachment
      ? {
          attachmentId: attachment.id,
          displayName: attachment.displayName,
          mimeType: attachment.mimeType ?? null,
        }
      : {
          tempToken: attachment.token,
          sourcePath: attachment.sourcePath,
          displayName: attachment.displayName,
          mimeType: attachment.mimeType ?? null,
        },
  );
}

function parseIssueDescription(
  description: string,
  attachments: IssueAttachmentRecord[],
): {
  description: string;
  attachments: IssueAttachmentRecord[];
} {
  const tokenMatches = Array.from(
    description.matchAll(/\{\{issue-attachment:(\d+)\}\}/g),
  );
  const positionById = new Map<number, number>();
  tokenMatches.forEach((match, index) => {
    positionById.set(Number(match[1]), index);
  });

  const orderedAttachments = [...attachments].sort((left, right) => {
    const leftIndex = positionById.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = positionById.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });

  const visibleDescription = description
    .replace(/^\s*\{\{issue-attachment(?:-temp)?:[^}]+\}\}\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    description: visibleDescription,
    attachments: orderedAttachments,
  };
}

function buildDraftAttachment(sourcePath: string): IssueAttachmentDraft {
  const displayName = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
  const extension = displayName.split(".").pop()?.toLowerCase() ?? "";
  const kind = attachmentKindFromExtension(extension);
  return {
    token: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    displayName,
    sourcePath,
    kind,
    isPreviewable: isPreviewableAttachmentKind(kind),
    absolutePath: sourcePath,
  };
}

function attachmentKindFromExtension(
  extension: string,
): IssueAttachmentDraft["kind"] {
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) {
    return "image";
  }
  if (extension === "pdf") {
    return "pdf";
  }
  if (["doc", "docx"].includes(extension)) {
    return "word";
  }
  if (
    [
      "md",
      "json",
      "txt",
      "yaml",
      "yml",
      "ts",
      "tsx",
      "js",
      "jsx",
      "css",
      "html",
      "xml",
      "csv",
    ].includes(extension)
  ) {
    return "text";
  }
  return "generic";
}

function isPreviewableAttachmentKind(
  kind: IssueAttachmentDraft["kind"],
): boolean {
  return kind === "image" || kind === "text";
}

function canRunIssueFor(
  issue: Pick<IssueRecord, "status" | "linkedSessionId">,
): boolean {
  return issue.status === "backlog" && issue.linkedSessionId == null;
}

function toAttachmentPreviewState(
  preview: IssueAttachmentPreviewRecord,
): AttachmentPreviewState {
  return {
    displayName: preview.displayName,
    kind: preview.kind,
    textContent: preview.textContent,
    imageSrc: preview.absolutePath
      ? convertFileSrc(preview.absolutePath)
      : null,
  };
}

function hasUnsavedDialogChanges(
  dialogMode: DialogMode | null,
  form: IssueFormState,
  selectedIssue: IssueRecord | null,
): boolean {
  if (dialogMode === null) {
    return false;
  }

  const baseline =
    dialogMode === "edit" && selectedIssue ? issueToForm(selectedIssue) : EMPTY_FORM;

  return (
    form.title !== baseline.title ||
    form.description !== baseline.description ||
    !haveSameAttachments(form.attachments, baseline.attachments)
  );
}

function haveSameAttachments(
  left: Array<IssueAttachmentRecord | IssueAttachmentDraft>,
  right: Array<IssueAttachmentRecord | IssueAttachmentDraft>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (attachment, index) =>
      getAttachmentIdentity(attachment) ===
      getAttachmentIdentity(right[index]),
  );
}

function getAttachmentIdentity(
  attachment: IssueAttachmentRecord | IssueAttachmentDraft,
): string {
  if ("id" in attachment) {
    return `saved:${attachment.id}`;
  }

  return `draft:${attachment.token}`;
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
