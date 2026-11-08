import { useRef, useState } from "react";

import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import {
  closeChangeRequest,
  markChangeRequestReady,
  requestChangeRequestReview,
  type ChangeRequestDetail,
} from "./change-request-commands";

export type ChangeRequestActionDialog = "review" | "close" | null;

export function useChangeRequestActions({
  projectId,
  provider,
  number,
  detail,
  setDetail,
}: {
  projectId: number;
  provider: string;
  number: number;
  detail: ChangeRequestDetail;
  setDetail: (detail: ChangeRequestDetail) => void;
}): {
  pending: boolean;
  error: string | null;
  dialog: ChangeRequestActionDialog;
  reviewer: string;
  setReviewer: (reviewer: string) => void;
  markReady: () => void;
  openReview: () => void;
  openClose: () => void;
  cancel: () => void;
  submitReview: () => void;
  confirmClose: () => void;
} {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ChangeRequestActionDialog>(null);
  const [reviewer, setReviewer] = useState("");
  const pendingRef = useRef(false);

  const run = (task: () => Promise<ChangeRequestDetail>): void => {
    if (pendingRef.current) {
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    void task()
      .then((next) => {
        setDetail(next);
        setDialog(null);
        setReviewer("");
      })
      .catch((caught: unknown) => {
        setError(getCommandErrorMessage(caught, t));
      })
      .finally(() => {
        pendingRef.current = false;
        setPending(false);
      });
  };

  return {
    pending,
    error,
    dialog,
    reviewer,
    setReviewer,
    markReady: () => {
      if (pending || detail.state !== "draft" || !detail.readySupported) {
        return;
      }
      run(() => markChangeRequestReady({ projectId, provider, number }));
    },
    openReview: () => {
      if (pending || !detail.reviewSupported) {
        return;
      }
      setError(null);
      setDialog("review");
    },
    openClose: () => {
      if (pending || detail.state !== "open") {
        return;
      }
      setError(null);
      setDialog("close");
    },
    cancel: () => {
      setDialog(null);
      setReviewer("");
    },
    submitReview: () => {
      const login = reviewer.trim();
      if (login.length === 0) {
        setError(
          t("errors.ISSUE_VALIDATION_FAILED.changeRequestReviewerMissing"),
        );
        return;
      }
      run(() =>
        requestChangeRequestReview({
          projectId,
          provider,
          number,
          reviewer: login,
        }),
      );
    },
    confirmClose: () => {
      if (pending || detail.state !== "open") {
        return;
      }
      run(() => closeChangeRequest({ projectId, provider, number }));
    },
  };
}
