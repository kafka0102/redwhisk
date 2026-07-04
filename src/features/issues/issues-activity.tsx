import { convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  advanceIssueStatus,
  completeIssueFlow,
  detectAgentCommitCompletion,
  createIssue,
  deleteIssue,
  deleteIssueWorktree,
  exportIssueAttachment,
  getIssueWorktreeStatus,
  listIssues,
  markIssueReview,
  previewIssueAttachment,
  saveIssueAttachmentDraft,
  updateIssue,
  type CompleteIssueFlowResult,
  type DirtyWorkspaceOption,
  type IssueStatus,
  type IssueAttachmentRecord,
  type IssueAttachmentPreviewRecord,
  type IssueRecord,
} from "./issue-commands";
import { IssueAttachmentPreviewDialog } from "./issue-attachment-preview-dialog";
import { IssueCompletionDirtyWorkspaceDialog } from "./issue-completion-dirty-workspace-dialog";
import {
  EMPTY_FORM,
  type AttachmentPreviewState,
  type DialogMode,
  type IssueFormState,
} from "./issue-activity-types";
import { IssueEditablePage } from "./issue-editable-page";
import { IssueReadOnlyPage } from "./issue-read-only-page";
import { IssueSurfaceHeader } from "./issue-surface-header";
import { IssuesKanban } from "./issues-kanban";
import { IssueRunDialog } from "./issue-run-dialog";
import { IssueSummaryDialog } from "./issue-summary-dialog";
import { useAlertDialog } from "@/components/ui/use-alert-dialog";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import type { IssueAttachmentDraft } from "./issue-description-editor";
import { issuePageStateCache } from "./issues-activity-cache";
import { injectAgentSessionPrompt } from "../agents/agent-session-commands";
import {
  listProjectLabels,
  type ProjectLabelRecord,
} from "../settings/settings-commands";
import { toCommandError } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";

interface IssuesActivityProps {
  projectId: number;
  onOpenAgentsActivity?: (sessionId: number) => void;
  onOpenProjectSettingsLabels?: () => void;
  requestedIssueId?: number | null;
  worktreeSetupCommand?: string;
}

export function IssuesActivity({
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
  const [isReadOnlyEditRequested, setIsReadOnlyEditRequested] = useState(false);
  const [runDialogIssue, setRunDialogIssue] = useState<Pick<
    IssueRecord,
    "id" | "title" | "description" | "attachments" | "labels"
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
  const [dirtyWorkspaceDialog, setDirtyWorkspaceDialog] =
    useState<DirtyWorkspaceDialogState | null>(null);
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
  const dirtyWorkspaceDecisionRef = useRef<
    ((decision: DirtyWorkspaceOption, branchName: string | null) => void) | null
  >(null);
  const { confirm, confirmationDialog } = useConfirmDialog();
  const { alertDialog, showAlert } = useAlertDialog();

  const showCommandErrorAlert = (error: unknown) => {
    showAlert({ message: toCommandError(error).message, type: "error" });
  };

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
      setIsReadOnlyEditRequested(false);
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
    setIsReadOnlyEditRequested(false);
    previousSelectedIssueIdRef.current = selectedIssueId;
    dialogTriggerRef.current = trigger;
    setDialogMode("create");
    setForm(EMPTY_FORM);
  }

  function openIssueDialog(issue: IssueRecord, trigger: HTMLElement | null) {
    setErrorMessage(null);
    setDialogErrorMessage(null);
    setIsReadOnlyEditRequested(false);
    setSelectedIssueId(issue.id);
    dialogTriggerRef.current = trigger;
    setDialogMode("edit");
    setForm(issueToForm(issue));
  }

  function editSelectedIssue() {
    if (!selectedIssue || isSaving) {
      return;
    }

    setErrorMessage(null);
    setDialogErrorMessage(null);
    setIsReadOnlyEditRequested(true);
    setDialogMode("edit");
    setForm(issueToForm(selectedIssue));
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
    setIsReadOnlyEditRequested(false);
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
          labelIds: form.labelIds,
        });
        if (activeProjectIdRef.current !== requestProjectId) {
          return;
        }
        setIssues((currentIssues) => mergeIssue(currentIssues, createdIssue));
        setSelectedIssueId(createdIssue.id);
        setDialogMode(null);
        setIsReadOnlyEditRequested(false);
        setForm(EMPTY_FORM);
        restoreDialogTriggerFocus(createdIssue);
      } else if (selectedIssue) {
        const wasReadOnlyEdit = isReadOnlyEditRequested;
        const updatedIssue = await saveSelectedIssueDraft(
          requestProjectId,
          selectedIssue.id,
        );
        if (activeProjectIdRef.current !== requestProjectId) {
          return;
        }
        setIssues((currentIssues) => mergeIssue(currentIssues, updatedIssue));
        setSelectedIssueId(updatedIssue.id);
        setIsReadOnlyEditRequested(false);
        if (wasReadOnlyEdit) {
          // 从只读页发起的编辑：保存后回到该 Issue 的只读页，而非看板。
          setForm(issueToForm(updatedIssue));
        } else {
          setDialogMode(null);
          setForm(EMPTY_FORM);
          restoreDialogTriggerFocus(updatedIssue);
        }
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

  function saveSelectedIssueDraft(
    requestProjectId: number,
    issueId: number,
  ): Promise<IssueRecord> {
    return updateIssue({
      projectId: requestProjectId,
      issueId,
      title: form.title,
      description: buildIssueDescription(form.description, form.attachments),
      attachments: serializeAttachments(form.attachments),
      labelIds: form.labelIds,
    });
  }

  function restoreDialogTriggerFocus(fallbackIssue: IssueRecord | null) {
    requestAnimationFrame(() => {
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
    });
  }

  function openRunDialog(
    issue: Pick<
      IssueRecord,
      | "id"
      | "title"
      | "description"
      | "attachments"
      | "labels"
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

  async function confirmRunIssueFromEditPage(trigger: HTMLElement | null) {
    if (!selectedIssue || !canRunIssueFor(selectedIssue) || isSaving) {
      return;
    }

    const issueToRun = selectedIssue;
    const isConfirmed = await confirm({
      message: messages.issues.confirmRunIssue,
    });

    if (!isConfirmed) {
      return;
    }

    setDialogErrorMessage(null);
    setIsSaving(true);
    const requestProjectId = projectId;

    try {
      const updatedIssue = await saveSelectedIssueDraft(
        requestProjectId,
        issueToRun.id,
      );
      if (activeProjectIdRef.current !== requestProjectId) {
        return;
      }

      setIssues((currentIssues) => mergeIssue(currentIssues, updatedIssue));
      setSelectedIssueId(updatedIssue.id);
      setForm(issueToForm(updatedIssue));
      openRunDialog(updatedIssue, trigger);
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

  function openLinkedSession() {
    if (!selectedIssue?.linkedSessionId) {
      return;
    }

    setDialogErrorMessage(null);
    setRunDialogIssue(null);
    setDialogMode(null);
    setIsReadOnlyEditRequested(false);
    setForm(EMPTY_FORM);
    // 跳转到 session 页面会触发 IssuesActivity 卸载，依赖 dialogMode 变化的
    // 缓存清理 effect 不会执行，需在此同步清缓存，确保返回 issues 标签时回到
    // 看板而非只读 Issue 页。
    issuePageStateCache.delete(projectId);
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
    if (runDialogTriggerRef.current?.isConnected) {
      runDialogTriggerRef.current.focus();
    }
  }

  async function handleRunStarted(result: {
    issueId: number;
    sessionId?: number | null;
  }) {
    setRunDialogIssue(null);
    setDialogErrorMessage(null);
    setDialogMode(null);
    setIsReadOnlyEditRequested(false);
    setForm(EMPTY_FORM);
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
  const isEditablePageOpen = Boolean(
    dialogMode && (isBacklogDialog || isReadOnlyEditRequested),
  );

  async function handleSelectAttachment(
    filter?: "image" | "file",
  ): Promise<IssueAttachmentDraft | null> {
    const selectedPath = await open({
      directory: false,
      multiple: false,
      title:
        filter === "image"
          ? messages.richText.image
          : messages.issues.addAttachment,
      filters:
        filter === "image"
          ? [
              {
                name: messages.issues.imageFilterName,
                extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
              },
            ]
          : undefined,
    });

    if (typeof selectedPath !== "string") {
      return null;
    }

    try {
      const attachment = await buildDraftAttachment(selectedPath);
      setForm((currentForm) => ({
        ...currentForm,
        attachments: [...currentForm.attachments, attachment],
      }));
      return attachment;
    } catch (error) {
      setDialogErrorMessage(toCommandError(error).message);
      return null;
    }
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

    const currentIssue = selectedIssue;
    const isBackwardTransition =
      issueStatusRank(targetStatus) < issueStatusRank(currentIssue.status);

    if (
      targetStatus === "completed" &&
      currentIssue.linkedSessionStatus === "running"
    ) {
      const isConfirmed = await confirm({
        message: messages.issues.confirmCompleteWhileRunning,
      });
      if (!isConfirmed) {
        return;
      }
    } else if (isBackwardTransition) {
      const message =
        targetStatus === "backlog"
          ? currentIssue.linkedSessionStatus === "running"
            ? messages.issues.confirmTerminateAndReturnToBacklog
            : messages.issues.confirmReturnToBacklog
          : messages.issues.confirmMoveBackToStatus(
              getIssueStatusLabel(targetStatus, messages),
            );
      const isConfirmed = await confirm({ message });
      if (!isConfirmed) {
        return;
      }
    }

    // 退回 Backlog 时，若存在上次运行残留的同名 worktree，叠加询问是否删除。
    // CurrentBranch 模式无 worktree session，getIssueWorktreeStatus 会返回 exists=false，自然跳过。
    let shouldDeleteWorktree = false;
    if (targetStatus === "backlog") {
      try {
        const worktreeStatus = await getIssueWorktreeStatus({
          projectId,
          issueId: currentIssue.id,
        });
        if (worktreeStatus.exists && worktreeStatus.canDelete) {
          const deleteConfirmed = await confirm({
            title: messages.issues.worktreeConflictTitle,
            message: messages.issues.worktreeConflictMessage,
            confirmLabel: messages.issues.worktreeConflictDeleteLabel,
            cancelLabel: messages.issues.worktreeConflictKeepLabel,
            confirmVariant: "destructive",
          });
          shouldDeleteWorktree = deleteConfirmed;
        }
      } catch (error) {
        setDialogErrorMessage(toCommandError(error).message);
        return;
      }
    }

    setDialogErrorMessage(null);
    setIsSaving(true);
    const requestProjectId = projectId;

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
        currentIssue.linkedSessionId != null
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
        // 退回 Backlog 已成功（运行中 session 已由后端关闭），再删除残留 worktree。
        // 删除失败不阻断流程：状态已退回，仅提示用户手动清理。
        if (shouldDeleteWorktree) {
          try {
            await deleteIssueWorktree({
              projectId: requestProjectId,
              issueId: currentIssue.id,
            });
          } catch (error) {
            setDialogErrorMessage(toCommandError(error).message);
          }
        }
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
          showCommandErrorAlert(error);
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
    let dirtyDecision: DirtyWorkspaceOption | null = null;
    let branchName: string | null = null;
    let actualPath: string | null = null;
    let continueAfterCommit: boolean | null = null;
    let worktreeCleanupDecision: boolean | null = null;

    while (true) {
      setCompletionProgress({
        title: getCompletionProgressTitle(locale),
        steps: buildCompletionProgressSteps(locale, "checking_commit"),
      });

      const result = await completeIssueFlow({
        projectId: requestProjectId,
        issueId,
        dirtyDecision,
        branchName,
        actualPath,
        continueAfterCommit,
        worktreeCleanupDecision,
      });
      // 决策一次性消费，下一轮不再重复发送。
      dirtyDecision = null;
      branchName = null;
      actualPath = null;
      continueAfterCommit = null;
      worktreeCleanupDecision = null;

      if (result.action === "completed") {
        setCompletionProgress({
          title: getCompletionProgressTitle(locale),
          steps: buildCompletionProgressSteps(locale, "completed"),
        });
        return result.issue;
      }

      if (result.action === "cancelled") {
        throw new CompletionCancelledError();
      }

      if (result.action === "blocked") {
        setCompletionProgress(null);
        if (
          result.mergeBlockReason &&
          result.mergeBlockReason !== "merge_conflict"
        ) {
          throw new Error(result.message);
        }
        throw new WorktreeMergeConflictError({
          sessionId: result.sessionId,
          targetBranch: result.targetBranch ?? undefined,
          workspaceBranch: result.workspaceBranch ?? undefined,
          workspacePath: result.workspacePath ?? undefined,
          message: result.message,
        });
      }

      if (result.action === "prompt_dirty_decision") {
        setCompletionProgress(null);
        const decision = await requestDirtyWorkspaceDecision(result);
        dirtyDecision = decision.decision;
        branchName = decision.branchName;
        if (decision.decision === "cancel") {
          // 让后端记录 cancelled，下一轮返回 cancelled → 抛 CompletionCancelledError。
          continue;
        }
        continue;
      }

      if (result.action === "waiting_auto_commit") {
        setCompletionProgress({
          title: getCompletionProgressTitle(locale),
          steps: buildCompletionProgressSteps(locale, "waiting_commit"),
        });
        const outcome = await waitForAgentCommit(requestProjectId, issueId);
        if (outcome === "blocked") {
          throw new Error(messages.issues.completionGitOperationBlocked);
        }
        if (outcome === "no_commit_detected") {
          throw new Error(messages.issues.completionNoCommitDetected);
        }
        // commit_detected → 弹「代码已提交成功。确定继续标记完成吗？」
        setCompletionProgress(null);
        const proceed = await confirm({
          title: messages.issues.completionContinueAfterCommitTitle,
          message: messages.issues.completionContinueAfterCommitMessage,
          confirmLabel: messages.issues.completionContinueLabel,
          cancelLabel: messages.issues.completionCancel,
          confirmVariant: "default",
        });
        continueAfterCommit = proceed;
        continue;
      }

      if (result.action === "confirm_worktree_cleanup") {
        setCompletionProgress(null);
        const del = await confirm({
          title: messages.issues.completionWorktreeCleanupTitle,
          message: messages.issues.completionWorktreeCleanupMessage(
            result.targetBranch ?? "",
          ),
          confirmLabel: messages.issues.completionWorktreeCleanupConfirm,
          cancelLabel: messages.issues.completionWorktreeCleanupKeep,
          confirmVariant: "destructive",
        });
        worktreeCleanupDecision = del;
        continue;
      }

      throw new Error(result.message);
    }
  }

  function requestDirtyWorkspaceDecision(
    result: CompleteIssueFlowResult,
  ): Promise<{ decision: DirtyWorkspaceOption; branchName: string | null }> {
    return new Promise((resolve) => {
      dirtyWorkspaceDecisionRef.current = (decision, branchName) =>
        resolve({ decision, branchName });
      const prefill = result.workspaceBranch ?? result.targetBranch ?? null;
      setDirtyWorkspaceDialog({
        issueId: result.issue.id,
        branchName: prefill,
        // 情况一/二（已知分支）只读预填；情况三（漂移）/session 关闭无预填时允许手填。
        branchNameEditable: result.drifted || prefill == null,
      });
    });
  }

  function resolveDirtyWorkspaceDecision(
    decision: DirtyWorkspaceOption,
    branchName: string | null,
  ) {
    dirtyWorkspaceDecisionRef.current?.(decision, branchName);
    dirtyWorkspaceDecisionRef.current = null;
    setDirtyWorkspaceDialog(null);
  }

  /** 轮询检测 agent 是否已提交新 commit。 */
  async function waitForAgentCommit(
    requestProjectId: number,
    issueId: number,
  ): Promise<"commit_detected" | "no_commit_detected" | "blocked"> {
    const maxAttempts = 60;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await delay(2000);
      const detection = await detectAgentCommitCompletion({
        projectId: requestProjectId,
        issueId,
      });
      if (detection.outcome === "commit_detected") {
        return "commit_detected";
      }
      if (detection.outcome === "git_operation_blocked") {
        return "blocked";
      }
      // no_commit_detected → 继续轮询。
    }
    return "no_commit_detected";
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
    setIsReadOnlyEditRequested(false);
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
      setIsReadOnlyEditRequested(false);
      setRunDialogIssue(null);
      setSummaryIssueId(null);
      setAttachmentPreview(null);
      setForm(EMPTY_FORM);
      restoreDialogTriggerFocus(remainingIssues[0] ?? null);
      toast.success(messages.toast.deleteSuccess);
    } catch (error) {
      if (activeProjectIdRef.current === requestProjectId) {
        if (isEditablePageOpen) {
          setDialogErrorMessage(toCommandError(error).message);
        } else {
          showCommandErrorAlert(error);
        }
      }
    } finally {
      if (activeProjectIdRef.current === requestProjectId) {
        setIsSaving(false);
      }
    }
  }

  return (
    <main
      className={`activity-surface activity-surface--issues${
        isEditablePageOpen ? " activity-surface--issues-form" : ""
      }`}
    >
      {!isEditablePageOpen ? (
        <>
          <IssueSurfaceHeader
            title={messages.issues.title}
            titleLevel={2}
            variant="activity"
          />
          {errorMessage ? (
            <p
              className="issues-status"
              role="status"
              aria-label={messages.issues.issuesStatus}
            >
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
        </>
      ) : null}

      {dialogMode && isEditablePageOpen ? (
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
          onSelectAttachment={handleSelectAttachment}
          onPreviewAttachment={(attachment) =>
            void handlePreviewAttachment(attachment)
          }
          onDownloadAttachment={(attachment) =>
            void handleDownloadAttachment(attachment)
          }
          onRemoveAttachment={handleRemoveAttachment}
          onDeleteIssue={() => void handleDeleteIssue()}
          onRunIssue={
            selectedIssue && canRunIssueFor(selectedIssue)
              ? (trigger) => void confirmRunIssueFromEditPage(trigger)
              : undefined
          }
          onOpenProjectLabelsSettings={() => {
            onOpenProjectSettingsLabels?.();
          }}
        />
      ) : null}

      {dialogMode && !isEditablePageOpen ? (
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
          onEditIssue={editSelectedIssue}
          onOpenLinkedSession={openLinkedSession}
          onOpenSummary={handleOpenSummary}
        />
      ) : null}

      {runDialogIssue ? (
        <IssueRunDialog
          issue={runDialogIssue}
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
      {dirtyWorkspaceDialog ? (
        <IssueCompletionDirtyWorkspaceDialog
          title={messages.issues.completionDirtyTitle}
          message={messages.issues.completionDirtyMessage}
          branchName={dirtyWorkspaceDialog.branchName}
          branchNameEditable={dirtyWorkspaceDialog.branchNameEditable}
          branchNameLabel={messages.issues.completionBranchNameLabel}
          autoCommitLabel={messages.issues.completionAutoCommit}
          skipLabel={messages.issues.completionSkipDirty}
          cancelLabel={messages.issues.completionCancel}
          onDecision={resolveDirtyWorkspaceDecision}
        />
      ) : null}
      {alertDialog}
      {confirmationDialog}
    </main>
  );
}

type CompletionProgressStepId =
  | "checking_commit"
  | "waiting_commit"
  | "checking_worktree"
  | "rebasing"
  | "applying"
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

interface DirtyWorkspaceDialogState {
  issueId: number;
  branchName: string | null;
  branchNameEditable: boolean;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  message?: string;
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
          waiting_commit: "等待并检测新 commit",
          checking_worktree: "检查 worktree 是否存在",
          rebasing: "将工作分支 rebase 到目标分支",
          applying: "快进应用到目标分支",
          cleaning: "清理 worktree 与临时分支",
          completed: "完成",
        }
      : {
          checking_commit: "Check uncommitted changes",
          waiting_commit: "Wait for and detect a new commit",
          checking_worktree: "Check whether the worktree still exists",
          rebasing: "Rebase the workspace branch onto target",
          applying: "Fast-forward the target branch",
          cleaning: "Clean up worktree and temporary branch",
          completed: "Done",
        };
  const ids: CompletionProgressStepId[] = [
    "checking_commit",
    "waiting_commit",
    "checking_worktree",
    "rebasing",
    "applying",
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
      detail.message || "代码合并存在冲突，需要你接管处理。",
      `请解决临时分支 ${workspaceBranch} 合并到最初记录的目标分支 ${targetBranch} 时产生的冲突。`,
      `相关 worktree：${workspacePath}`,
      "解决冲突后，请完成合并并确保代码最终合入目标分支。",
    ].join("\n");
  }

  return [
    detail.message || "A merge conflict was detected and needs your help.",
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

function buildIssueDescription(
  description: string,
  attachments: Array<IssueAttachmentRecord | IssueAttachmentDraft>,
): string {
  const trimmedDescription = description.trimEnd();
  // 以裸 token 子串去重：图片附件在描述中以 ![alt](token) 形式存在时也命中，
  // 避免因 alt 文本不同而重复追加同一 token。
  const missingTokens = attachments
    .filter(
      (attachment) =>
        !trimmedDescription.includes(getAttachmentRawToken(attachment)),
    )
    .map(formatAttachmentDescriptionToken);

  if (missingTokens.length === 0) {
    return trimmedDescription;
  }

  if (trimmedDescription.length === 0) {
    return missingTokens.join("\n");
  }

  return `${trimmedDescription}\n\n${missingTokens.join("\n")}`;
}

function getAttachmentRawToken(
  attachment: IssueAttachmentRecord | IssueAttachmentDraft,
): string {
  if ("id" in attachment) {
    return `{{issue-attachment:${attachment.id}}}`;
  }

  return `{{issue-attachment-temp:${attachment.token}}}`;
}

function formatAttachmentDescriptionToken(
  attachment: IssueAttachmentRecord | IssueAttachmentDraft,
): string {
  const token =
    "id" in attachment
      ? `{{issue-attachment:${attachment.id}}}`
      : `{{issue-attachment-temp:${attachment.token}}}`;

  // 图片附件以 Markdown 图片语法承载 token（URL 即 token 占位符），编辑器与
  // 只读页据此内联渲染；非图片附件以裸 token 行承载（编辑器正文不显示，
  // 仅由底部卡片区展示）。两种形态都包含 token 子串，满足 Rust 硬约束。
  if (attachment.kind === "image") {
    return `![${attachment.displayName}](${token})`;
  }

  return token;
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

async function buildDraftAttachment(
  sourcePath: string,
): Promise<IssueAttachmentDraft> {
  const displayName = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
  const draft = await saveIssueAttachmentDraft({
    sourcePath,
    displayName,
  });
  return {
    token: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    displayName: draft.displayName,
    sourcePath: draft.path,
    kind: draft.kind,
    isPreviewable: draft.isPreviewable,
    absolutePath: draft.path,
  };
}

function canRunIssueFor(
  issue: Pick<IssueRecord, "status" | "linkedSessionId">,
): boolean {
  return issue.status === "backlog" && issue.linkedSessionId == null;
}

function issueStatusRank(status: IssueStatus): number {
  switch (status) {
    case "backlog":
      return 0;
    case "running":
      return 1;
    case "review":
      return 2;
    case "completed":
      return 3;
  }
}

function getIssueStatusLabel(
  status: IssueStatus,
  messages: ReturnType<typeof useI18n>["messages"],
): string {
  switch (status) {
    case "backlog":
      return messages.issues.backlog;
    case "running":
      return messages.issues.inProgress;
    case "review":
      return messages.issues.review;
    case "completed":
      return messages.issues.done;
  }
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
