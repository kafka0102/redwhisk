import type { JSX } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "../../shared/i18n/i18n";
import type { ChangeRequestActionDialog } from "./use-change-request-actions";

export function ChangeRequestActionDialogs({
  dialog,
  error,
  reviewer,
  onReviewerChange,
  onCancel,
  onSubmitReview,
  onConfirmClose,
}: {
  dialog: ChangeRequestActionDialog;
  error: string | null;
  reviewer: string;
  onReviewerChange: (reviewer: string) => void;
  onCancel: () => void;
  onSubmitReview: () => void;
  onConfirmClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const message = (): JSX.Element | null =>
    error == null ? null : <p role="alert">{error}</p>;
  return (
    <>
      <Dialog
        open={dialog === "review"}
        onOpenChange={(open) => {
          if (!open) {
            onCancel();
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {t("issues.changeRequests.requestReviewTitle")}
            </DialogTitle>
          </DialogHeader>
          <label htmlFor="change-request-reviewer">
            {t("issues.changeRequests.reviewerLabel")}
          </label>
          <Input
            id="change-request-reviewer"
            value={reviewer}
            onChange={(event) => {
              onReviewerChange(event.target.value);
            }}
          />
          {message()}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t("issues.changeRequests.cancel")}
            </Button>
            <Button type="button" onClick={onSubmitReview}>
              {t("issues.changeRequests.requestReview")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === "close"}
        onOpenChange={(open) => {
          if (!open) {
            onCancel();
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {t("issues.changeRequests.closeConfirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("issues.changeRequests.closeConfirmBody")}
            </DialogDescription>
          </DialogHeader>
          {message()}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t("issues.changeRequests.cancel")}
            </Button>
            <Button type="button" onClick={onConfirmClose}>
              {t("issues.changeRequests.closeConfirmAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
