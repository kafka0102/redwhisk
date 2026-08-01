import { Cloud, GitBranch, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import {
  fetchProjectRemotes,
  listProjectCheckoutBranches,
  type CheckoutBranchItem,
  type ProjectCheckoutBranchesResponse,
} from "../../shared/workspace/workspace-commands";
import { formatBranchRelativeTime } from "./checkout-branch-relative-time";

export interface CheckoutBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  workspacePath: string;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: ProjectCheckoutBranchesResponse }
  | { status: "error"; message: string };

/**
 * 主 checkout「签出」分支选择弹窗：本地/远程两段列表 + 标题栏刷新（fetch --all --prune）。
 * 本票点击行暂 no-op（签出动作见后续 ticket）。
 */
export function CheckoutBranchDialog({
  open,
  onOpenChange,
  projectId,
  workspacePath,
}: CheckoutBranchDialogProps) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const resetState = useCallback((): void => {
    setLoadState({ status: "idle" });
    setRefreshing(false);
    setRefreshError(null);
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
    if (refreshing || loadState.status === "loading") {
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

  return (
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
            disabled={refreshing || loadState.status === "loading"}
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
                formatRelativeTime={(ms) => formatBranchRelativeTime(ms, t)}
                formatMeta={(branch) =>
                  t("changesCheckout.metaLine", {
                    author: branch.authorName,
                    shortHash: branch.shortHash,
                    message: branch.message,
                  })
                }
              />
              <BranchSection
                kind="remote"
                branches={loadState.data.remoteBranches}
                emptyLabel={t("changesCheckout.emptyRemote")}
                sectionLabel={t("changesCheckout.remoteSection")}
                formatRelativeTime={(ms) => formatBranchRelativeTime(ms, t)}
                formatMeta={(branch) =>
                  t("changesCheckout.metaLine", {
                    author: branch.authorName,
                    shortHash: branch.shortHash,
                    message: branch.message,
                  })
                }
              />
            </div>
          ) : null}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function BranchSection({
  kind,
  branches,
  emptyLabel,
  sectionLabel,
  formatRelativeTime,
  formatMeta,
}: {
  kind: "local" | "remote";
  branches: CheckoutBranchItem[];
  emptyLabel: string;
  sectionLabel: string;
  formatRelativeTime: (committedAt: number) => string;
  formatMeta: (branch: CheckoutBranchItem) => string;
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
            className="hover:bg-accent flex w-full items-start gap-2 rounded-md px-2 py-2 text-left"
            // 本票仅列表：点击 no-op，签出动作留给后续 ticket。
            onClick={() => undefined}
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
                <span className="text-muted-foreground flex shrink-0 items-center gap-2 text-[11px]">
                  <span>{formatRelativeTime(branch.committedAt)}</span>
                  {index === 0 ? (
                    <span className="text-[8px] leading-none">
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
