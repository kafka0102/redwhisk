import type { JSX } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "../../shared/i18n/i18n";
import { hostLabel, isMerged } from "./change-request-detail-model";

export function ChangeRequestDetailHeader({
  number,
  title,
  url,
  provider,
  state,
  showActions,
  pending,
  readySupported,
  reviewSupported,
  onBack,
  onMarkReady,
  onRequestReview,
  onClose,
}: {
  number: number;
  title: string;
  url: string;
  provider: string;
  state: string;
  showActions: boolean;
  pending?: boolean;
  readySupported?: boolean;
  reviewSupported?: boolean;
  onBack: () => void;
  onMarkReady?: () => void;
  onRequestReview?: () => void;
  onClose?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const host = hostLabel(provider);
  const readyDisabled =
    pending === true || state !== "draft" || readySupported !== true;
  const reviewDisabled = pending === true || reviewSupported !== true;
  const closeDisabled = pending === true || state !== "open";
  const actionsVisible = showActions && !isMerged(state);
  return (
    <header className="change-request-detail__header">
      <div className="change-request-detail__heading">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("issues.changeRequests.back")}
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.9} />
        </Button>
        <h2>{`#${number} · ${title}`}</h2>
      </div>
      <div className="change-request-detail__actions">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            void openUrl(url);
          }}
        >
          {t("issues.changeRequests.openOnHost", { host })}
        </Button>
        {actionsVisible ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={readyDisabled}
              onClick={() => {
                if (!readyDisabled) {
                  onMarkReady?.();
                }
              }}
            >
              {t("issues.changeRequests.markReady")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={reviewDisabled}
              onClick={() => {
                if (!reviewDisabled) {
                  onRequestReview?.();
                }
              }}
            >
              {t("issues.changeRequests.requestReview")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={closeDisabled}
              onClick={() => {
                if (!closeDisabled) {
                  onClose?.();
                }
              }}
            >
              {t("issues.changeRequests.close")}
            </Button>
          </>
        ) : null}
      </div>
    </header>
  );
}
