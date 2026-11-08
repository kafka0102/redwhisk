import type { JSX } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import type { ChangeRequestDetail } from "./change-request-commands";
import type { ChangeRequestDetailTab } from "./change-request-detail-model";
import { discussionsOf } from "./change-request-detail-model";

export function ChangeRequestDetailTabs({
  detail,
  tab,
  onTabChange,
}: {
  detail: ChangeRequestDetail;
  tab: ChangeRequestDetailTab;
  onTabChange: (tab: ChangeRequestDetailTab) => void;
}): JSX.Element {
  const { t } = useI18n();
  const discussionCount = discussionsOf(detail).length;
  const items: Array<{ id: ChangeRequestDetailTab; label: string }> = [
    { id: "overview", label: t("issues.changeRequests.overviewTab") },
    {
      id: "files",
      label: tabLabel(
        t("issues.changeRequests.filesTab"),
        t("issues.changeRequests.filesTabCount", {
          count: detail.files.length,
        }),
        detail.files.length,
      ),
    },
    {
      id: "checks",
      label: tabLabel(
        t("issues.changeRequests.checksTab"),
        t("issues.changeRequests.checksTabCount", {
          count: detail.checks.length,
        }),
        detail.checks.length,
      ),
    },
    {
      id: "discussion",
      label: tabLabel(
        t("issues.changeRequests.discussionTab"),
        t("issues.changeRequests.discussionTabCount", {
          count: discussionCount,
        }),
        discussionCount,
      ),
    },
  ];
  return (
    <div className="change-request-detail__tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          className="change-request-detail__tab"
          aria-selected={tab === item.id}
          onClick={() => onTabChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function tabLabel(plain: string, counted: string, count: number): string {
  return count > 0 ? counted : plain;
}
