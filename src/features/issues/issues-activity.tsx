import { useEffect, useMemo, useRef, useState } from "react";

import {
  listIssues,
  updateIssue,
  type DirtyWorkspaceOption,
  type IssueRecord,
  type IssueStatus,
} from "./issue-commands";
import { IssueAttachmentPreviewDialog } from "./issue-form/issue-attachment-preview-dialog";
import { IssueCompletionDirtyWorkspaceDialog } from "./issue-completion/issue-completion-dirty-workspace-dialog";
import {
  EMPTY_FORM,
  ISSUE_PAGE_SIZE,
  type AttachmentPreviewState,
  type DialogMode,
  type IssueFormState,
} from "./issue-activity-types";
import {
  type LaneLoadStateMap,
  type LaneTotalsMap,
  INITIAL_LANE_LOAD_STATE,
  INITIAL_LANE_TOTALS,
  computeLaneLoadState,
  deriveLaneTotals,
  mergeIssues,
  sortIssuesByStatusChangedAtDesc,
} from "./issue-lane-helpers";
import {
  buildIssueDescription,
  canRunIssueFor,
  formatLocalTimestamp,
  issueToForm,
  markdownToExcerpt,
  serializeAttachments,
} from "./issue-form/issue-description-serializer";
import { useIssueAttachments } from "./use-issue-attachments";
import {
  type DirtyWorkspaceDialogState,
  useIssueCompletionFlow,
} from "./use-issue-completion-flow";
import { useIssueDialogLifecycle } from "./use-issue-dialog-lifecycle";
import { type RunDialogIssue, useIssueRunDialog } from "./use-issue-run-dialog";
import { IssueEditablePage } from "./issue-detail/issue-editable-page";
import { isIssueFormDirty } from "./issue-form/issue-form-dirty";
import { IssueReadOnlyPage } from "./issue-detail/issue-read-only-page";
import { IssueSurfaceHeader } from "./issue-surface-header";
import { IssuesKanban } from "./issues-kanban";
import { IssueRunDialog } from "./issue-run/issue-run-dialog";
import { LoadingDialog } from "@/components/ui/loading-dialog";
import { useAlertDialog } from "@/components/ui/use-alert-dialog";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { issuePageStateCache } from "./issues-activity-cache";
import {
  isGlobalLabelOverridden,
  listProjectLabels,
  type ProjectLabelRecord,
} from "../settings/settings-commands";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import {
  getIssueOpenRequestId,
  type IssueOpenRequest,
} from "./issue-open-request";

interface IssuesActivityProps {
  projectId: number;
  onOpenAgentsActivity?: (sessionId: number) => void;
  onOpenProjectSettingsLabels?: () => void;
  requestedIssue?: IssueOpenRequest | number | null;
  requestedIssueId?: number | null;
  worktreeSetupCommand?: string;
  issuesReturnSignal?: number;
}

export function IssuesActivity({
  projectId,
  onOpenAgentsActivity,
  onOpenProjectSettingsLabels,
  requestedIssue = null,
  requestedIssueId: legacyRequestedIssueId = null,
  worktreeSetupCommand = "",
  issuesReturnSignal = 0,
}: IssuesActivityProps) {
  const { locale, messages, t } = useI18n();
  const cachedPageState = issuePageStateCache.get(projectId) ?? null;
  const requestedIssueId =
    getIssueOpenRequestId(requestedIssue) ?? legacyRequestedIssueId;
  const hasRequestedIssue = requestedIssueId != null;
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(
    requestedIssueId ?? cachedPageState?.selectedIssueId ?? null,
  );
  const [dialogMode, setDialogMode] = useState<DialogMode | null>(
    hasRequestedIssue ? "edit" : (cachedPageState?.dialogMode ?? null),
  );
  const [isReadOnlyEditRequested, setIsReadOnlyEditRequested] = useState(false);
  // 删除 Issue / 切换状态期间显示阻塞式 LoadingDialog，避免用户误以为提交无响应。
  const [isDeletingIssue, setIsDeletingIssue] = useState(false);
  const [isAdvancingStatus, setIsAdvancingStatus] = useState(false);
  const [attachmentPreview, setAttachmentPreview] =
    useState<AttachmentPreviewState | null>(null);
  const [runDialogIssue, setRunDialogIssue] = useState<RunDialogIssue | null>(
    null,
  );
  const [form, setForm] = useState<IssueFormState>(
    cachedPageState?.form ?? EMPTY_FORM,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [laneLoadState, setLaneLoadState] = useState<LaneLoadStateMap>(
    INITIAL_LANE_LOAD_STATE,
  );
  const [laneTotals, setLaneTotals] =
    useState<LaneTotalsMap>(INITIAL_LANE_TOTALS);
  const [dialogErrorMessage, setDialogErrorMessage] = useState<string | null>(
    null,
  );
  const [titleError, setTitleError] = useState<string | null>(null);
  const [isCompletionLoading, setIsCompletionLoading] = useState(false);
  const [
    isCompletionLoadingDialogDismissed,
    setIsCompletionLoadingDialogDismissed,
  ] = useState(false);
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
  const loadingMoreRef = useRef<Set<IssueStatus>>(new Set());
  const previousSelectedIssueIdRef = useRef<number | null>(
    cachedPageState?.previousSelectedIssueId ?? null,
  );
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const cardRefs = useRef(new Map<number, HTMLButtonElement>());
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const dirtyWorkspaceDecisionRef = useRef<
    ((decision: DirtyWorkspaceOption, branchName: string | null) => void) | null
  >(null);
  const { confirm, confirmationDialog } = useConfirmDialog();
  const { alertDialog, showAlert } = useAlertDialog();

  function showCompletionLoadingDialog() {
    setIsCompletionLoadingDialogDismissed(false);
    setIsCompletionLoading(true);
  }

  function hideCompletionLoadingDialog() {
    setIsCompletionLoading(false);
    setIsCompletionLoadingDialogDismissed(false);
  }

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
      setLaneLoadState(INITIAL_LANE_LOAD_STATE);
      setLaneTotals(INITIAL_LANE_TOTALS);
      loadingMoreRef.current.clear();
      setSelectedIssueId(
        hasRequestedIssue
          ? requestedIssueId
          : (cachedState?.selectedIssueId ?? null),
      );
      setDialogMode(
        hasRequestedIssue ? "edit" : (cachedState?.dialogMode ?? null),
      );
      setIsReadOnlyEditRequested(false);
      setRunDialogIssue(null);
      setForm(cachedState?.form ?? EMPTY_FORM);
      previousSelectedIssueIdRef.current =
        cachedState?.previousSelectedIssueId ?? null;
      setIsSaving(false);
      setDialogErrorMessage(null);
      setTitleError(null);
      hideCompletionLoadingDialog();
      setIsDeletingIssue(false);
      setIsAdvancingStatus(false);

      try {
        const response = await listIssues({
          projectId,
          perStatusLimit: ISSUE_PAGE_SIZE,
        });
        if (!isMounted || activeProjectIdRef.current !== projectId) {
          return;
        }

        const nextCachedState = issuePageStateCache.get(projectId) ?? null;
        const cachedIssueExists =
          nextCachedState?.dialogMode === "create" ||
          response.issues.some(
            (issue) => issue.id === nextCachedState?.selectedIssueId,
          );

        const sortedIssues = sortIssuesByStatusChangedAtDesc(response.issues);

        setIssues(sortedIssues);
        setLaneLoadState(computeLaneLoadState(sortedIssues));
        setLaneTotals(deriveLaneTotals(response.statusTotals, sortedIssues));
        if (hasRequestedIssue) {
          const requestedIssue =
            sortedIssues.find((issue) => issue.id === requestedIssueId) ?? null;
          setSelectedIssueId(requestedIssue?.id ?? sortedIssues[0]?.id ?? null);
          setDialogMode(requestedIssue ? "edit" : null);
          setForm(requestedIssue ? issueToForm(requestedIssue) : EMPTY_FORM);
          previousSelectedIssueIdRef.current = null;
        } else if (nextCachedState && cachedIssueExists) {
          setSelectedIssueId(nextCachedState.selectedIssueId);
          setDialogMode(nextCachedState.dialogMode);
          setForm(nextCachedState.form);
          previousSelectedIssueIdRef.current =
            nextCachedState.previousSelectedIssueId;
        } else {
          issuePageStateCache.delete(projectId);
          setSelectedIssueId(
            sortedIssues.find((issue) => issue.id === requestedIssueId)?.id ??
              sortedIssues[0]?.id ??
              null,
          );
          setDialogMode(null);
          setForm(EMPTY_FORM);
          previousSelectedIssueIdRef.current = null;
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(getCommandErrorMessage(error, t));
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
  }, [hasRequestedIssue, projectId, requestedIssueId, t]);

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

        const projectLabels = projectResponse.labels;
        const visibleLabels = [
          ...projectLabels,
          ...globalResponse.labels.filter(
            (label) => !isGlobalLabelOverridden(label, projectLabels),
          ),
        ].sort((left, right) => {
          if (left.scope !== right.scope) {
            return left.scope === "project" ? -1 : 1;
          }

          return left.name.localeCompare(right.name);
        });
        setAvailableLabels(visibleLabels);
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
        setLabelsErrorMessage(getCommandErrorMessage(error, t));
        setLabelsLoadState("error");
      });

    return () => {
      isMounted = false;
    };
  }, [projectId, t]);

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
        total: laneTotals[lane.status],
      })),
    [
      issues,
      laneTotals,
      messages.issues.backlog,
      messages.issues.done,
      messages.issues.inProgress,
      messages.issues.review,
    ],
  );

  async function loadMoreIssues(status: IssueStatus) {
    if (loadingMoreRef.current.has(status)) {
      return;
    }
    const state = laneLoadState[status];
    if (!state || !state.hasMore) {
      return;
    }
    loadingMoreRef.current.add(status);
    setLaneLoadState((prev) => ({
      ...prev,
      [status]: { ...prev[status], isLoadingMore: true },
    }));
    const requestProjectId = projectId;
    try {
      const response = await listIssues({
        projectId: requestProjectId,
        status,
        limit: ISSUE_PAGE_SIZE,
        offset: state.loadedCount,
      });
      if (activeProjectIdRef.current !== requestProjectId) {
        return;
      }
      setIssues((prevIssues) => mergeIssues(prevIssues, response.issues));
      setLaneLoadState((prev) => ({
        ...prev,
        [status]: {
          loadedCount: state.loadedCount + response.issues.length,
          hasMore: response.issues.length >= ISSUE_PAGE_SIZE,
          isLoadingMore: false,
        },
      }));
    } catch (error) {
      if (activeProjectIdRef.current === requestProjectId) {
        setErrorMessage(getCommandErrorMessage(error, t));
        setLaneLoadState((prev) => ({
          ...prev,
          [status]: { ...prev[status], isLoadingMore: false },
        }));
      }
    } finally {
      loadingMoreRef.current.delete(status);
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

  const {
    isStartingSession,
    setIsStartingSession,
    openRunDialog,
    confirmRunIssueFromEditPage,
    openLinkedSession,
    closeRunDialog,
    handleRunStarted,
  } = useIssueRunDialog({
    projectId,
    selectedIssue,
    isSaving,
    activeProjectIdRef,
    setIssues,
    setSelectedIssueId,
    setForm,
    setDialogErrorMessage,
    setTitleError,
    setIsSaving,
    setDialogMode,
    setIsReadOnlyEditRequested,
    setLaneLoadState,
    setLaneTotals,
    setErrorMessage,
    setRunDialogIssue,
    saveSelectedIssueDraft,
    confirm,
    t,
    messages,
    onOpenAgentsActivity,
  });
  const {
    handleSubmit,
    handleFormChange,
    openCreateDialog,
    openIssueDialog,
    editSelectedIssue,
    closeDialog,
    handleCancelEditable,
    handleBackFromReadOnlyIssue,
    restoreDialogTriggerFocus,
  } = useIssueDialogLifecycle({
    projectId,
    requestedIssue,
    selectedIssue,
    selectedIssueId,
    isSaving,
    issues,
    dialogMode,
    isReadOnlyEditRequested,
    form,
    titleError,
    activeProjectIdRef,
    previousSelectedIssueIdRef,
    titleInputRef,
    cardRefs,
    createButtonRef,
    dialogTriggerRef,
    setErrorMessage,
    setDialogErrorMessage,
    setTitleError,
    setIsSaving,
    setIssues,
    setLaneTotals,
    setSelectedIssueId,
    setForm,
    setDialogMode,
    setIsReadOnlyEditRequested,
    setAttachmentPreview,
    setRunDialogIssue,
    hideCompletionLoadingDialog,
    saveSelectedIssueDraft,
    t,
    messages,
    onOpenAgentsActivity,
  });

  const isBacklogDialog =
    dialogMode === "create" || selectedIssue?.status === "backlog";
  const hasLinkedSession = selectedIssue?.linkedSessionId != null;
  const canOpenLinkedSession =
    hasLinkedSession && Boolean(onOpenAgentsActivity);
  const isEditablePageOpen = Boolean(
    dialogMode && (isBacklogDialog || isReadOnlyEditRequested),
  );

  function isFormDirty(): boolean {
    if (dialogMode === "create") {
      return isIssueFormDirty(form, EMPTY_FORM);
    }
    if (selectedIssue) {
      return isIssueFormDirty(form, issueToForm(selectedIssue));
    }
    return false;
  }

  // 活动栏 Issue 图标在已处于 Issues Activity 时被点击：按当前详情态返回看板。
  // 只读详情直接返回；编辑/创建态有未保存改动则保留，无改动才返回；保存中不响应。
  const previousReturnSignalRef = useRef(issuesReturnSignal);
  useEffect(() => {
    if (previousReturnSignalRef.current === issuesReturnSignal) {
      return;
    }
    previousReturnSignalRef.current = issuesReturnSignal;

    if (!dialogMode || isSaving) {
      return;
    }
    if (isEditablePageOpen && isFormDirty()) {
      return;
    }
    // 活动栏返回信号是外部输入：按当前详情态做一次性返回，effect 仅依赖信号值，不会触发级联渲染。
    closeDialog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issuesReturnSignal]);

  const {
    selectAttachment: handleSelectAttachment,
    removeAttachment: handleRemoveAttachment,
    previewAttachment: handlePreviewAttachment,
    downloadAttachment: handleDownloadAttachment,
  } = useIssueAttachments({
    projectId,
    setForm,
    setAttachmentPreview,
    setDialogErrorMessage,
    t,
    messages,
  });

  const {
    handleAdvanceStatus,
    handleDeleteIssue,
    resolveDirtyWorkspaceDecision,
  } = useIssueCompletionFlow({
    projectId,
    locale,
    selectedIssue,
    isSaving,
    issues,
    isEditablePageOpen,
    activeProjectIdRef,
    dirtyWorkspaceDecisionRef,
    setDialogErrorMessage,
    setTitleError,
    setIsSaving,
    setIsAdvancingStatus,
    setIsDeletingIssue,
    setIssues,
    setLaneTotals,
    setSelectedIssueId,
    setForm,
    setDialogMode,
    setIsReadOnlyEditRequested,
    setAttachmentPreview,
    setRunDialogIssue,
    setDirtyWorkspaceDialog,
    confirm,
    showAlert,
    showCompletionLoadingDialog,
    hideCompletionLoadingDialog,
    restoreDialogTriggerFocus,
    t,
    messages,
    onOpenAgentsActivity,
  });

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
            laneLoadState={laneLoadState}
            canRunIssue={canRunIssueFor}
            formatTimestamp={formatLocalTimestamp}
            toDescriptionExcerpt={markdownToExcerpt}
            onCreateIssue={openCreateDialog}
            onOpenIssue={openIssueDialog}
            onRunIssue={openRunDialog}
            onLoadMore={loadMoreIssues}
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
          titleError={titleError}
          availableLabels={currentAvailableLabels}
          isLoadingLabels={isLoadingLabels}
          labelsErrorMessage={currentLabelsErrorMessage}
          titleInputRef={titleInputRef}
          onCancel={handleCancelEditable}
          onSubmit={handleSubmit}
          onFormChange={handleFormChange}
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
          canOpenAgentsActivity={canOpenLinkedSession}
          onBack={handleBackFromReadOnlyIssue}
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
        />
      ) : null}

      {runDialogIssue ? (
        <IssueRunDialog
          issue={runDialogIssue}
          projectId={projectId}
          worktreeSetupCommand={worktreeSetupCommand}
          hidden={isStartingSession}
          onClose={closeRunDialog}
          onStartAttempt={() => setIsStartingSession(true)}
          onStartError={() => setIsStartingSession(false)}
          onStarted={handleRunStarted}
        />
      ) : null}
      {isStartingSession ? (
        <LoadingDialog
          open
          dismissible={false}
          message={messages.issues.sessionStarting}
        />
      ) : null}
      {isDeletingIssue ? (
        <LoadingDialog
          open
          dismissible={false}
          message={messages.issues.deletingIssue}
        />
      ) : null}
      {isAdvancingStatus ? (
        <LoadingDialog
          open
          dismissible={false}
          message={messages.issues.updatingStatus}
        />
      ) : null}
      {attachmentPreview ? (
        <IssueAttachmentPreviewDialog
          preview={attachmentPreview}
          onClose={() => setAttachmentPreview(null)}
        />
      ) : null}
      <LoadingDialog
        closeLabel={messages.issues.closeCompletionLoading}
        message={messages.issues.completionSubmitting}
        open={isCompletionLoading && !isCompletionLoadingDialogDismissed}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setIsCompletionLoadingDialogDismissed(true);
          }
        }}
      />
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
