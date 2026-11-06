import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  listIssues,
  updateIssue,
  type DirtyWorkspaceOption,
  type IssueRecord,
  type IssueStatus,
} from "./issue-commands";
import { IssueAttachmentPreviewDialog } from "./issue-form/issue-attachment-preview-dialog";
import { IssueCompletionPrompts } from "./issue-completion/issue-completion-prompts";
import {
  EMPTY_FORM,
  ISSUE_PAGE_SIZE,
  type AttachmentPreviewState,
  type IssueFormState,
} from "./issue-activity-types";
import {
  type LaneLoadStateMap,
  type LaneTotalsMap,
  INITIAL_LANE_LOAD_STATE,
  INITIAL_LANE_TOTALS,
  deriveLaneTotals,
  mergeIssues,
} from "./issue-lane-helpers";
import {
  readInitialIssuePageState,
  resolveLoadedIssuePage,
} from "./issue-page-restore";
import {
  buildIssueDescription,
  canRunIssueFor,
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
import { isIssueFormDirty } from "./issue-form/issue-form-dirty";
import { issueBoardListInput } from "./issue-board-query";
import {
  IssueBoardHeader,
  IssuePullRequestsEmpty,
  type IssueBoardPane,
} from "./issue-board-header";
import { IssuesKanban } from "./issues-kanban";
import type { IssueSourceFilter } from "./issue-source-filter";
import { readIssueMirror, toBoardRecord } from "./issue-mirror-fields";
import { useIssueSyncChrome } from "./use-issue-sync-chrome";
import { useIssueLabelCatalog } from "./use-issue-label-catalog";
import { IssueRunDialog } from "./issue-run/issue-run-dialog";
import { LoadingDialog } from "@/components/ui/loading-dialog";
import { useAlertDialog } from "@/components/ui/use-alert-dialog";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import {
  issuePageStateCache,
  markIssueOpenRequestApplied,
  shouldApplyIssueOpenRequest,
} from "./issues-activity-cache";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { type IssueOpenRequest } from "./issue-open-request";

// 详情编辑 / 只读页含 Quill 与 react-markdown，按需 chunk，避免项目窗口冷启动
// 同步解析重依赖（看板首屏不需要编辑器与 Markdown 渲染栈）。
const IssueEditablePage = lazy(async () => {
  const module = await import("./issue-detail/issue-editable-page");
  return { default: module.IssueEditablePage };
});

const IssueReadOnlyPage = lazy(async () => {
  const module = await import("./issue-detail/issue-read-only-page");
  return { default: module.IssueReadOnlyPage };
});

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
  const initialPageState = readInitialIssuePageState({
    projectId,
    requestedIssue,
    legacyRequestedIssueId,
  });
  const { hasRequestedIssue, openRequestToken, requestedIssueId } =
    initialPageState;
  const [issues, setIssues] = useState<IssueRecord[]>(initialPageState.issues);
  const [selectedIssueId, setSelectedIssueId] = useState(
    initialPageState.selectedIssueId,
  );
  const [dialogMode, setDialogMode] = useState(initialPageState.dialogMode);
  const [isReadOnlyEditRequested, setIsReadOnlyEditRequested] = useState(
    initialPageState.isReadOnlyEditRequested,
  );
  // 删除 Issue / 切换状态期间显示阻塞式 LoadingDialog，避免用户误以为提交无响应。
  const [isDeletingIssue, setIsDeletingIssue] = useState(false);
  const [isAdvancingStatus, setIsAdvancingStatus] = useState(false);
  const [attachmentPreview, setAttachmentPreview] =
    useState<AttachmentPreviewState | null>(null);
  const [runDialogIssue, setRunDialogIssue] = useState<RunDialogIssue | null>(
    null,
  );
  const [form, setForm] = useState<IssueFormState>(initialPageState.form);
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
  const activeProjectIdRef = useRef(projectId);
  const {
    availableLabels: currentAvailableLabels,
    labelsErrorMessage: currentLabelsErrorMessage,
    isLoadingLabels,
  } = useIssueLabelCatalog(projectId, activeProjectIdRef, t);
  const reloadMirroredIssues = useCallback(
    (sourceFilter: IssueSourceFilter) => {
      void listIssues(
        issueBoardListInput(projectId, sourceFilter, {
          perStatusLimit: ISSUE_PAGE_SIZE,
        }),
      ).then((response) => {
        setIssues(response.issues);
        setLaneTotals(deriveLaneTotals(response.statusTotals, response.issues));
      });
    },
    [projectId],
  );
  const {
    sourceMode,
    sourceFilter,
    toolbar: issueSyncToolbar,
  } = useIssueSyncChrome(projectId, reloadMirroredIssues);
  const [boardPane, setBoardPane] = useState<IssueBoardPane>("issues");
  const loadingMoreRef = useRef<Set<IssueStatus>>(new Set());
  const previousSelectedIssueIdRef = useRef<number | null>(
    initialPageState.previousSelectedIssueId,
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

    const issueSnapshot =
      issues.find((issue) => issue.id === selectedIssueId) ??
      issuePageStateCache.get(projectId)?.issueSnapshot ??
      null;
    issuePageStateCache.set(projectId, {
      dialogMode,
      form,
      previousSelectedIssueId: previousSelectedIssueIdRef.current,
      selectedIssueId,
      isReadOnlyEditRequested,
      issueSnapshot,
    });
  }, [
    dialogMode,
    form,
    isReadOnlyEditRequested,
    issues,
    projectId,
    selectedIssueId,
  ]);

  useEffect(() => {
    let isMounted = true;

    async function loadIssues() {
      const cachedState = issuePageStateCache.get(projectId) ?? null;
      const applyOpenRequest = shouldApplyIssueOpenRequest(
        projectId,
        openRequestToken,
        hasRequestedIssue,
      );
      setIsLoading(true);
      setErrorMessage(null);
      loadingMoreRef.current.clear();
      setRunDialogIssue(null);
      setIsSaving(false);
      setDialogErrorMessage(null);
      setTitleError(null);
      hideCompletionLoadingDialog();
      setIsDeletingIssue(false);
      setIsAdvancingStatus(false);
      if (applyOpenRequest || !cachedState?.dialogMode) {
        setIssues([]);
        setLaneLoadState(INITIAL_LANE_LOAD_STATE);
        setLaneTotals(INITIAL_LANE_TOTALS);
        setSelectedIssueId(applyOpenRequest ? requestedIssueId : null);
        setDialogMode(applyOpenRequest ? "edit" : null);
        setIsReadOnlyEditRequested(false);
        setForm(EMPTY_FORM);
        previousSelectedIssueIdRef.current = null;
      }

      try {
        const response = await listIssues(
          issueBoardListInput(projectId, sourceFilter, {
            perStatusLimit: ISSUE_PAGE_SIZE,
          }),
        );
        if (!isMounted || activeProjectIdRef.current !== projectId) {
          return;
        }

        const restored = resolveLoadedIssuePage({
          issues: response.issues,
          statusTotals: response.statusTotals,
          applyOpenRequest,
          requestedIssueId,
          cached: applyOpenRequest
            ? null
            : (issuePageStateCache.get(projectId) ?? null),
        });
        if (applyOpenRequest) {
          markIssueOpenRequestApplied(projectId, openRequestToken);
        }
        if (restored.clearCache) {
          issuePageStateCache.delete(projectId);
        }
        setIssues(restored.issues);
        setLaneLoadState(restored.laneLoadState);
        setLaneTotals(restored.laneTotals);
        setSelectedIssueId(restored.selectedIssueId);
        setDialogMode(restored.dialogMode);
        setIsReadOnlyEditRequested(restored.isReadOnlyEditRequested);
        setForm(restored.form);
        previousSelectedIssueIdRef.current = restored.previousSelectedIssueId;
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
  }, [
    hasRequestedIssue,
    openRequestToken,
    projectId,
    requestedIssueId,
    sourceFilter,
    t,
  ]);

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
        ...issueBoardListInput(requestProjectId, sourceFilter, {
          status,
          limit: ISSUE_PAGE_SIZE,
          offset: state.loadedCount,
        }),
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
    sessionStartingMessage,
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
    startingIssueId: runDialogIssue?.id ?? null,
    sourceFilter,
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
    dialogMode === "create" ||
    (selectedIssue?.status === "backlog" &&
      !(
        selectedIssue != null &&
        readIssueMirror(toBoardRecord(selectedIssue)).source === "remote"
      ));
  const hasLinkedSession = selectedIssue?.linkedSessionId != null;
  const canOpenLinkedSession =
    hasLinkedSession && Boolean(onOpenAgentsActivity);
  const isEditablePageOpen = Boolean(
    dialogMode &&
    (isBacklogDialog ||
      (isReadOnlyEditRequested &&
        !(
          selectedIssue != null &&
          readIssueMirror(toBoardRecord(selectedIssue)).source === "remote"
        ))),
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
    closeoutDialog,
    resolveCloseoutDecision,
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
          <IssueBoardHeader
            actions={issueSyncToolbar}
            issueCount={
              laneTotals.backlog +
              laneTotals.running +
              laneTotals.review +
              laneTotals.completed
            }
            pane={boardPane}
            onPaneChange={setBoardPane}
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
          {boardPane === "pullRequests" ? (
            <IssuePullRequestsEmpty />
          ) : (
            <IssuesKanban
              isLoading={isLoading}
              lanes={lanes}
              selectedIssueId={selectedIssueId}
              cardRefs={cardRefs}
              createButtonRef={createButtonRef}
              laneLoadState={laneLoadState}
              canRunIssue={canRunIssueFor}
              toDescriptionExcerpt={markdownToExcerpt}
              sourceMode={sourceMode}
              showCreate={sourceMode === "local" || sourceMode === "mixed"}
              onCreateIssue={openCreateDialog}
              onOpenIssue={openIssueDialog}
              onRunIssue={openRunDialog}
              onLoadMore={loadMoreIssues}
            />
          )}
        </>
      ) : null}

      {dialogMode && isEditablePageOpen ? (
        <Suspense
          fallback={
            <p className="activity-surface__loading" role="status">
              {messages.settings.loading}
            </p>
          }
        >
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
        </Suspense>
      ) : null}

      {dialogMode && !isEditablePageOpen ? (
        <Suspense
          fallback={
            <p className="activity-surface__loading" role="status">
              {messages.settings.loading}
            </p>
          }
        >
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
        </Suspense>
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
          message={sessionStartingMessage}
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
      <IssueCompletionPrompts
        dirty={dirtyWorkspaceDialog}
        closeout={closeoutDialog}
        onDirtyDecision={resolveDirtyWorkspaceDecision}
        onCloseoutDecision={resolveCloseoutDecision}
      />
      {alertDialog}
      {confirmationDialog}
    </main>
  );
}
