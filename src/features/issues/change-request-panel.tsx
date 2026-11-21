import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import {
  CHANGE_REQUEST_SYNC_CHANGED_EVENT,
  listProjectChangeRequests,
  syncProjectChangeRequests,
  type ChangeRequestFilter,
  type ChangeRequestListResponse,
  type ChangeRequestSyncChangedEvent,
} from "./change-request-commands";
import {
  ChangeRequestDetailPage,
  type ChangeRequestDetailListRow,
} from "./change-request-detail";
import { ChangeRequestList } from "./change-request-list";
import {
  useIssueAutoSync,
  usePageVisible,
  type AutoSyncResult,
} from "./use-issue-auto-sync";
import { useI18n } from "../../shared/i18n/i18n";
import { subscribeTauriEvent } from "../../shared/tauri-event/use-tauri-event";
import { useWindowFocus } from "../../shared/window/use-window-focus";
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
}: {
  projectId: number;
  sourceMode: "local" | "remote" | "mixed" | null;
  provider?: ForgeProvider | null;
  onOpenProjectSettings?: () => void;
  onDetailOpenChange?: (open: boolean) => void;
  openDetail?: { provider: string; number: number } | null;
  onOpenDetailConsumed?: () => void;
  onOpenLinkedIssue?: (issueId: number) => void;
}): JSX.Element | null {
  const { t } = useI18n();
  const [filter, setFilter] = useState<ChangeRequestFilter>("open");
  const [selected, setSelected] = useState<{
    provider: string;
    number: number;
    listRow: ChangeRequestDetailListRow;
  } | null>(null);
  const [response, setResponse] = useState<ChangeRequestListResponse | null>(
    null,
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const [now] = useState(Date.now);
  const pageVisible = usePageVisible();
  const windowFocused = useWindowFocus();
  const syncingRef = useRef(false);
  const listRequestIdRef = useRef(0);
  const filterRef = useRef(filter);
  const canSync = sourceMode === "remote" || sourceMode === "mixed";
  const selectFilter = useCallback((nextFilter: ChangeRequestFilter) => {
    filterRef.current = nextFilter;
    setFilter(nextFilter);
  }, []);

  const loadList = useCallback(
    async (nextFilter: ChangeRequestFilter) => {
      const requestId = listRequestIdRef.current + 1;
      listRequestIdRef.current = requestId;
      const next = await listProjectChangeRequests({
        projectId,
        filter: nextFilter,
      });
      if (requestId !== listRequestIdRef.current) {
        return;
      }
      setResponse(next);
    },
    [projectId],
  );

  useEffect(() => {
    if (!canSync) {
      return;
    }
    void loadList(filter).catch(() => {});
    return () => {
      listRequestIdRef.current += 1;
    };
  }, [canSync, filter, loadList]);

  const reload = useCallback(async () => {
    await loadList(filterRef.current);
  }, [loadList]);

  const runSync = useCallback(async (): Promise<AutoSyncResult> => {
    if (syncingRef.current) {
      return "skipped";
    }
    syncingRef.current = true;
    try {
      const result = await syncProjectChangeRequests(projectId);
      if (
        result.outcome === "cache_failed" ||
        result.outcome === "credential_expired"
      ) {
        setSyncError(result.errorCode ?? result.outcome);
        return "failed";
      }
      setSyncError(null);
      await reload();
      return result.outcome === "synced" ? "synced" : "skipped";
    } catch {
      setSyncError("cache_failed");
      return "failed";
    } finally {
      syncingRef.current = false;
    }
  }, [projectId, reload]);

  useIssueAutoSync({
    isActive: canSync && pageVisible && windowFocused,
    intervalSeconds: 60,
    runSync,
  });

  useEffect(() => {
    return subscribeTauriEvent<ChangeRequestSyncChangedEvent>(
      CHANGE_REQUEST_SYNC_CHANGED_EVENT,
      (payload) => {
        if (payload.projectId !== projectId) {
          return;
        }
        void reload();
      },
    );
  }, [projectId, reload]);

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
      filter={filter}
      now={now}
      response={response}
      sourceMode={sourceMode}
      provider={provider}
      syncSlot={
        syncError == null ? null : (
          <p role="status">{t("issues.syncCacheFailed")}</p>
        )
      }
      onFilterChange={selectFilter}
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
