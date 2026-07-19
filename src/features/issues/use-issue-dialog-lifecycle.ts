import {
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";

import { createIssue, type IssueRecord } from "./issue-commands";
import {
  EMPTY_FORM,
  type AttachmentPreviewState,
  type DialogMode,
  type IssueFormState,
} from "./issue-activity-types";
import { type LaneTotalsMap, shiftLaneTotals } from "./issue-lane-helpers";
import {
  buildIssueDescription,
  issueToForm,
  mergeIssue,
  serializeAttachments,
} from "./issue-form/issue-description-serializer";
import { CompletionCancelledError } from "./use-issue-completion-flow";
import type { RunDialogIssue } from "./use-issue-run-dialog";
import { issuePageStateCache } from "./issues-activity-cache";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import type { useI18n } from "../../shared/i18n/i18n";
import type { IssueOpenRequest } from "./issue-open-request";

type Messages = ReturnType<typeof useI18n>["messages"];
type Translate = ReturnType<typeof useI18n>["t"];

interface UseIssueDialogLifecycleOptions {
  projectId: number;
  requestedIssue: IssueOpenRequest | number | null;
  selectedIssue: IssueRecord | null;
  selectedIssueId: number | null;
  isSaving: boolean;
  issues: IssueRecord[];
  dialogMode: DialogMode | null;
  isReadOnlyEditRequested: boolean;
  form: IssueFormState;
  titleError: string | null;
  activeProjectIdRef: MutableRefObject<number>;
  previousSelectedIssueIdRef: MutableRefObject<number | null>;
  titleInputRef: RefObject<HTMLInputElement | null>;
  cardRefs: MutableRefObject<Map<number, HTMLButtonElement>>;
  createButtonRef: RefObject<HTMLButtonElement | null>;
  dialogTriggerRef: MutableRefObject<HTMLElement | null>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setDialogErrorMessage: Dispatch<SetStateAction<string | null>>;
  setTitleError: Dispatch<SetStateAction<string | null>>;
  setIsSaving: Dispatch<SetStateAction<boolean>>;
  setIssues: Dispatch<SetStateAction<IssueRecord[]>>;
  setLaneTotals: Dispatch<SetStateAction<LaneTotalsMap>>;
  setSelectedIssueId: (id: number | null) => void;
  setForm: Dispatch<SetStateAction<IssueFormState>>;
  setDialogMode: Dispatch<SetStateAction<DialogMode | null>>;
  setIsReadOnlyEditRequested: Dispatch<SetStateAction<boolean>>;
  setAttachmentPreview: Dispatch<SetStateAction<AttachmentPreviewState | null>>;
  setRunDialogIssue: Dispatch<SetStateAction<RunDialogIssue | null>>;
  hideCompletionLoadingDialog: () => void;
  saveSelectedIssueDraft: (
    requestProjectId: number,
    issueId: number,
  ) => Promise<IssueRecord>;
  t: Translate;
  messages: Messages;
  onOpenAgentsActivity?: (sessionId: number) => void;
}

export function useIssueDialogLifecycle({
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
}: UseIssueDialogLifecycleOptions) {
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

  return {
    handleSubmit,
    handleFormChange,
    openCreateDialog,
    openIssueDialog,
    editSelectedIssue,
    closeDialog,
    handleCancelEditable,
    handleBackFromReadOnlyIssue,
    restoreDialogTriggerFocus,
  };
}
