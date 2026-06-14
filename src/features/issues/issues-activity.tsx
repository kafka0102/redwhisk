import { convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createIssue,
  exportIssueAttachment,
  listIssues,
  previewIssueAttachment,
  updateIssue,
  type AgentSessionStatus,
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
import { listAgentProfiles } from "../settings/settings-commands";
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
  const [isOpeningLog, setIsOpeningLog] = useState(false);
  const [isLoadingAgentProfiles, setIsLoadingAgentProfiles] = useState(true);
  const [agentProfileCount, setAgentProfileCount] = useState(0);
  const [agentProfileErrorMessage, setAgentProfileErrorMessage] = useState<
    string | null
  >(null);
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
  const runButtonRef = useRef<HTMLButtonElement | null>(null);
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

  useEffect(() => {
    let isMounted = true;

    async function loadAgentProfiles() {
      setIsLoadingAgentProfiles(true);
      setAgentProfileErrorMessage(null);
      setAgentProfileCount(0);

      try {
        const [projectResponse, globalResponse] = await Promise.all([
          listAgentProfiles({ scope: "project", projectId }),
          listAgentProfiles({ scope: "global", projectId: null }),
        ]);

        if (!isMounted || activeProjectIdRef.current !== projectId) {
          return;
        }

        setAgentProfileCount(
          projectResponse.profiles.length + globalResponse.profiles.length,
        );
      } catch (error) {
        if (isMounted && activeProjectIdRef.current === projectId) {
          setAgentProfileErrorMessage(toCommandError(error).message);
        }
      } finally {
        if (isMounted && activeProjectIdRef.current === projectId) {
          setIsLoadingAgentProfiles(false);
        }
      }
    }

    void loadAgentProfiles();

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
    setIsOpeningLog(false);
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

  async function handleOpenLog() {
    if (!selectedIssue || isOpeningLog) {
      return;
    }

    setDialogErrorMessage(null);

    if (!selectedIssue.linkedSessionLogPath) {
      setDialogErrorMessage("No log path recorded for this session.");
      return;
    }

    setIsOpeningLog(true);

    try {
      await openPath(selectedIssue.linkedSessionLogPath);
    } catch (error) {
      setDialogErrorMessage(toCommandError(error).message);
    } finally {
      setIsOpeningLog(false);
    }
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
  const canRunSelectedIssue =
    selectedIssue != null &&
    canRunIssueFor(selectedIssue) &&
    agentProfileCount > 0 &&
    !isLoadingAgentProfiles;
  const canOpenSession =
    hasLinkedSession &&
    selectedIssue?.status !== "completed" &&
    selectedIssue?.linkedSessionStatus === "running";
  const canOpenLog =
    hasLinkedSession &&
    (selectedIssue?.status === "completed" ||
      selectedIssue?.linkedSessionStatus === "crashed" ||
      selectedIssue?.linkedSessionStatus === "stopped");
  const canViewSummary =
    dialogMode === "edit" && selectedIssue?.status === "completed";
  const runStatusMessage = agentProfileErrorMessage;

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
          isOpeningLog={isOpeningLog}
          errorMessage={dialogErrorMessage}
          hasLinkedSession={hasLinkedSession}
          isBacklogDialog={isBacklogDialog}
          canOpenSession={canOpenSession}
          canOpenLog={canOpenLog}
          canViewSummary={canViewSummary}
          canRunSelectedIssue={canRunSelectedIssue}
          runStatusMessage={runStatusMessage}
          titleInputRef={titleInputRef}
          dialogFormRef={dialogFormRef}
          closeButtonRef={closeButtonRef}
          cancelButtonRef={cancelButtonRef}
          runButtonRef={runButtonRef}
          saveButtonRef={saveButtonRef}
          canOpenAgentsActivity={Boolean(onOpenAgentsActivity)}
          canRunIssue={canRunIssueFor}
          buildDescription={buildIssueDescription}
          formatSessionStatus={formatAgentSessionStatus}
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
          onOpenLinkedSession={openLinkedSession}
          onOpenLog={() => void handleOpenLog()}
          onOpenSummary={handleOpenSummary}
          onRunIssue={openRunDialog}
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
