import { useState, type ReactNode } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmContent } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { useI18n } from "../../../shared/i18n/i18n";

import type { IssueRecord } from "../issue-commands";
import { readIssueMirror, toBoardRecord } from "../issue-mirror-fields";

export type SyncDeleteHostProvider = "github" | "gitlab";

function syncDeleteHostProvider(
  issue: IssueRecord | null,
): SyncDeleteHostProvider | null {
  if (issue == null) {
    return null;
  }
  const mirror = readIssueMirror(toBoardRecord(issue));
  if (mirror.source !== "remote") {
    return null;
  }
  if (mirror.provider === "github" || mirror.provider === "gitlab") {
    return mirror.provider;
  }
  return null;
}

export function IssueDeleteConfirmDialog({
  open,
  issue,
  cancelLabel,
  confirmLabel,
  message,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  issue: IssueRecord | null;
  cancelLabel: string;
  confirmLabel: string;
  message: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (syncDeleteHost: boolean) => void;
}): ReactNode {
  const { t } = useI18n();
  const provider = syncDeleteHostProvider(issue);
  const [checked, setChecked] = useState(true);
  const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
    if (open) {
      setChecked(true);
    }
  }

  const label =
    provider === "gitlab"
      ? t("issues.syncDeleteGitlab")
      : t("issues.syncDeleteGithub");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ConfirmContent
        body={
          provider == null ? null : (
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                aria-label={label}
                checked={checked}
                onCheckedChange={(value) => setChecked(value === true)}
              />
              <span>{label}</span>
            </div>
          )
        }
        cancelLabel={cancelLabel}
        confirmLabel={confirmLabel}
        confirmVariant="destructive"
        message={message}
        onCancel={() => onOpenChange(false)}
        onConfirm={() => {
          onOpenChange(false);
          onConfirm(provider != null && checked);
        }}
      />
    </Dialog>
  );
}
