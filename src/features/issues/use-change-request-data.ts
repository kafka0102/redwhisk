import { useCallback, useEffect, useRef, useState } from "react";

import { subscribeTauriEvent } from "../../shared/tauri-event/use-tauri-event";
import { useWindowFocus } from "../../shared/window/use-window-focus";
import {
  CHANGE_REQUEST_SYNC_CHANGED_EVENT,
  listProjectChangeRequests,
  syncProjectChangeRequests,
  type ChangeRequestFilter,
  type ChangeRequestListResponse,
  type ChangeRequestSyncChangedEvent,
} from "./change-request-commands";
import {
  useIssueAutoSync,
  usePageVisible,
  type AutoSyncResult,
} from "./use-issue-auto-sync";

export interface ChangeRequestData {
  filter: ChangeRequestFilter;
  response: ChangeRequestListResponse | null;
  syncError: string | null;
  syncing: boolean;
  selectFilter: (filter: ChangeRequestFilter) => void;
  reload: () => Promise<void>;
  runSync: () => Promise<AutoSyncResult>;
  noteManualResult: (result: AutoSyncResult) => void;
}

export function useChangeRequestData({
  autoSyncEnabled = true,
  enabled = true,
  projectId,
  sourceMode,
}: {
  autoSyncEnabled?: boolean;
  enabled?: boolean;
  projectId: number;
  sourceMode: "local" | "remote" | "mixed" | null;
}): ChangeRequestData {
  const [filter, setFilter] = useState<ChangeRequestFilter>("open");
  const [response, setResponse] = useState<ChangeRequestListResponse | null>(
    null,
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const filterRef = useRef<ChangeRequestFilter>(filter);
  const requestIdRef = useRef(0);
  const inFlightListRef = useRef<{
    filter: ChangeRequestFilter;
    needsReload: boolean;
    promise: Promise<void>;
  } | null>(null);
  const loadListRef = useRef<(filter: ChangeRequestFilter) => Promise<void>>(
    () => Promise.resolve(),
  );
  const syncingRef = useRef(false);
  const pageVisible = usePageVisible();
  const windowFocused = useWindowFocus();
  const canSync =
    enabled && (sourceMode === "remote" || sourceMode === "mixed");

  const loadList = useCallback(
    (nextFilter: ChangeRequestFilter): Promise<void> => {
      const inFlight = inFlightListRef.current;
      if (inFlight?.filter === nextFilter) {
        inFlight.needsReload = true;
        return inFlight.promise;
      }
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const promise = listProjectChangeRequests({
        projectId,
        filter: nextFilter,
      }).then((next) => {
        if (requestId === requestIdRef.current) {
          setResponse(next);
        }
      });
      const entry = {
        filter: nextFilter,
        needsReload: false,
        promise,
      };
      inFlightListRef.current = entry;
      const finish = () => {
        if (inFlightListRef.current === entry) {
          inFlightListRef.current = null;
          if (entry.needsReload && filterRef.current === entry.filter) {
            void loadListRef.current(entry.filter).catch(() => undefined);
          }
        }
      };
      void promise.then(finish, finish);
      return promise;
    },
    [projectId],
  );

  useEffect(() => {
    loadListRef.current = loadList;
  }, [loadList]);

  const reload = useCallback(
    (): Promise<void> => loadList(filterRef.current),
    [loadList],
  );

  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  useEffect(() => {
    if (!canSync) {
      requestIdRef.current += 1;
      inFlightListRef.current = null;
      return;
    }
    void loadList(filter).catch(() => undefined);
    return () => {
      requestIdRef.current += 1;
      inFlightListRef.current = null;
    };
  }, [canSync, filter, loadList]);

  const runSync = useCallback(async (): Promise<AutoSyncResult> => {
    if (!canSync) {
      return "skipped";
    }
    if (syncingRef.current) {
      return "skipped";
    }
    syncingRef.current = true;
    setSyncing(true);
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
      setSyncing(false);
    }
  }, [canSync, projectId, reload]);

  const { noteManualResult } = useIssueAutoSync({
    isActive: autoSyncEnabled && canSync && pageVisible && windowFocused,
    intervalSeconds: 60,
    runSync,
  });

  const selectFilter = useCallback((nextFilter: ChangeRequestFilter) => {
    filterRef.current = nextFilter;
    setFilter(nextFilter);
  }, []);

  useEffect(() => {
    if (!canSync) {
      return;
    }
    return subscribeTauriEvent<ChangeRequestSyncChangedEvent>(
      CHANGE_REQUEST_SYNC_CHANGED_EVENT,
      (payload) => {
        if (payload.projectId !== projectId || payload.outcome !== "synced") {
          return;
        }
        void reload().catch(() => undefined);
      },
    );
  }, [canSync, projectId, reload]);

  return {
    filter,
    response,
    syncError,
    syncing,
    selectFilter,
    reload,
    runSync,
    noteManualResult,
  };
}
