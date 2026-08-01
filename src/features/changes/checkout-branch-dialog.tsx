import { Cloud, GitBranch, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingDialog } from "@/components/ui/loading-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAlertDialog } from "@/components/ui/use-alert-dialog";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
import {
  checkoutProjectBranch,
  fetchProjectRemotes,
  listProjectCheckoutBranches,
  type CheckoutBranchItem,
  type CheckoutBranchKind,
  type ProjectCheckoutBranchesResponse,
} from "../../shared/workspace/workspace-commands";
import { formatBranchRelativeTime } from "./checkout-branch-relative-time";

export interface CheckoutBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  workspacePath: string;
  /** 签出成功后刷新变更列表 / 分支根。 */
  onSuccess?: () => void;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: ProjectCheckoutBranchesResponse }
  | { status: "error"; message: string };

/**
 * 主 checkout「签出」分支选择弹窗：本地/远程两段列表 + 刷新 + 点击签出。
 */
export function CheckoutBranchDialog({
  open,
  onOpenChange,
  projectId,
  workspacePath,
  onSuccess,
}: CheckoutBranchDialogProps) {
  const { t } = useI18n();
  const { alertDialog, showAlert } = useAlertDialog();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  const resetState = useCallback((): void => {
    setLoadState({ status: "idle" });
    setRefreshing(false);
    setRefreshError(null);
    setCheckingOut(false);
  }, []);

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) {
      resetState();
    }
    onOpenChange(nextOpen);
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    // setState 放进微任务，避免 react-hooks/set-state-in-effect。
    void Promise.resolve().then(async () => {
      if (cancelled) {
        return;
      }
      setLoadState({ status: "loading" });
      setRefreshError(null);
      try {
        const data = await listProjectCheckoutBranches({
          projectId,
          workspacePath,
        });
        if (!cancelled) {
          setLoadState({ status: "ready", data });
        }
      } catch (error) {
        if (!cancelled) {
          setLoadState({
            status: "error",
            message: getCommandErrorMessage(error, t),
          });
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, t, workspacePath]);

  async function handleRefresh(): Promise<void> {
    if (refreshing || checkingOut || loadState.status === "loading") {
      return;
    }
    setRefreshing(true);
    setRefreshError(null);
    try {
      await fetchProjectRemotes({ projectId, workspacePath });
      const data = await listProjectCheckoutBranches({
        projectId,
        workspacePath,
      });
      setLoadState({ status: "ready", data });
    } catch (error) {
      setRefreshError(getCommandErrorMessage(error, t));
    } finally {
      setRefreshing(false);
    }
  }

  function isCurrentTarget(
    kind: CheckoutBranchKind,
    name: string,
    currentBranch: string,
  ): boolean {
    if (kind === "local") {
      return name === currentBranch;
    }
    const short = name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
    return short === currentBranch;
  }

  async function handleSelectBranch(
    kind: CheckoutBranchKind,
    name: string,
  ): Promise<void> {
    if (checkingOut || refreshing || loadState.status !== "ready") {
      return;
    }
    const { data } = loadState;

    if (isCurrentTarget(kind, name, data.currentBranch)) {
      handleOpenChange(false);
      return;
    }

    if (data.hasUncommittedChanges) {
      const confirmed = await confirm({
        title: t("changesCheckout.dirtyConfirmTitle"),
        message: t("changesCheckout.dirtyConfirm"),
        confirmLabel: t("changesCheckout.dirtyConfirmAction"),
        cancelLabel: t("confirmDialog.cancel"),
      });
      if (!confirmed) {
        return;
      }
    }

    setCheckingOut(true);
    try {
      const result = await checkoutProjectBranch({
        projectId,
        workspacePath,
        kind,
        name,
      });
      toast.success(
        t("changesCheckout.checkoutSuccess", { branch: result.branch }),
      );
      handleOpenChange(false);
      onSuccess?.();
    } catch (error) {
      showAlert({
        type: "error",
        message: getCommandErrorMessage(error, t),
      });
    } finally {
      setCheckingOut(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="flex max-h-[min(80vh,640px)] w-full flex-col gap-3 sm:max-w-[500px]"
          showCloseButton
        >
          <DialogHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pr-8">
            <DialogTitle>{t("changesCheckout.selectBranchTitle")}</DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("changesCheckout.refreshRemotes")}
              disabled={
                refreshing || checkingOut || loadState.status === "loading"
              }
              onClick={() => {
                void handleRefresh();
              }}
            >
              {refreshing ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin"
                  size={14}
                  strokeWidth={1.8}
                />
              ) : (
                <RefreshCw aria-hidden="true" size={14} strokeWidth={1.8} />
              )}
            </Button>
          </DialogHeader>

          {refreshError ? (
            <p className="text-destructive text-xs" role="alert">
              {refreshError}
            </p>
          ) : null}

          <ScrollArea className="min-h-0 flex-1 pr-2">
            {loadState.status === "loading" || loadState.status === "idle" ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                {t("changesCheckout.loadingBranches")}
              </p>
            ) : null}
            {loadState.status === "error" ? (
              <p
                className="text-destructive py-8 text-center text-sm"
                role="alert"
              >
                {loadState.message}
              </p>
            ) : null}
            {loadState.status === "ready" ? (
              <div className="flex flex-col gap-1 pb-1">
                <BranchSection
                  kind="local"
                  branches={loadState.data.localBranches}
                  emptyLabel={t("changesCheckout.emptyLocal")}
                  sectionLabel={t("changesCheckout.localSection")}
                  disabled={checkingOut || refreshing}
                  formatRelativeTime={(ms) => formatBranchRelativeTime(ms, t)}
                  formatMeta={(branch) =>
                    t("changesCheckout.metaLine", {
                      author: branch.authorName,
                      shortHash: branch.shortHash,
                      message: branch.message,
                    })
                  }
                  onSelect={(branchName) => {
                    void handleSelectBranch("local", branchName);
                  }}
                />
                <BranchSection
                  kind="remote"
                  branches={loadState.data.remoteBranches}
                  emptyLabel={t("changesCheckout.emptyRemote")}
                  sectionLabel={t("changesCheckout.remoteSection")}
                  disabled={checkingOut || refreshing}
                  formatRelativeTime={(ms) => formatBranchRelativeTime(ms, t)}
                  formatMeta={(branch) =>
                    t("changesCheckout.metaLine", {
                      author: branch.authorName,
                      shortHash: branch.shortHash,
                      message: branch.message,
                    })
                  }
                  onSelect={(branchName) => {
                    void handleSelectBranch("remote", branchName);
                  }}
                />
              </div>
            ) : null}
          </ScrollArea>
        </DialogContent>
      </Dialog>
      <LoadingDialog
        dismissible={false}
        message={t("changesCheckout.checkingOut")}
        open={checkingOut}
      />
      {confirmationDialog}
      {alertDialog}
    </>
  );
}

function BranchSection({
  kind,
  branches,
  emptyLabel,
  sectionLabel,
  disabled,
  formatRelativeTime,
  formatMeta,
  onSelect,
}: {
  kind: CheckoutBranchKind;
  branches: CheckoutBranchItem[];
  emptyLabel: string;
  sectionLabel: string;
  disabled: boolean;
  formatRelativeTime: (committedAt: number) => string;
  formatMeta: (branch: CheckoutBranchItem) => string;
  onSelect: (name: string) => void;
}) {
  if (branches.length === 0) {
    return (
      <div className="px-1 py-3">
        <p className="text-muted-foreground text-xs">{emptyLabel}</p>
      </div>
    );
  }

  const Icon = kind === "local" ? GitBranch : Cloud;

  return (
    <ul className="flex flex-col">
      {branches.map((branch, index) => (
        <li key={`${kind}-${branch.name}`}>
          <button
            type="button"
            className="hover:bg-accent flex w-full items-start gap-2 rounded-md px-2 py-2 text-left disabled:opacity-50"
            disabled={disabled}
            onClick={() => {
              onSelect(branch.name);
            }}
          >
            <Icon
              aria-hidden="true"
              className="text-muted-foreground mt-0.5 shrink-0"
              size={14}
              strokeWidth={1.8}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-start justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {branch.name}
                </span>
                <span className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs">
                  <span>{formatRelativeTime(branch.committedAt)}</span>
                  {index === 0 ? (
                    <span className="text-muted-foreground/80">
                      {sectionLabel}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                {formatMeta(branch)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
