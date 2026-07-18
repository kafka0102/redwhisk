import { open, save } from "@tauri-apps/plugin-dialog";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";

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
  updateIssue,
  type CompleteIssueFlowResult,
  type DirtyWorkspaceOption,
  type IssueStatus,
  type IssueAttachmentRecord,
  type IssueRecord,
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
  shiftLaneTotals,
  sortIssuesByIdDesc,
} from "./issue-lane-helpers";
import {
  buildDraftAttachment,
  buildIssueDescription,
  canRunIssueFor,
  formatLocalTimestamp,
  getIssueStatusLabel,
  issueStatusRank,
  issueToForm,
  markdownToExcerpt,
  mergeIssue,
  serializeAttachments,
  toAttachmentPreviewState,
} from "./issue-form/issue-description-serializer";
import { IssueEditablePage } from "./issue-detail/issue-editable-page";
import { isIssueFormDirty } from "./issue-form/issue-form-dirty";
import { IssueReadOnlyPage } from "./issue-detail/issue-read-only-page";
import { IssueSurfaceHeader } from "./issue-surface-header";
import { IssuesKanban } from "./issues-kanban";
import { IssueRunDialog } from "./issue-run/issue-run-dialog";
import { LoadingDialog } from "@/components/ui/loading-dialog";
import {
  buildWorktreeMergeConflictPrompt,
  type WorktreeMergeDetail,
} from "./issue-completion/issue-completion-helpers";
import { useAlertDialog } from "@/components/ui/use-alert-dialog";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import type { IssueAttachmentDraft } from "./issue-form/issue-description-editor";
import { issuePageStateCache } from "./issues-activity-cache";
import {
  injectAgentSessionPrompt,
  resumeStructuredAgentSession,
} from "../agents/agent-session-commands";
import {
  isGlobalLabelOverridden,
  listProjectLabels,
  type ProjectLabelRecord,
} from "../settings/settings-commands";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
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
  const [runDialogIssue, setRunDialogIssue] = useState<Pick<
    IssueRecord,
    "id" | "number" | "title" | "description" | "attachments" | "labels"
  > | null>(null);
  // 启动 Agent Session 期间显示阻塞式 LoadingDialog 并隐藏 Run Dialog，
  // 避免 Run Dialog overlay 与 Radix LoadingDialog overlay 同时挂载（见 4df1948）。
  const [isStartingSession, setIsStartingSession] = useState(false);
  // 删除 Issue / 切换状态期间显示阻塞式 LoadingDialog，避免用户误以为提交无响应。
  const [isDeletingIssue, setIsDeletingIssue] = useState(false);
  const [isAdvancingStatus, setIsAdvancingStatus] = useState(false);
  const [attachmentPreview, setAttachmentPreview] =
    useState<AttachmentPreviewState | null>(null);
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
  const runDialogTriggerRef = useRef<HTMLElement | null>(null);
  const dirtyWorkspaceDecisionRef = useRef<
    ((decision: DirtyWorkspaceOption, branchName: string | null) => void) | null
  >(null);
  const { confirm, confirmationDialog } = useConfirmDialog();
  const { alertDialog, showAlert } = useAlertDialog();

  const showCommandErrorAlert = (error: unknown) => {
    showAlert({ message: getCommandErrorMessage(error, t), type: "error" });
  };

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

        const sortedIssues = sortIssuesByIdDesc(response.issues);

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

  function openCreateDialog(trigger: HTMLElement | null) {
    setErrorMessage(null);
    setDialogErrorMessage(null);
    setTitleError(null);
    setIsReadOnlyEditRequested(false);
    previousSelectedIssueIdRef.current = selectedIssueId;
    dialogTriggerRef.current = trigger;
    setDialogMode("create");
    setForm(EMPTY_FORM);
  }

  function openIssueDialog(issue: IssueRecord, trigger: HTMLElement | null) {
    setErrorMessage(null);
    setDialogErrorMessage(null);
    setTitleError(null);
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
    setTitleError(null);
    setIsReadOnlyEditRequested(true);
    setDialogMode("edit");
    setForm(issueToForm(selectedIssue));
  }

  function closeDialog() {
    if (isSaving) {
      return;
    }

    setDialogErrorMessage(null);
    setTitleError(null);
    setRunDialogIssue(null);
    setAttachmentPreview(null);
    hideCompletionLoadingDialog();
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

  // 编辑页「返回」：从只读详情页进入编辑时回到只读详情页，而非关闭返回看板。
  function handleCancelEditable() {
    if (isSaving) {
      return;
    }

    if (isReadOnlyEditRequested && dialogMode === "edit" && selectedIssue) {
      setDialogErrorMessage(null);
      setTitleError(null);
      setIsReadOnlyEditRequested(false);
      setForm(issueToForm(selectedIssue));
      return;
    }

    closeDialog();
  }

  function handleBackFromReadOnlyIssue() {
    if (
      typeof requestedIssue === "object" &&
      requestedIssue?.source === "session" &&
      typeof requestedIssue.sessionId === "number"
    ) {
      setDialogErrorMessage(null);
      setTitleError(null);
      setRunDialogIssue(null);
      setAttachmentPreview(null);
      hideCompletionLoadingDialog();
      setDialogMode(null);
      setIsReadOnlyEditRequested(false);
      setForm(EMPTY_FORM);
      issuePageStateCache.delete(projectId);
      onOpenAgentsActivity?.(requestedIssue.sessionId);
      return;
    }

    closeDialog();
  }

  function handleFormChange(updater: SetStateAction<IssueFormState>) {
    setForm((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (titleError && next.title.trim() && next.title !== prev.title) {
        setTitleError(null);
      }
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving || !dialogMode) {
      return;
    }

    setDialogErrorMessage(null);
    setTitleError(null);
    if (form.title.trim().length === 0) {
      setTitleError(messages.issues.titleRequired);
      titleInputRef.current?.focus();
      return;
    }
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
        setLaneTotals((prev) => shiftLaneTotals(prev, null, createdIssue));
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
          setTitleError(null);
        } else {
          setDialogErrorMessage(getCommandErrorMessage(error, t));
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
      | "number"
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
    setTitleError(null);
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
        setDialogErrorMessage(getCommandErrorMessage(error, t));
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
    setTitleError(null);
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
    // 成功路径：关闭阻塞式 LoadingDialog 并卸载 Run Dialog。
    setIsStartingSession(false);
    setRunDialogIssue(null);
    setDialogErrorMessage(null);
    setTitleError(null);
    setDialogMode(null);
    setIsReadOnlyEditRequested(false);
    setForm(EMPTY_FORM);
    let resolvedSessionId = result.sessionId ?? null;

    try {
      const response = await listIssues({
        projectId,
        perStatusLimit: ISSUE_PAGE_SIZE,
      });
      if (activeProjectIdRef.current !== projectId) {
        return;
      }

      setIssues(response.issues);
      setLaneLoadState(computeLaneLoadState(response.issues));
      setLaneTotals(deriveLaneTotals(response.statusTotals, response.issues));
      setSelectedIssueId(result.issueId);
      if (resolvedSessionId == null) {
        resolvedSessionId =
          response.issues.find((issue) => issue.id === result.issueId)
            ?.linkedSessionId ?? null;
      }
    } catch (error) {
      if (activeProjectIdRef.current === projectId) {
        setErrorMessage(getCommandErrorMessage(error, t));
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
        setErrorMessage(t("issues.agentSessionOpenMissing"));
      }
    }
  }

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    closeDialog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issuesReturnSignal]);

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
      setDialogErrorMessage(getCommandErrorMessage(error, t));
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
      setDialogErrorMessage(getCommandErrorMessage(error, t));
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
      setDialogErrorMessage(getCommandErrorMessage(error, t));
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
        setDialogErrorMessage(getCommandErrorMessage(error, t));
        return;
      }
    }

    setDialogErrorMessage(null);
    setTitleError(null);
    setIsSaving(true);
    const requestProjectId = projectId;

    try {
      let updatedIssue: IssueRecord;
      // 已计入 laneTotals 的最近状态：完成流程会先经 review 再到 completed，
      // 中间态单独平移，取消/异常时也能让总数落在实际状态上。
      let totalsAnchor = currentIssue;

      if (
        targetStatus === "review" &&
        currentIssue.status === "running" &&
        currentIssue.linkedSessionStatus === "running"
      ) {
        setIsAdvancingStatus(true);
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
        // markIssueReview 已把状态从 running 改为 review，先平移到 review；
        // 若随后完成流程被取消或失败，总数停留在 review，与实际状态一致。
        setLaneTotals((prev) =>
          shiftLaneTotals(prev, currentIssue, reviewedIssue),
        );
        totalsAnchor = reviewedIssue;
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
        setIsAdvancingStatus(true);
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
            setDialogErrorMessage(getCommandErrorMessage(error, t));
          }
        }
      }

      if (activeProjectIdRef.current !== requestProjectId) {
        return;
      }

      setIssues((currentIssues) => mergeIssue(currentIssues, updatedIssue));
      setLaneTotals((prev) =>
        shiftLaneTotals(prev, totalsAnchor, updatedIssue),
      );
      setSelectedIssueId(updatedIssue.id);
      hideCompletionLoadingDialog();

      if (targetStatus === "backlog") {
        // 退回待办后直接回到看板：避免 status 变为 backlog 时只读页翻转为编辑页。
        setDialogMode(null);
        setIsReadOnlyEditRequested(false);
        setForm(EMPTY_FORM);
        restoreDialogTriggerFocus(updatedIssue);
      } else {
        setForm(issueToForm(updatedIssue));
      }
    } catch (error) {
      if (activeProjectIdRef.current === requestProjectId) {
        if (error instanceof CompletionCancelledError) {
          setDialogErrorMessage(null);
          setTitleError(null);
        } else if (error instanceof WorktreeMergeConflictError) {
          await handOffWorktreeMergeConflict(
            requestProjectId,
            currentIssue,
            error.detail,
          );
        } else {
          hideCompletionLoadingDialog();
          showCommandErrorAlert(error);
        }
      }
    } finally {
      if (activeProjectIdRef.current === requestProjectId) {
        setIsSaving(false);
      }
      setIsAdvancingStatus(false);
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
      showCompletionLoadingDialog();

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
        hideCompletionLoadingDialog();
        return result.issue;
      }

      if (result.action === "cancelled") {
        hideCompletionLoadingDialog();
        throw new CompletionCancelledError();
      }

      if (result.action === "blocked") {
        hideCompletionLoadingDialog();
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
        hideCompletionLoadingDialog();
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
        const outcome = await waitForAgentCommit(requestProjectId, issueId);
        if (outcome === "blocked") {
          hideCompletionLoadingDialog();
          throw new Error(messages.issues.completionGitOperationBlocked);
        }
        if (outcome === "no_commit_detected") {
          hideCompletionLoadingDialog();
          throw new Error(messages.issues.completionNoCommitDetected);
        }
        // commit_detected → 弹「代码已提交成功。确定继续标记完成吗？」
        hideCompletionLoadingDialog();
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
        hideCompletionLoadingDialog();
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
    detail: WorktreeMergeConflictSessionDetail,
  ) {
    const sessionId = detail.sessionId ?? issue.linkedSessionId;
    if (sessionId == null) {
      setDialogErrorMessage(t("issues.mergeConflictNoSessionHandoff"));
      return;
    }

    const prompt = buildWorktreeMergeConflictPrompt(detail, locale);
    // worktree session 关闭后 handle 会从 agent_registry 移除，直接注入会报
    // AgentSessionNotRunning。先 resume 重建 handle，再注入合并 prompt。
    // resume 失败时继续尝试注入，让后端的 AgentSessionNotRunning 错误透传给用户。
    await resumeStructuredAgentSession({
      projectId: requestProjectId,
      sessionId,
    }).catch(() => {
      /* 忽略 resume 错误，交给 inject 阶段统一报错 */
    });
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
    setTitleError(null);
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
    setTitleError(null);
    setIsSaving(true);
    setIsDeletingIssue(true);
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
      setLaneTotals((prev) => shiftLaneTotals(prev, issueToDelete, null));
      setSelectedIssueId(remainingIssues[0]?.id ?? null);
      setDialogMode(null);
      setIsReadOnlyEditRequested(false);
      setRunDialogIssue(null);
      setAttachmentPreview(null);
      setForm(EMPTY_FORM);
      restoreDialogTriggerFocus(remainingIssues[0] ?? null);
      toast.success(messages.toast.deleteSuccess);
    } catch (error) {
      if (activeProjectIdRef.current === requestProjectId) {
        if (isEditablePageOpen) {
          setDialogErrorMessage(getCommandErrorMessage(error, t));
        } else {
          showCommandErrorAlert(error);
        }
      }
    } finally {
      if (activeProjectIdRef.current === requestProjectId) {
        setIsSaving(false);
      }
      setIsDeletingIssue(false);
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
  constructor(readonly detail: WorktreeMergeConflictSessionDetail) {
    super("worktree merge conflict");
  }
}

interface WorktreeMergeConflictSessionDetail extends WorktreeMergeDetail {
  sessionId?: number | null;
}
