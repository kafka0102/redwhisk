import { useEffect, useState, type JSX } from "react";

import {
  ChangeRequestDetailPage,
  type ChangeRequestDetailListRow,
} from "./change-request-detail";
import { ChangeRequestList } from "./change-request-list";
import {
  useChangeRequestData,
  type ChangeRequestData,
} from "./use-change-request-data";
import { useI18n } from "../../shared/i18n/i18n";
import type { ForgeProvider } from "../settings/issue-source-commands";

export function ChangeRequestPanel({
  projectId,
  sourceMode,
  provider = null,
  onOpenProjectSettings,
  onDetailOpenChange,
  openDetail,
  onOpenDetailConsumed,
  onOpenLinkedIssue,
  data: suppliedData,
}: {
  projectId: number;
  sourceMode: "local" | "remote" | "mixed" | null;
  provider?: ForgeProvider | null;
  onOpenProjectSettings?: () => void;
  onDetailOpenChange?: (open: boolean) => void;
  openDetail?: { provider: string; number: number } | null;
  onOpenDetailConsumed?: () => void;
  onOpenLinkedIssue?: (issueId: number) => void;
  data?: ChangeRequestData;
}): JSX.Element | null {
  const { t } = useI18n();
  const internalData = useChangeRequestData({
    enabled: suppliedData == null,
    projectId,
    sourceMode,
  });
  const data = suppliedData ?? internalData;
  const [selected, setSelected] = useState<{
    provider: string;
    number: number;
    listRow: ChangeRequestDetailListRow;
  } | null>(null);
  const [now] = useState(Date.now);

  useEffect(() => {
    onDetailOpenChange?.(selected != null || openDetail != null);
  }, [onDetailOpenChange, openDetail, selected]);

  const activeDetail = selected ?? openDetail ?? null;

  if (activeDetail != null) {
    return (
      <ChangeRequestDetailPage
        key={`${activeDetail.provider}:${activeDetail.number}`}
        number={activeDetail.number}
        projectId={projectId}
        provider={activeDetail.provider}
        listRow={selected?.listRow}
        onBack={() => {
          setSelected(null);
          onOpenDetailConsumed?.();
        }}
        onOpenIssue={(issueId) => {
          setSelected(null);
          onOpenDetailConsumed?.();
          onOpenLinkedIssue?.(issueId);
        }}
      />
    );
  }

  return (
    <ChangeRequestList
      filter={data.filter}
      now={now}
      response={data.response}
      sourceMode={sourceMode}
      provider={provider}
      syncSlot={
        data.syncError == null ? null : (
          <p role="status">{t("issues.syncCacheFailed")}</p>
        )
      }
      onFilterChange={data.selectFilter}
      onOpenDetail={(row) =>
        setSelected({
          provider: row.provider,
          number: row.number,
          listRow: {
            number: row.number,
            title: row.title,
            url: row.url,
            provider: row.provider,
            state: row.state,
          },
        })
      }
      onOpenProjectSettings={onOpenProjectSettings}
    />
  );
}
