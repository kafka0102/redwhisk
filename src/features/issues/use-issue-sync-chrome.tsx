import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useWindowFocus } from "../../shared/window/use-window-focus";
import { subscribeTauriEvent } from "../../shared/tauri-event/use-tauri-event";
import {
  getProjectIssueSourceSettings,
  type IssueSourceMode,
  type ProjectIssueSourceSettings,
} from "../settings/issue-source-commands";
import {
  getIssueSyncStatus,
  ISSUE_SYNC_CHANGED_EVENT,
  syncProjectIssues,
  type IssueSyncChangedEvent,
  type IssueSyncStatus,
} from "./issue-mirror-commands";
import {
  IssueSourceFilter,
  type IssueSourceFilter as SourceFilter,
} from "./issue-source-filter";
import { IssueSyncToolbar } from "./issue-sync-toolbar";
import {
  useIssueAutoSync,
  usePageVisible,
  type AutoSyncResult,
} from "./use-issue-auto-sync";

export function useIssueSyncChrome(
  projectId: number,
  onReload: (sourceFilter: SourceFilter) => void,
): {
  sourceMode: IssueSourceMode | null;
  sourceFilter: SourceFilter;
  toolbar: ReactNode;
} {
  const [sourceMode, setSourceMode] = useState<IssueSourceMode | null>(null);
  const [settings, setSettings] = useState<ProjectIssueSourceSettings | null>(
    null,
  );
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [status, setStatus] = useState<IssueSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [seenProjectId, setSeenProjectId] = useState(projectId);
  const syncingRef = useRef(false);
  const onReloadRef = useRef(onReload);
  const projectIdRef = useRef(projectId);
  const sourceFilterRef = useRef(sourceFilter);
  if (seenProjectId !== projectId) {
    setSeenProjectId(projectId);
    setSourceFilter("all");
    setSourceMode(null);
    setSettings(null);
  }
  const isPageVisible = usePageVisible();
  const isWindowFocused = useWindowFocus();

  useEffect(() => {
    onReloadRef.current = onReload;
    projectIdRef.current = projectId;
    sourceFilterRef.current = sourceFilter;
  });

  useEffect(() => {
    let cancelled = false;
    void getProjectIssueSourceSettings(projectId)
      .then((next) => {
        if (!cancelled) {
          setSettings(next);
          setSourceMode(next.issueSourceMode);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSettings(null);
          setSourceMode(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    void getIssueSyncStatus(projectId)
      .then((next) => {
        if (!cancelled) {
          setStatus(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    return subscribeTauriEvent<IssueSyncChangedEvent>(
      ISSUE_SYNC_CHANGED_EVENT,
      (payload) => {
        if (payload.projectId !== projectId) {
          return;
        }
        onReloadRef.current(sourceFilterRef.current);
        void getIssueSyncStatus(projectId)
          .then(setStatus)
          .catch(() => undefined);
      },
    );
  }, [projectId]);

  const runSync = useCallback(async (): Promise<AutoSyncResult> => {
    if (syncingRef.current) {
      return "skipped";
    }
    syncingRef.current = true;
    setSyncing(true);
    const currentProjectId = projectIdRef.current;
    try {
      const result = await syncProjectIssues(currentProjectId);
      if (result?.outcome == null) {
        return "failed";
      }
      setStatus(await getIssueSyncStatus(currentProjectId));
      onReloadRef.current(sourceFilterRef.current);
      if (
        result.outcome === "credential_expired" ||
        result.outcome === "cache_failed"
      ) {
        return "failed";
      }
      return "synced";
    } catch {
      return "failed";
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, []);

  const isActive =
    isPageVisible &&
    isWindowFocused &&
    settings?.issueSyncEnabled === true &&
    (sourceMode === "mixed" || sourceMode === "remote");
  const { noteManualResult } = useIssueAutoSync({
    isActive,
    intervalSeconds: settings?.issueSyncIntervalSeconds ?? 90,
    runSync,
  });

  const refresh = useCallback(() => {
    void runSync().then(noteManualResult);
  }, [noteManualResult, runSync]);

  const showFilter = sourceMode === "mixed";
  const showSync = sourceMode === "remote" || sourceMode === "mixed";
  const toolbar =
    showFilter || showSync ? (
      <>
        {showFilter ? (
          <IssueSourceFilter value={sourceFilter} onChange={setSourceFilter} />
        ) : null}
        {showSync ? (
          <IssueSyncToolbar
            status={status}
            syncing={syncing}
            onRefresh={refresh}
          />
        ) : null}
      </>
    ) : null;

  return { sourceMode, sourceFilter, toolbar };
}
