import type { ReactElement } from "react";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { useI18n } from "../../shared/i18n/i18n";
import type { IssueSourceMode } from "./issue-source-commands";

interface IssueSourceModeConfirmDialogProps {
  targetMode: IssueSourceMode | null;
  localIssueCount: number;
  remoteIssueCount: number;
  repoPath: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function IssueSourceModeConfirmDialog({
  targetMode,
  localIssueCount,
  remoteIssueCount,
  repoPath,
  onCancel,
  onConfirm,
}: IssueSourceModeConfirmDialogProps): ReactElement {
  const { t } = useI18n();
  const modeLabel =
    targetMode === null
      ? ""
      : t(`settings.issueSource.confirmMode.${targetMode}`);
  const localText =
    targetMode === null
      ? ""
      : countText(t, targetMode === "remote", localIssueCount);
  const remoteText =
    targetMode === null
      ? ""
      : countText(t, targetMode === "local", remoteIssueCount);
  const syncText =
    targetMode === null ? "" : syncTextFor(t, targetMode, repoPath);

  return (
    <Dialog
      open={targetMode !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {t("settings.issueSource.confirmTitle", { mode: modeLabel })}
          </DialogTitle>
        </DialogHeader>
        {targetMode !== null ? (
          <ul className="grid gap-2">
            <li>
              {t("settings.issueSource.confirmLocalLabel")} {localText}
            </li>
            <li>
              {t("settings.issueSource.confirmRemoteLabel")} {remoteText}
            </li>
            <li>
              {t("settings.issueSource.confirmSyncLabel")} {syncText}
            </li>
          </ul>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("settings.issueSource.confirmCancel")}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {t("settings.issueSource.confirmSwitch")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function countText(
  t: ReturnType<typeof useI18n>["t"],
  hidden: boolean,
  count: number,
): string {
  return t(
    hidden
      ? "settings.issueSource.confirmHidden"
      : "settings.issueSource.confirmShown",
    { count },
  );
}

function syncTextFor(
  t: ReturnType<typeof useI18n>["t"],
  targetMode: IssueSourceMode,
  repoPath: string | null,
): string {
  if (targetMode === "local") {
    return t("settings.issueSource.confirmSyncLocal");
  }
  const repo = repoPath?.trim() ?? "";
  if (repo.length === 0) {
    return t("settings.issueSource.confirmSyncUnknown");
  }
  return t("settings.issueSource.confirmSyncAccess", { repo });
}
