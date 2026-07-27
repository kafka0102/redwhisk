import { useCallback, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmContent } from "@/components/ui/confirm-dialog";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { LoadingDialog } from "@/components/ui/loading-dialog";
import { useAlertDialog } from "@/components/ui/use-alert-dialog";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
import {
  dismissSyncConfirm,
  isSyncConfirmDismissed,
  resolveSyncActions,
  resolveSyncConfirmDirection,
  type SyncRemoteAction,
} from "../../shared/workspace/sync-changes";
import {
  pullProjectWorktree,
  pushProjectWorktree,
  type BranchSyncStatus,
} from "../../shared/workspace/workspace-commands";

export interface UseSyncChangesActionOptions {
  projectId: number;
  workspacePath: string | null;
  onSuccess?: () => void;
}

type BusyPhase = SyncRemoteAction | "sync" | null;

interface PendingConfirm {
  branchSync: BranchSyncStatus;
}

/**
 * 变更 Activity「同步更改」确认与执行：
 * 仅 behind→pull；仅 ahead→push；双向先 pull 后 push，失败即停。
 * 确认三键 footer；localStorage 可全局跳过后续确认。
 */
export function useSyncChangesAction({
  projectId,
  workspacePath,
  onSuccess,
}: UseSyncChangesActionOptions): {
  requestSync: (branchSync: BranchSyncStatus) => void;
  isBusy: boolean;
  dialogs: ReactNode;
} {
  const { t } = useI18n();
  const { alertDialog, showAlert } = useAlertDialog();
  const [busyPhase, setBusyPhase] = useState<BusyPhase>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
    null,
  );

  const isBusy = busyPhase !== null;

  const runSync = useCallback(
    async (branchSync: BranchSyncStatus) => {
      if (!workspacePath || isBusy) {
        return;
      }
      const actions = resolveSyncActions(branchSync);
      if (actions.length === 0) {
        return;
      }

      const isBoth = actions.length === 2;
      if (isBoth) {
        setBusyPhase("sync");
      }

      let completedAny = false;
      try {
        for (const action of actions) {
          if (!isBoth) {
            setBusyPhase(action);
          }
          if (action === "pull") {
            await pullProjectWorktree({ projectId, workspacePath });
          } else {
            await pushProjectWorktree({ projectId, workspacePath });
          }
          completedAny = true;
        }

        if (isBoth) {
          toast.success(t("changesSync.syncSuccess"));
        } else if (actions[0] === "pull") {
          toast.success(t("changesSync.pullSuccess"));
        } else {
          toast.success(t("changesSync.pushSuccess"));
        }
        onSuccess?.();
      } catch (error) {
        // 双向时 pull 成功 push 失败：仍刷新已发生的变更，仅报后续错误。
        if (completedAny) {
          onSuccess?.();
        }
        showAlert({
          type: "error",
          message: getCommandErrorMessage(error, t),
        });
      } finally {
        setBusyPhase(null);
      }
    },
    [isBusy, onSuccess, projectId, showAlert, t, workspacePath],
  );

  const requestSync = useCallback(
    (branchSync: BranchSyncStatus) => {
      if (!workspacePath || isBusy) {
        return;
      }
      if (resolveSyncActions(branchSync).length === 0) {
        return;
      }
      if (isSyncConfirmDismissed()) {
        void runSync(branchSync);
        return;
      }
      setPendingConfirm({ branchSync });
    },
    [isBusy, runSync, workspacePath],
  );

  const closeConfirm = useCallback(() => {
    setPendingConfirm(null);
  }, []);

  const confirmMessage = (() => {
    if (pendingConfirm == null) {
      return "";
    }
    const direction = resolveSyncConfirmDirection(pendingConfirm.branchSync);
    const upstream = pendingConfirm.branchSync.upstream;
    if (direction === "both") {
      return t("changesSync.confirmBoth", { upstream });
    }
    if (direction === "pull") {
      return t("changesSync.confirmPull", { upstream });
    }
    if (direction === "push") {
      return t("changesSync.confirmPush", { upstream });
    }
    return "";
  })();

  const loadingMessage =
    busyPhase === "sync"
      ? t("changesSync.syncing")
      : busyPhase === "pull"
        ? t("changesSync.pulling")
        : busyPhase === "push"
          ? t("changesSync.pushing")
          : "";

  const dialogs = (
    <>
      <LoadingDialog
        dismissible={false}
        message={loadingMessage}
        open={isBusy}
      />
      {pendingConfirm ? (
        <Dialog
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              closeConfirm();
            }
          }}
        >
          <ConfirmContent
            message={confirmMessage}
            title={t("changesSync.confirmTitle")}
            footer={
              <DialogFooter className="sm:justify-end">
                <Button
                  type="button"
                  onClick={() => {
                    const { branchSync } = pendingConfirm;
                    closeConfirm();
                    void runSync(branchSync);
                  }}
                >
                  {t("changesSync.confirm")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    const { branchSync } = pendingConfirm;
                    dismissSyncConfirm();
                    closeConfirm();
                    void runSync(branchSync);
                  }}
                >
                  {t("changesSync.confirmAndDismiss")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={closeConfirm}
                >
                  {t("changesSync.cancel")}
                </Button>
              </DialogFooter>
            }
          />
        </Dialog>
      ) : null}
      {alertDialog}
    </>
  );

  return { requestSync, isBusy, dialogs };
}
