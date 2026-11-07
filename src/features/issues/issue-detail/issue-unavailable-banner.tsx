import { Button } from "@/components/ui/button";

import { useI18n } from "../../../shared/i18n/i18n";
import type { RecoveryAction } from "./issue-detail-commands";

interface IssueUnavailableBannerProps {
  actions: RecoveryAction[];
  onAction: (action: RecoveryAction) => void;
}

export function IssueUnavailableBanner({
  actions,
  onAction,
}: IssueUnavailableBannerProps) {
  const { t } = useI18n();
  const labels: Record<RecoveryAction, string> = {
    keep_local: t("issues.unavailableKeepLocal"),
    unlink: t("issues.unavailableUnlink"),
    retry: t("issues.unavailableRetry"),
  };

  return (
    <div className="issue-unavailable-banner" role="status">
      <p>{t("issues.unavailableBanner")}</p>
      <div className="issue-unavailable-banner__actions">
        {actions.map((action) => (
          <Button
            key={action}
            className="issues-button"
            type="button"
            variant="secondary"
            onClick={() => onAction(action)}
          >
            {labels[action]}
          </Button>
        ))}
      </div>
    </div>
  );
}
