import { convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  advanceIssueStatus,
  completeIssueManual,
  createIssue,
  deleteIssue,
  detectAgentCommitCompletion,
  exportIssueAttachment,
  listIssues,
  markIssueReview,
  prepareAgentCommitCompletion,
  previewIssueAttachment,
  sendAgentCommitPrompt,
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
import { IssueEditablePage, IssueReadOnlyPage } from "./issue-form-dialog";
import { IssuesKanban } from "./issues-kanban";
import { IssueRunDialog } from "./issue-run-dialog";
import { IssueSummaryDialog } from "./issue-summary-dialog";
import type { IssueAttachmentDraft } from "./issue-description-editor";
import { issuePageStateCache } from "./issues-activity-cache";
import { injectAgentSessionPrompt } from "../agents/agent-session-commands";
import {
  listProjectLabels,
  type ProjectLabelRecord,
} from "../settings/settings-commands";
import { toCommandError } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import type { ProjectCompletionPolicy } from "../project/project-commands";

interface IssuesActivityProps {
  projectCompletionPolicy: ProjectCompletionPolicy;
  projectId: number;
  onOpenAgentsActivity?: (sessionId: number) => void;
  onOpenProjectSettingsLabels?: () => void;
  requestedIssueId?: number | null;
  worktreeSetupCommand?: string;
}

export function IssuesActivity({
  projectCompletionPolicy,
  projectId,
  onOpenAgentsActivity,
  onOpenProjectSettingsLabels,
  requestedIssueId = null,
  worktreeSetupCommand = "",
}: IssuesActivityProps) {
  const { locale, messages } = useI18n();
  const cachedPageState = issuePageStateCache.get(projectId) ?? null;
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(
    cachedPageState?.selectedIssueId ?? requestedIssueId,
  );
  const [dialogMode, setDialogMode] = useState<DialogMode | null>(
    cachedPageState?.dialogMode ?? null,
  );
  const [runDialogIssue, setRunDialogIssue] = useState<Pick<
    IssueRecord,
    "id" | "title" | "description" | "attachments"
  > | null>(null);
  const [summaryIssueId, setSummaryIssueId] = useState<number | null>(null);
  const [attachmentPreview, setAttachmentPreview] =
    useState<AttachmentPreviewState | null>(null);
  const [form, setForm] = useState<IssueFormState>(
    cachedPageState?.form ?? EMPTY_FORM,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dialogErrorMessage, setDialogErrorMessage] = useState<string | null>(
    null,
  );
  const [completionProgress, setCompletionProgress] =
    useState<CompletionProgressState | null>(null);
  const [availableLabels, setAvailableLabels] = useState<ProjectLabelRecord[]>(
    [],
  );
  const [labelsProjectId, setLabelsProjectId] = useState(projectId);
  const [labelsLoadState, setLabelsLoadState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [labelsErrorMessage, setLabelsErrorMessage] = useState<string | null>(
    null,
  );
  const activeProjectIdRef = useRef(projectId);
  const previousSelectedIssueIdRef = useRef<number | null>(
    cachedPageState?.previousSelectedIssueId ?? null,
  );
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const cardRefs = useRef(new Map<number, HTMLButtonElement>());
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const runDialogTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    activeProjectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    if (!dialogMode) {
      issuePageStateCache.delete(projectId);
      return;
    }

    issuePageStateCache.set(projectId, {
      dialogMode,
      form,
      previousSelectedIssueId: previousSelectedIssueIdRef.current,
      selectedIssueId,
    });
  }, [dialogMode, form, projectId, selectedIssueId]);

  useEffect(() => {
    let isMounted = true;

    async function loadIssues() {
      const cachedState = issuePageStateCache.get(projectId) ?? null;
      setIsLoading(true);
      setErrorMessage(null);
      setIssues([]);
      setSelectedIssueId(cachedState?.selectedIssueId ?? null);
      setDialogMode(cachedState?.dialogMode ?? null);
      setRunDialogIssue(null);
      setForm(cachedState?.form ?? EMPTY_FORM);
      previousSelectedIssueIdRef.current =
        cachedState?.previousSelectedIssueId ?? null;
      setIsSaving(false);
      setDialogErrorMessage(null);
      setCompletionProgress(null);

      try {
        const response = await listIssues({ projectId });
        if (!isMounted || activeProjectIdRef.current !== projectId) {
          return;
        }

        const nextCachedState = issuePageStateCache.get(projectId) ?? null;
        const cachedIssueExists =
          nextCachedState?.dialogMode === "create" ||
          response.issues.some(
            (issue) => issue.id === nextCachedState?.selectedIssueId,
          );

        setIssues(response.issues);
        if (nextCachedState && cachedIssueExists) {
          setSelectedIssueId(nextCachedState.selectedIssueId);
          setDialogMode(nextCachedState.dialogMode);
          setForm(nextCachedState.form);
          previousSelectedIssueIdRef.current =
            nextCachedState.previousSelectedIssueId;
        } else {
          issuePageStateCache.delete(projectId);
          setSelectedIssueId(
            response.issues.find((issue) => issue.id === requestedIssueId)
              ?.id ??
              response.issues[0]?.id ??
              null,
          );
          setDialogMode(null);
          setForm(EMPTY_FORM);
          previousSelectedIssueIdRef.current = null;
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
  }, [projectId, requestedIssueId]);

  useEffect(() => {
    let isMounted = true;

    void Promise.all([
      listProjectLabels({ scope: "project", projectId }),
      listProjectLabels({ scope: "global", projectId: null }),
    ])
      .then(([projectResponse, globalResponse]) => {
        if (!isMounted || activeProjectIdRef.current !== projectId) {
          return;
        }

        setAvailableLabels(
          [...projectResponse.labels, ...globalResponse.labels].sort(
            (left, right) => {
              if (left.scope !== right.scope) {
                return left.scope === "project" ? -1 : 1;
              }

              return left.name.localeCompare(right.name);
            },
          ),
        );
        setLabelsProjectId(projectId);
        setLabelsErrorMessage(null);
        setLabelsLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!isMounted || activeProjectIdRef.current !== projectId) {
          return;
        }

        setAvailableLabels([]);
        setLabelsProjectId(projectId);
        setLabelsErrorMessage(toCommandError(error).message);
        setLabelsLoadState("error");
      });

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  const currentAvailableLabels =
    labelsProjectId === projectId ? availableLabels : [];
  const currentLabelsErrorMessage =
    labelsProjectId === projectId ? labelsErrorMessage : null;
  const isLoadingLabels =
    labelsProjectId !== projectId || labelsLoadState === "loading";

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
    }
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
    setCompletionProgress(null);
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
          description: buildIssueDescription(form.description),
          attachments: serializeAttachments(form.attachments),
          labelIds: form.labelIds,
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
          description: buildIssueDescription(form.description),
          attachments: serializeAttachments(form.attachments),
          labelIds: form.labelIds,
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
        if (error instanceof CompletionCancelledError) {
          setDialogErrorMessage(null);
        } else {
          setDialogErrorMessage(toCommandError(error).message);
        }
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
    let resolvedSessionId = result.sessionId ?? null;

    try {
      const response = await listIssues({ projectId });
      if (activeProjectIdRef.current !== projectId) {
        return;
      }

      setIssues(response.issues);
      setSelectedIssueId(result.issueId);
      if (resolvedSessionId == null) {
        resolvedSessionId =
          response.issues.find((issue) => issue.id === result.issueId)
            ?.linkedSessionId ?? null;
      }
    } catch (error) {
      if (activeProjectIdRef.current === projectId) {
        setErrorMessage(toCommandError(error).message);
      }
    } finally {
      if (
        activeProjectIdRef.current === projectId &&
        resolvedSessionId != null
      ) {
        onOpenAgentsActivity?.(resolvedSessionId);
      } else if (
        activeProjectIdRef.current === projectId &&
        result.sessionId == null
      ) {
        setErrorMessage("Agent Session 启动后未返回可打开的会话。");
      }
    }
  }

  const isBacklogDialog =
    dialogMode === "create" || selectedIssue?.status === "backlog";
  const hasLinkedSession = selectedIssue?.linkedSessionId != null;
  const canViewSummary =
    dialogMode === "edit" && selectedIssue?.status === "completed";
  const canOpenLinkedSession =
    hasLinkedSession && Boolean(onOpenAgentsActivity);

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
        updatedIssue = await completeIssueWithCompletionChecks(
          requestProjectId,
          currentIssue.id,
        );
      } else if (
        targetStatus === "completed" &&
        currentIssue.status === "review" &&
        currentIssue.linkedSessionStatus === "running"
      ) {
        updatedIssue = await completeIssueWithCompletionChecks(
          requestProjectId,
          currentIssue.id,
        );
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
      setCompletionProgress(null);
    } catch (error) {
      if (activeProjectIdRef.current === requestProjectId) {
        if (error instanceof CompletionCancelledError) {
          setDialogErrorMessage(null);
        } else if (error instanceof WorktreeMergeConflictError) {
          await handOffWorktreeMergeConflict(
            requestProjectId,
            currentIssue,
            error.detail,
          );
        } else {
          setCompletionProgress(null);
          setDialogErrorMessage(toCommandError(error).message);
        }
      }
    } finally {
      if (activeProjectIdRef.current === requestProjectId) {
        setIsSaving(false);
      }
    }
  }

  async function completeIssueWithCompletionChecks(
    requestProjectId: number,
    issueId: number,
  ): Promise<IssueRecord> {
    try {
      setCompletionProgress({
        title: getCompletionProgressTitle(locale),
        steps: buildCompletionProgressSteps(locale, "checking_commit"),
      });
      await prepareAgentCommitCompletion({
        projectId: requestProjectId,
        issueId,
      });
    } catch (error) {
      const commandError = toCommandError(error);
      if (isManualCompletionPolicyError(commandError)) {
        throw Object.assign(
          new Error("当前项目中有未提交的代码，请提交后再标记完成。"),
          { cause: error },
        );
      }

      if (!isCleanGitStatusError(commandError)) {
        throw error;
      }

      const cleanGitDetail = getCleanGitStatusDetail(commandError);
      const isConfirmed = window.confirm(
        buildCompletionConfirmMessage(cleanGitDetail.targetBranch),
      );
      if (!isConfirmed) {
        setCompletionProgress(null);
        throw new CompletionCancelledError();
      }

      setCompletionProgress({
        title: getCompletionProgressTitle(locale),
        steps: buildCompletionProgressSteps(locale, "merging"),
      });

      try {
        const issue = await completeIssueManual({
          projectId: requestProjectId,
          issueId,
        });
        setCompletionProgress({
          title: getCompletionProgressTitle(locale),
          steps: buildCompletionProgressSteps(locale, "completed"),
        });
        return issue;
      } catch (completeError) {
        const conflictDetail = getWorktreeMergeDetail(
          toCommandError(completeError),
        );
        if (conflictDetail) {
          setCompletionProgress(null);
          throw new WorktreeMergeConflictError(conflictDetail);
        }

        throw completeError;
      }
    }

    setCompletionProgress({
      title: getCompletionProgressTitle(locale),
      steps: buildCompletionProgressSteps(locale, "requesting_commit"),
    });
    await sendAgentCommitPrompt({
      projectId: requestProjectId,
      issueId,
    });
    setCompletionProgress({
      title: getCompletionProgressTitle(locale),
      steps: buildCompletionProgressSteps(locale, "waiting_commit"),
    });
    let result: Awaited<ReturnType<typeof detectAgentCommitCompletion>>;
    try {
      result = await detectAgentCommitCompletion({
        projectId: requestProjectId,
        issueId,
      });
    } catch (detectError) {
      const conflictDetail = getWorktreeMergeDetail(
        toCommandError(detectError),
      );
      if (conflictDetail) {
        setCompletionProgress(null);
        throw new WorktreeMergeConflictError(conflictDetail);
      }

      throw detectError;
    }

    if (result.outcome !== "completed") {
      throw new Error(result.message);
    }

    setCompletionProgress({
      title: getCompletionProgressTitle(locale),
      steps: buildCompletionProgressSteps(locale, "completed"),
    });
    return result.issue;
  }

  async function handOffWorktreeMergeConflict(
    requestProjectId: number,
    issue: IssueRecord,
    detail: WorktreeMergeDetail,
  ) {
    const sessionId = detail.sessionId ?? issue.linkedSessionId;
    if (sessionId == null) {
      setDialogErrorMessage(
        locale === "zh"
          ? "代码合并存在冲突，但未找到可接管的 Agent Session。"
          : "Merge conflict detected, but no agent session is available.",
      );
      return;
    }

    const prompt = buildWorktreeMergeConflictPrompt(detail, locale);
    await injectAgentSessionPrompt({
      projectId: requestProjectId,
      sessionId,
      prompt,
      kind: "follow_up",
    });

    if (activeProjectIdRef.current !== requestProjectId) {
      return;
    }

    setDialogErrorMessage(null);
    setDialogMode(null);
    setForm(EMPTY_FORM);
    onOpenAgentsActivity?.(sessionId);
  }

  async function handleDeleteIssue() {
    if (!selectedIssue || isSaving) {
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

      const remainingIssues = issues.filter(
        (issue) => issue.id !== issueToDelete.id,
      );
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

      {dialogMode && isBacklogDialog ? (
        <IssueEditablePage
          mode={dialogMode}
          form={form}
          selectedIssue={selectedIssue}
          isSaving={isSaving}
          errorMessage={dialogErrorMessage}
          availableLabels={currentAvailableLabels}
          isLoadingLabels={isLoadingLabels}
          labelsErrorMessage={currentLabelsErrorMessage}
          titleInputRef={titleInputRef}
          onCancel={closeDialog}
          onSubmit={handleSubmit}
          onFormChange={setForm}
          onSelectAttachment={() => void handleSelectAttachment()}
          onPreviewAttachment={(attachment) =>
            void handlePreviewAttachment(attachment)
          }
          onDownloadAttachment={(attachment) =>
            void handleDownloadAttachment(attachment)
          }
          onRemoveAttachment={handleRemoveAttachment}
          onDeleteIssue={() => void handleDeleteIssue()}
          onOpenProjectLabelsSettings={() => {
            onOpenProjectSettingsLabels?.();
          }}
        />
      ) : null}

      {dialogMode && !isBacklogDialog ? (
        <IssueReadOnlyPage
          form={form}
          selectedIssue={selectedIssue}
          isSaving={isSaving}
          errorMessage={dialogErrorMessage}
          hasLinkedSession={hasLinkedSession}
          canViewSummary={canViewSummary}
          canOpenAgentsActivity={canOpenLinkedSession}
          onBack={closeDialog}
          onPreviewAttachment={(attachment) =>
            void handlePreviewAttachment(attachment)
          }
          onDownloadAttachment={(attachment) =>
            void handleDownloadAttachment(attachment)
          }
          onAdvanceStatus={(targetStatus) =>
            void handleAdvanceStatus(targetStatus)
          }
          onDeleteIssue={() => void handleDeleteIssue()}
          onOpenLinkedSession={openLinkedSession}
          onOpenSummary={handleOpenSummary}
        />
      ) : null}

      {runDialogIssue ? (
        <IssueRunDialog
          issue={runDialogIssue}
          projectCompletionPolicy={projectCompletionPolicy}
          projectId={projectId}
          worktreeSetupCommand={worktreeSetupCommand}
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
      {completionProgress ? (
        <IssueCompletionProgressDialog progress={completionProgress} />
      ) : null}
    </main>
  );
}

type CompletionProgressStepId =
  | "checking_commit"
  | "requesting_commit"
  | "waiting_commit"
  | "checking_worktree"
  | "merging"
  | "cleaning"
  | "completed";

interface CompletionProgressStep {
  id: CompletionProgressStepId;
  label: string;
  status: "pending" | "active" | "done";
}

interface CompletionProgressState {
  title: string;
  steps: CompletionProgressStep[];
}

class CompletionCancelledError extends Error {
  constructor() {
    super("completion cancelled");
  }
}

class WorktreeMergeConflictError extends Error {
  constructor(readonly detail: WorktreeMergeDetail) {
    super("worktree merge conflict");
  }
}

interface WorktreeMergeDetail {
  sessionId?: number | null;
  targetBranch?: string;
  workspaceBranch?: string;
  workspacePath?: string;
}

function isManualCompletionPolicyError(error: {
  details?: unknown[];
}): boolean {
  return hasDetailValue(
    error,
    "CompletionPolicy",
    "completionPolicy",
    "manual",
  );
}

function isCleanGitStatusError(error: { details?: unknown[] }): boolean {
  return hasDetailValue(error, "GitStatus", "isClean", true);
}

function getCleanGitStatusDetail(error: { details?: unknown[] }): {
  targetBranch?: string;
} {
  const detail = (error.details ?? []).find((item) => {
    return (
      !!item &&
      typeof item === "object" &&
      (item as Record<string, unknown>)["@type"] === "GitStatus" &&
      (item as Record<string, unknown>).isClean === true
    );
  });

  if (!detail || typeof detail !== "object") {
    return {};
  }

  const values = detail as Record<string, unknown>;
  return {
    targetBranch:
      typeof values.targetBranch === "string" ? values.targetBranch : undefined,
  };
}

function hasDetailValue(
  error: { details?: unknown[] },
  type: string,
  key: string,
  expectedValue: unknown,
): boolean {
  return (error.details ?? []).some((detail) => {
    if (!detail || typeof detail !== "object") {
      return false;
    }

    const values = detail as Record<string, unknown>;
    return values["@type"] === type && values[key] === expectedValue;
  });
}

function buildCompletionConfirmMessage(targetBranch?: string): string {
  if (!targetBranch) {
    return "即将完成当前 issue，并在需要时把临时分支合入记录的目标分支。确认继续吗？";
  }

  if (targetBranch === "main" || targetBranch === "master") {
    return `即将完成当前 issue，并把临时分支合入高风险目标分支 ${targetBranch}。确认继续吗？`;
  }

  return `即将完成当前 issue，并把临时分支合入目标分支 ${targetBranch}。确认继续吗？`;
}

function getWorktreeMergeDetail(error: {
  details?: unknown[];
}): WorktreeMergeDetail | null {
  const detail = (error.details ?? []).find((item) => {
    return (
      !!item &&
      typeof item === "object" &&
      (item as Record<string, unknown>)["@type"] === "WorktreeMerge"
    );
  });

  if (!detail || typeof detail !== "object") {
    return null;
  }

  const values = detail as Record<string, unknown>;
  return {
    sessionId:
      typeof values.sessionId === "number" ? values.sessionId : undefined,
    targetBranch:
      typeof values.targetBranch === "string" ? values.targetBranch : undefined,
    workspaceBranch:
      typeof values.workspaceBranch === "string"
        ? values.workspaceBranch
        : undefined,
    workspacePath:
      typeof values.workspacePath === "string"
        ? values.workspacePath
        : undefined,
  };
}

function getCompletionProgressTitle(locale: string): string {
  return locale === "zh" ? "完成 issue" : "Complete issue";
}

function buildCompletionProgressSteps(
  locale: string,
  activeStep: CompletionProgressStepId,
): CompletionProgressStep[] {
  const labels =
    locale === "zh"
      ? {
          checking_commit: "检查未提交改动",
          requesting_commit: "请求 Agent 提交相关代码",
          waiting_commit: "等待并检测新 commit",
          checking_worktree: "检查 worktree 是否存在",
          merging: "合并临时分支到目标分支",
          cleaning: "清理 worktree 与临时分支",
          completed: "完成",
        }
      : {
          checking_commit: "Check uncommitted changes",
          requesting_commit: "Ask agent to commit related code",
          waiting_commit: "Wait for and detect a new commit",
          checking_worktree: "Check whether the worktree still exists",
          merging: "Merge temporary branch into target branch",
          cleaning: "Clean up worktree and temporary branch",
          completed: "Done",
        };
  const ids: CompletionProgressStepId[] = [
    "checking_commit",
    "requesting_commit",
    "waiting_commit",
    "checking_worktree",
    "merging",
    "cleaning",
    "completed",
  ];
  const activeIndex = ids.indexOf(activeStep);

  return ids.map((id, index) => ({
    id,
    label: labels[id],
    status:
      index < activeIndex
        ? "done"
        : index === activeIndex
          ? "active"
          : "pending",
  }));
}

function buildWorktreeMergeConflictPrompt(
  detail: WorktreeMergeDetail,
  locale: string,
): string {
  const targetBranch = detail.targetBranch || "target branch";
  const workspaceBranch = detail.workspaceBranch || "temporary issue branch";
  const workspacePath = detail.workspacePath || "current worktree";

  if (locale === "zh") {
    return [
      "代码合并存在冲突，需要你接管处理。",
      `请解决临时分支 ${workspaceBranch} 合并到最初记录的目标分支 ${targetBranch} 时产生的冲突。`,
      `相关 worktree：${workspacePath}`,
      "解决冲突后，请完成合并并确保代码最终合入目标分支。",
    ].join("\n");
  }

  return [
    "A merge conflict was detected and needs your help.",
    `Please resolve the conflicts from merging ${workspaceBranch} into the originally recorded target branch ${targetBranch}.`,
    `Related worktree: ${workspacePath}`,
    "After resolving conflicts, complete the merge and make sure the code lands on the target branch.",
  ].join("\n");
}

function IssueCompletionProgressDialog({
  progress,
}: {
  progress: CompletionProgressState;
}) {
  return (
    <div className="issue-dialog-overlay">
      <div
        aria-label={progress.title}
        aria-modal="true"
        className="issue-dialog issue-dialog--progress"
        role="dialog"
      >
        <div className="issue-dialog__header">
          <h3>{progress.title}</h3>
        </div>
        <div className="issue-dialog__body issue-dialog__body--single">
          <ol className="issue-completion-progress" role="status">
            {progress.steps.map((step) => (
              <li
                className={`issue-completion-progress__step issue-completion-progress__step--${step.status}`}
                key={step.id}
              >
                <span className="issue-completion-progress__marker" />
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
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
    labelIds: (issue.labels ?? []).map((label) => label.id),
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

function buildIssueDescription(description: string): string {
  return description.trimEnd();
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
