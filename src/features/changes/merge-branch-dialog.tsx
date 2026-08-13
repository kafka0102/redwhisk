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
import { useAlertDialog } from "@/components/ui/use-alert-dialog";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
import {
  fetchProjectRemotes,
  listProjectMergeBranches,
  mergeProjectBranch,
  type CheckoutBranchItem,
  type CheckoutBranchKind,
  type ProjectCheckoutBranchesResponse,
} from "../../shared/workspace/workspace-commands";
import { formatBranchRelativeTime } from "./checkout-branch-relative-time";

export interface MergeBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  workspacePath: string;
  /** 合并成功后刷新未提交与已提交列表。 */
  onSuccess?: () => void;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: ProjectCheckoutBranchesResponse }
  | { status: "error"; message: string };

/**
 * 主 checkout「合并分支」选择弹窗：本地/远程两段列表 + 刷新。
 * 点本地分支合入当前分支；远程点选留给后续票。
 */
export function MergeBranchDialog({
  open,
  onOpenChange,
  projectId,
  workspacePath,
  onSuccess,
}: MergeBranchDialogProps) {
  const { t } = useI18n();
  const { alertDialog, showAlert } = useAlertDialog();
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  const resetState = useCallback((): void => {
    setLoadState({ status: "idle" });
    setRefreshing(false);
    setRefreshError(null);
    setMerging(false);
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
    void Promise.resolve().then(async () => {
      if (cancelled) {
        return;
      }
      setLoadState({ status: "loading" });
      setRefreshError(null);
      try {
        const data = await listProjectMergeBranches({
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
    if (refreshing || merging || loadState.status === "loading") {
      return;
    }
    setRefreshing(true);
    setRefreshError(null);
    try {
      await fetchProjectRemotes({ projectId, workspacePath });
      const data = await listProjectMergeBranches({
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

  async function handleSelectLocal(name: string): Promise<void> {
    if (merging || refreshing || loadState.status !== "ready") {
      return;
    }
    const { data } = loadState;
    if (name === data.currentBranch) {
      return;
    }
    if (data.hasUncommittedChanges) {
      showAlert({
        type: "error",
        message: t("changesMerge.dirtyAlert"),
      });
      return;
    }

    setMerging(true);
    try {
      const result = await mergeProjectBranch({
        projectId,
        workspacePath,
        kind: "local",
        name,
      });
      toast.success(
        t("changesMerge.mergeSuccess", {
          branch: name,
          current: result.branch,
        }),
      );
      handleOpenChange(false);
      onSuccess?.();
    } catch (error) {
      showAlert({
        type: "error",
        message: getCommandErrorMessage(error, t),
      });
    } finally {
      setMerging(false);
    }
  }

  const localBranches =
    loadState.status === "ready"
      ? loadState.data.localBranches.filter(
          (branch) => branch.name !== loadState.data.currentBranch,
        )
      : [];
  const remoteBranches =
    loadState.status === "ready" ? loadState.data.remoteBranches : [];

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="flex max-h-[min(80vh,640px)] w-full flex-col gap-3 overflow-hidden sm:max-w-[500px]"
          showCloseButton
        >
          <DialogHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pr-8">
            <DialogTitle>{t("changesMerge.selectBranchTitle")}</DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("changesMerge.refreshRemotes")}
              disabled={refreshing || merging || loadState.status === "loading"}
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

          <div className="min-h-0 flex-1 overflow-y-auto pr-2">
            {loadState.status === "loading" || loadState.status === "idle" ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                {t("changesMerge.loadingBranches")}
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
                  branches={localBranches}
                  emptyLabel={t("changesMerge.emptyLocal")}
                  sectionLabel={t("changesMerge.localSection")}
                  disabled={merging || refreshing}
                  selectable
                  formatRelativeTime={(ms) => formatBranchRelativeTime(ms, t)}
                  formatMeta={(branch) =>
                    t("changesMerge.metaLine", {
                      author: branch.authorName,
                      shortHash: branch.shortHash,
                      message: branch.message,
                    })
                  }
                  onSelect={(branchName) => {
                    void handleSelectLocal(branchName);
                  }}
                />
                <BranchSection
                  kind="remote"
                  branches={remoteBranches}
                  emptyLabel={t("changesMerge.emptyRemote")}
                  sectionLabel={t("changesMerge.remoteSection")}
                  disabled={merging || refreshing}
                  selectable={false}
                  formatRelativeTime={(ms) => formatBranchRelativeTime(ms, t)}
                  formatMeta={(branch) =>
                    t("changesMerge.metaLine", {
                      author: branch.authorName,
                      shortHash: branch.shortHash,
                      message: branch.message,
                    })
                  }
                  onSelect={() => {
                    // 远程合入留给后续票。
                  }}
                />
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <LoadingDialog
        dismissible={false}
        message={t("changesMerge.merging")}
        open={merging}
      />
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
  selectable,
  formatRelativeTime,
  formatMeta,
  onSelect,
}: {
  kind: CheckoutBranchKind;
  branches: CheckoutBranchItem[];
  emptyLabel: string;
  sectionLabel: string;
  disabled: boolean;
  selectable: boolean;
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
            disabled={disabled || !selectable}
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
