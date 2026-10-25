import { Ellipsis } from "lucide-react";
import { useEffect, useState } from "react";

import { LoadingDialog } from "@/components/ui/loading-dialog";
import { useAlertDialog } from "@/components/ui/use-alert-dialog";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
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
  deleteCodeWorkspaceWorktree,
  pullProjectWorktree,
  pushProjectWorktree,
  type CodeWorkspaceRoot,
} from "../../shared/workspace/workspace-commands";
import {
  listAgentSessions,
  type AgentSessionListItem,
} from "../agents/agent-session-commands";
import { CheckoutBranchDialog } from "./checkout-branch-dialog";
import { CreateBranchDialog } from "./create-branch-dialog";
import { CreateChangeRequestDialog } from "./create-change-request-dialog";
import { MergeBranchDialog } from "./merge-branch-dialog";
import {
  inspectProjectForge,
  type ForgeHostName,
} from "../project/project-forge-commands";

export interface ChangesBranchMoreMenuProps {
  projectId: number;
  selectedRoot: CodeWorkspaceRoot | null;
  /** 拉取/推送成功后立即刷新未提交与已提交列表。 */
  onSuccess?: () => void;
}

type BusyAction = "pull" | "push" | "delete" | null;

/**
 * 变更 Activity 分支栏右侧「更多」菜单。
 * 主 checkout：签出 / 拉取 / 推送 / 创建分支 / 合并分支；linked worktree：删除。
 */
export function ChangesBranchMoreMenu({
  projectId,
  selectedRoot,
  onSuccess,
}: ChangesBranchMoreMenuProps) {
  const { t } = useI18n();
  const { alertDialog, showAlert } = useAlertDialog();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [createBranchOpen, setCreateBranchOpen] = useState(false);
  const [createRequestOpen, setCreateRequestOpen] = useState(false);
  const [detectedHost, setDetectedHost] = useState<ForgeHostName>("none");
  const [mergeBranchOpen, setMergeBranchOpen] = useState(false);

  const isBusy = busyAction !== null;
  const isProjectRoot = selectedRoot?.isProjectRoot === true;
  const workspacePath = selectedRoot?.path ?? null;
  const forgeHost = isProjectRoot ? detectedHost : "none";
  const requestLabel =
    forgeHost === "gitlab"
      ? t("changeRequest.createMergeRequest")
      : t("changeRequest.createPullRequest");

  useEffect(() => {
    if (!isProjectRoot) {
      return;
    }
    let cancelled = false;
    void inspectProjectForge(projectId)
      .then((inspection) => {
        if (cancelled) {
          return;
        }
        setDetectedHost(
          inspection.host === "github" || inspection.host === "gitlab"
            ? inspection.host
            : "none",
        );
      })
      .catch(() => {
        if (!cancelled) {
          setDetectedHost("none");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isProjectRoot, projectId]);

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
      t("changesBranchMenu.pullSuccess"),
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
      t("changesBranchMenu.pushSuccess"),
    );
  }

  async function handleDelete(): Promise<void> {
    if (!workspacePath || isBusy) {
      return;
    }

    try {
      const response = await listAgentSessions(projectId, {
        status: "running",
      });
      if (hasRunningTurn(response.sessions, workspacePath)) {
        showAlert({
          type: "error",
          message: t("changesBranchMenu.cannotDeleteWhileRunning"),
        });
        return;
      }
    } catch (error) {
      showAlert({
        type: "error",
        message: getCommandErrorMessage(error, t),
      });
      return;
    }

    const confirmed = await confirm({
      title: t("changesBranchMenu.delete"),
      message: t("changesBranchMenu.deleteConfirm"),
      confirmLabel: t("changesBranchMenu.delete"),
      cancelLabel: t("confirmDialog.cancel"),
      confirmVariant: "destructive",
    });
    if (!confirmed) {
      return;
    }

    setBusyAction("delete");
    try {
      await deleteCodeWorkspaceWorktree({
        projectId,
        workspacePath,
      });
      toast.success(t("changesBranchMenu.deleteSuccess"));
    } catch (error) {
      showAlert({
        type: "error",
        message: getCommandErrorMessage(error, t),
      });
    } finally {
      setBusyAction(null);
    }
  }

  const loadingMessage =
    busyAction === "pull"
      ? t("changesBranchMenu.pulling")
      : busyAction === "push"
        ? t("changesBranchMenu.pushing")
        : busyAction === "delete"
          ? t("changesBranchMenu.deleting")
          : "";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("changesBranchMenu.moreActions")}
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
                  setCheckoutOpen(true);
                }}
              >
                {t("changesBranchMenu.checkout")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isBusy}
                onClick={(event) => {
                  event.preventDefault();
                  handlePull();
                }}
              >
                {t("changesBranchMenu.pull")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isBusy}
                onClick={(event) => {
                  event.preventDefault();
                  handlePush();
                }}
              >
                {t("changesBranchMenu.push")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isBusy}
                onClick={(event) => {
                  event.preventDefault();
                  setCreateBranchOpen(true);
                }}
              >
                {t("changesBranchMenu.createBranch")}
              </DropdownMenuItem>
              {forgeHost === "none" ? null : (
                <DropdownMenuItem
                  disabled={isBusy}
                  onClick={(event) => {
                    event.preventDefault();
                    setCreateRequestOpen(true);
                  }}
                >
                  {requestLabel}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                disabled={isBusy}
                onClick={(event) => {
                  event.preventDefault();
                  setMergeBranchOpen(true);
                }}
              >
                {t("changesBranchMenu.mergeBranch")}
              </DropdownMenuItem>
            </>
          ) : selectedRoot ? (
            <DropdownMenuItem
              disabled={isBusy}
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {t("changesBranchMenu.delete")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <LoadingDialog
        dismissible={false}
        message={loadingMessage}
        open={isBusy}
      />
      {workspacePath ? (
        <CheckoutBranchDialog
          open={checkoutOpen}
          onOpenChange={setCheckoutOpen}
          projectId={projectId}
          workspacePath={workspacePath}
          onSuccess={onSuccess}
        />
      ) : null}
      {workspacePath ? (
        <CreateBranchDialog
          open={createBranchOpen}
          onOpenChange={setCreateBranchOpen}
          projectId={projectId}
          workspacePath={workspacePath}
          onSuccess={onSuccess}
        />
      ) : null}
      {workspacePath && forgeHost !== "none" ? (
        <CreateChangeRequestDialog
          open={createRequestOpen}
          onOpenChange={setCreateRequestOpen}
          projectId={projectId}
          workspacePath={workspacePath}
          host={forgeHost}
        />
      ) : null}
      {workspacePath ? (
        <MergeBranchDialog
          open={mergeBranchOpen}
          onOpenChange={setMergeBranchOpen}
          projectId={projectId}
          workspacePath={workspacePath}
          onSuccess={onSuccess}
        />
      ) : null}
      {confirmationDialog}
      {alertDialog}
    </>
  );
}

function hasRunningTurn(
  sessions: AgentSessionListItem[],
  workspacePath: string,
): boolean {
  return sessions.some(
    (session) =>
      session.workspacePath === workspacePath &&
      session.status === "running" &&
      session.isTurnRunning === true,
  );
}
