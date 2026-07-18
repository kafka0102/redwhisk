import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useRef,
  useState,
} from "react";

import { listIssues, type IssueRecord } from "./issue-commands";
import {
  EMPTY_FORM,
  ISSUE_PAGE_SIZE,
  type DialogMode,
  type IssueFormState,
} from "./issue-activity-types";
import {
  type LaneLoadStateMap,
  type LaneTotalsMap,
  computeLaneLoadState,
  deriveLaneTotals,
} from "./issue-lane-helpers";
import {
  canRunIssueFor,
  issueToForm,
  mergeIssue,
} from "./issue-form/issue-description-serializer";
import { issuePageStateCache } from "./issues-activity-cache";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import type { useI18n } from "../../shared/i18n/i18n";
import type { useConfirmDialog } from "@/components/ui/use-confirm-dialog";

type Messages = ReturnType<typeof useI18n>["messages"];
type Translate = ReturnType<typeof useI18n>["t"];
type Confirm = ReturnType<typeof useConfirmDialog>["confirm"];

type RunDialogIssue = Pick<
  IssueRecord,
  | "id"
  | "number"
  | "title"
  | "description"
  | "attachments"
  | "labels"
  | "status"
  | "linkedSessionId"
>;

interface UseIssueRunDialogOptions {
  projectId: number;
  selectedIssue: IssueRecord | null;
  isSaving: boolean;
  activeProjectIdRef: MutableRefObject<number>;
  setIssues: Dispatch<SetStateAction<IssueRecord[]>>;
  setSelectedIssueId: (id: number | null) => void;
  setForm: Dispatch<SetStateAction<IssueFormState>>;
  setDialogErrorMessage: Dispatch<SetStateAction<string | null>>;
  setTitleError: Dispatch<SetStateAction<string | null>>;
  setIsSaving: Dispatch<SetStateAction<boolean>>;
  setDialogMode: Dispatch<SetStateAction<DialogMode | null>>;
  setIsReadOnlyEditRequested: Dispatch<SetStateAction<boolean>>;
  setLaneLoadState: Dispatch<SetStateAction<LaneLoadStateMap>>;
  setLaneTotals: Dispatch<SetStateAction<LaneTotalsMap>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  saveSelectedIssueDraft: (
    projectId: number,
    issueId: number,
  ) => Promise<IssueRecord>;
  confirm: Confirm;
  t: Translate;
  messages: Messages;
  onOpenAgentsActivity?: (sessionId: number) => void;
}

export function useIssueRunDialog({
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
  saveSelectedIssueDraft,
  confirm,
  t,
  messages,
  onOpenAgentsActivity,
}: UseIssueRunDialogOptions) {
  const [runDialogIssue, setRunDialogIssue] = useState<RunDialogIssue | null>(
    null,
  );
  const [isStartingSession, setIsStartingSession] = useState(false);
  const runDialogTriggerRef = useRef<HTMLElement | null>(null);

  function openRunDialog(issue: RunDialogIssue, trigger: HTMLElement | null) {
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

  return {
    runDialogIssue,
    isStartingSession,
    setRunDialogIssue,
    setIsStartingSession,
    openRunDialog,
    confirmRunIssueFromEditPage,
    openLinkedSession,
    closeRunDialog,
    handleRunStarted,
  };
}
