import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingDialog } from "@/components/ui/loading-dialog";
import { useAlertDialog } from "@/components/ui/use-alert-dialog";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
import { createProjectBranch } from "../../shared/workspace/workspace-commands";

export interface CreateBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  workspacePath: string;
  /** 创建并签出成功后刷新变更列表 / 分支根。 */
  onSuccess?: () => void;
}

/**
 * 主 checkout「创建分支」对话框：单字段分支名，确定后 `git checkout -b`。
 * 无前端校验；空名/非法名由后端 Git 报错。
 */
export function CreateBranchDialog({
  open,
  onOpenChange,
  projectId,
  workspacePath,
  onSuccess,
}: CreateBranchDialogProps) {
  const { t } = useI18n();
  const { alertDialog, showAlert } = useAlertDialog();
  const [branchName, setBranchName] = useState("");
  const [creating, setCreating] = useState(false);

  function resetState(): void {
    setBranchName("");
    setCreating(false);
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (creating) {
      return;
    }
    if (!nextOpen) {
      resetState();
    }
    onOpenChange(nextOpen);
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (creating) {
      return;
    }
    setCreating(true);
    try {
      const result = await createProjectBranch({
        projectId,
        workspacePath,
        name: branchName,
      });
      toast.success(
        t("changesCreateBranch.createSuccess", { branch: result.branch }),
      );
      setBranchName("");
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      showAlert({
        type: "error",
        message: getCommandErrorMessage(error, t),
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="w-full gap-4 sm:max-w-[400px]"
          showCloseButton={!creating}
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("changesCreateBranch.title")}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="create-branch-name" className="sr-only">
                {t("changesCreateBranch.branchNameLabel")}
              </Label>
              <Input
                id="create-branch-name"
                autoFocus
                disabled={creating}
                value={branchName}
                placeholder={t("changesCreateBranch.branchNamePlaceholder")}
                onChange={(event) => setBranchName(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={creating}
                onClick={() => handleOpenChange(false)}
              >
                {t("changesCreateBranch.cancel")}
              </Button>
              <Button type="submit" disabled={creating}>
                {t("changesCreateBranch.confirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <LoadingDialog
        dismissible={false}
        message={t("changesCreateBranch.creating")}
        open={creating}
      />
      {alertDialog}
    </>
  );
}
