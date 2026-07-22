import { Ellipsis } from "lucide-react";
import { useState } from "react";

import { LoadingDialog } from "@/components/ui/loading-dialog";
import { useAlertDialog } from "@/components/ui/use-alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
import {
  pullProjectWorktree,
  pushProjectWorktree,
  type CodeWorkspaceRoot,
} from "../../shared/workspace/workspace-commands";

export interface ChangesBranchMoreMenuProps {
  projectId: number;
  selectedRoot: CodeWorkspaceRoot | null;
  /** 拉取/推送成功后立即刷新未提交与已提交列表。 */
  onSuccess?: () => void;
}

type BusyAction = "pull" | "push" | null;

/**
 * 变更 Activity 分支栏右侧「更多」菜单。
 * 主 checkout：拉取 / 推送；linked worktree 的删除项留给后续票扩展。
 */
export function ChangesBranchMoreMenu({
  projectId,
  selectedRoot,
  onSuccess,
}: ChangesBranchMoreMenuProps) {
  const { messages, t } = useI18n();
  const { alertDialog, showAlert } = useAlertDialog();
  const [busyAction, setBusyAction] = useState<BusyAction>(null);

  const isBusy = busyAction !== null;
  const isProjectRoot = selectedRoot?.isProjectRoot === true;
  const workspacePath = selectedRoot?.path ?? null;

  async function runRemoteAction(
    action: "pull" | "push",
    invoke: () => Promise<void>,
    successMessage: string,
  ): Promise<void> {
    if (!workspacePath || isBusy) {
      return;
    }
    setBusyAction(action);
    try {
      await invoke();
      toast.success(successMessage);
      onSuccess?.();
    } catch (error) {
      showAlert({
        type: "error",
        message: getCommandErrorMessage(error, t),
      });
    } finally {
      setBusyAction(null);
    }
  }

  function handlePull(): void {
    void runRemoteAction(
      "pull",
      () =>
        pullProjectWorktree({
          projectId,
          workspacePath,
        }),
      messages.changesBranchMenu.pullSuccess,
    );
  }

  function handlePush(): void {
    void runRemoteAction(
      "push",
      () =>
        pushProjectWorktree({
          projectId,
          workspacePath,
        }),
      messages.changesBranchMenu.pushSuccess,
    );
  }

  const loadingMessage =
    busyAction === "pull"
      ? messages.changesBranchMenu.pulling
      : busyAction === "push"
        ? messages.changesBranchMenu.pushing
        : "";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={messages.changesBranchMenu.moreActions}
          className="code-workspace__refresh"
          disabled={isBusy || !selectedRoot}
        >
          <Ellipsis aria-hidden="true" size={14} strokeWidth={1.8} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isProjectRoot ? (
            <>
              <DropdownMenuItem
                disabled={isBusy}
                onClick={(event) => {
                  event.preventDefault();
                  handlePull();
                }}
              >
                {messages.changesBranchMenu.pull}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isBusy}
                onClick={(event) => {
                  event.preventDefault();
                  handlePush();
                }}
              >
                {messages.changesBranchMenu.push}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <LoadingDialog
        dismissible={false}
        message={loadingMessage}
        open={isBusy}
      />
      {alertDialog}
    </>
  );
}
