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
  updateProjectIssueSourceSettings,
  type ForgeProvider,
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
import { canCreateIssueFromBoard } from "./issue-connection";
import {
  IssueSourceFilter,
  type IssueSourceFilter as SourceFilter,
} from "./issue-source-filter";
import { IssueSyncToolbar } from "./issue-sync-toolbar";
import type { IssueBoardView, IssueListBucket } from "./issue-board-list-model";
import {
  useIssueAutoSync,
  usePageVisible,
  type AutoSyncResult,
} from "./use-issue-auto-sync";

interface IssueDisplayModeSaveQueue {
  isSaving: boolean;
  pendingSave: {
    mode: IssueBoardView;
    sequence: number;
  } | null;
}

export function useIssueSyncChrome(
  projectId: number,
  onReload: (sourceFilter: SourceFilter) => void,
  onIssueDisplayModeSaveFailed: () => void,
): {
  sourceMode: IssueSourceMode | null;
  sourceFilter: SourceFilter;
  provider: ForgeProvider | null;
  showCreate: boolean;
  issueBoard: {
    view: IssueBoardView;
    bucket: IssueListBucket;
    onViewChange: (mode: IssueBoardView) => Promise<void>;
    onBucketChange: (bucket: IssueListBucket) => void;
  };
  toolbar: ReactNode;
} {
  const [sourceMode, setSourceMode] = useState<IssueSourceMode | null>(null);
  const [settings, setSettings] = useState<ProjectIssueSourceSettings | null>(
    null,
  );
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [status, setStatus] = useState<IssueSyncStatus | null>(null);
  const [issueDisplayMode, setIssueDisplayMode] =
    useState<IssueBoardView>("board");
  const [issueListBucket, setIssueListBucket] =
    useState<IssueListBucket>("open");
  const [syncingProjectIds, setSyncingProjectIds] = useState(
    () => new Set<number>(),
  );
  const [cliMissingConfirmed, setCliMissingConfirmed] = useState(false);
  const [seenProjectId, setSeenProjectId] = useState(projectId);
  const syncingProjectIdsRef = useRef(new Set<number>());
  const syncRequestSequenceRef = useRef(0);
  const statusReadSequenceRef = useRef(0);
  const onReloadRef = useRef(onReload);
  const onIssueDisplayModeSaveFailedRef = useRef(onIssueDisplayModeSaveFailed);
  const projectIdRef = useRef(projectId);
  const sourceFilterRef = useRef(sourceFilter);
  const issueDisplayModeTouchedRef = useRef(false);
  const issueDisplayModeSaveSequenceRef = useRef(new Map<number, number>());
  const issueDisplayModeSaveQueuesRef = useRef(
    new Map<number, IssueDisplayModeSaveQueue>(),
  );
  if (seenProjectId !== projectId) {
    setSeenProjectId(projectId);
    setSourceFilter("all");
    setSourceMode(null);
    setSettings(null);
    setIssueDisplayMode("board");
    setIssueListBucket("open");
    setStatus(null);
    setCliMissingConfirmed(false);
  }
  const isPageVisible = usePageVisible();
  const isWindowFocused = useWindowFocus();

  useEffect(() => {
    onReloadRef.current = onReload;
    onIssueDisplayModeSaveFailedRef.current = onIssueDisplayModeSaveFailed;
    projectIdRef.current = projectId;
    sourceFilterRef.current = sourceFilter;
  });

  useEffect(() => {
    issueDisplayModeTouchedRef.current = false;
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    void getProjectIssueSourceSettings(projectId)
      .then((next) => {
        if (!cancelled) {
          setSettings(next);
          setSourceMode(next.issueSourceMode);
          if (!issueDisplayModeTouchedRef.current) {
            setIssueDisplayMode(next.issueDisplayMode);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSettings(null);
          setSourceMode(null);
          if (!issueDisplayModeTouchedRef.current) {
            setIssueDisplayMode("board");
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const changeIssueDisplayMode = useCallback(
    async (mode: IssueBoardView): Promise<void> => {
      const requestProjectId = projectIdRef.current;
      const requestSequence =
        (issueDisplayModeSaveSequenceRef.current.get(requestProjectId) ?? 0) +
        1;
      issueDisplayModeSaveSequenceRef.current.set(
        requestProjectId,
        requestSequence,
      );
      const isLatestRequest = (
        requestProjectIdToCheck: number,
        requestSequenceToCheck: number,
      ): boolean =>
        projectIdRef.current === requestProjectIdToCheck &&
        issueDisplayModeSaveSequenceRef.current.get(requestProjectIdToCheck) ===
          requestSequenceToCheck;
      issueDisplayModeTouchedRef.current = true;
      setIssueDisplayMode(mode);

      const queue = issueDisplayModeSaveQueuesRef.current.get(
        requestProjectId,
      ) ?? {
        isSaving: false,
        pendingSave: null,
      };
      queue.pendingSave = {
        mode,
        sequence: requestSequence,
      };
      issueDisplayModeSaveQueuesRef.current.set(requestProjectId, queue);
      if (queue.isSaving) {
        return;
      }

      queue.isSaving = true;
      void (async () => {
        while (queue.pendingSave !== null) {
          const pendingSave = queue.pendingSave;
          queue.pendingSave = null;
          try {
            const next = await updateProjectIssueSourceSettings({
              projectId: requestProjectId,
              issueDisplayMode: pendingSave.mode,
            });
            if (isLatestRequest(requestProjectId, pendingSave.sequence)) {
              setIssueDisplayMode(next.issueDisplayMode);
            }
          } catch {
            if (isLatestRequest(requestProjectId, pendingSave.sequence)) {
              onIssueDisplayModeSaveFailedRef.current();
            }
          }
        }
        queue.isSaving = false;
      })();
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const statusReadSequence = ++statusReadSequenceRef.current;
    void getIssueSyncStatus(projectId)
      .then((next) => {
        if (
          !cancelled &&
          projectIdRef.current === projectId &&
          statusReadSequenceRef.current === statusReadSequence
        ) {
          setStatus(next);
        }
      })
      .catch(() => {
        if (
          !cancelled &&
          projectIdRef.current === projectId &&
          statusReadSequenceRef.current === statusReadSequence
        ) {
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
        const statusReadSequence = ++statusReadSequenceRef.current;
        void getIssueSyncStatus(projectId)
          .then((next) => {
            if (
              projectIdRef.current !== projectId ||
              statusReadSequenceRef.current !== statusReadSequence
            ) {
              return;
            }
            setStatus(next);
            setCliMissingConfirmed(
              payload.outcome === "cache_failed" &&
                next.syncError === "cli_missing",
            );
          })
          .catch(() => undefined);
      },
    );
  }, [projectId]);

  const runSync = useCallback(async (): Promise<AutoSyncResult> => {
    const currentProjectId = projectIdRef.current;
    if (syncingProjectIdsRef.current.has(currentProjectId)) {
      return "skipped";
    }
    syncingProjectIdsRef.current.add(currentProjectId);
    setSyncingProjectIds((current) => {
      const next = new Set(current);
      next.add(currentProjectId);
      return next;
    });
    setCliMissingConfirmed(false);
    const syncRequestSequence = ++syncRequestSequenceRef.current;
    const isCurrentSyncRequest = (): boolean =>
      projectIdRef.current === currentProjectId &&
      syncRequestSequenceRef.current === syncRequestSequence;
    try {
      const result = await syncProjectIssues(currentProjectId);
      if (!isCurrentSyncRequest()) {
        return "skipped";
      }
      if (result?.outcome == null) {
        return "failed";
      }
      const statusReadSequence = ++statusReadSequenceRef.current;
      const nextStatus = await getIssueSyncStatus(currentProjectId);
      if (
        !isCurrentSyncRequest() ||
        statusReadSequenceRef.current !== statusReadSequence
      ) {
        return "skipped";
      }
      setStatus(nextStatus);
      setCliMissingConfirmed(
        result.outcome === "cache_failed" &&
          nextStatus.syncError === "cli_missing",
      );
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
      syncingProjectIdsRef.current.delete(currentProjectId);
      setSyncingProjectIds((current) => {
        const next = new Set(current);
        next.delete(currentProjectId);
        return next;
      });
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
  const syncing = syncingProjectIds.has(projectId);
  const toolbar =
    showFilter || showSync ? (
      <>
        {showFilter ? (
          <IssueSourceFilter
            provider={settings?.connection.provider ?? null}
            value={sourceFilter}
            onChange={setSourceFilter}
          />
        ) : null}
        {showSync ? (
          <IssueSyncToolbar
            status={status}
            syncing={syncing}
            cliMissingConfirmed={cliMissingConfirmed}
            provider={settings?.connection.provider ?? null}
            onRefresh={refresh}
          />
        ) : null}
      </>
    ) : null;

  return {
    sourceMode,
    sourceFilter,
    provider: settings?.connection.provider ?? null,
    showCreate: canCreateIssueFromBoard(settings),
    issueBoard: {
      view: issueDisplayMode,
      bucket: issueListBucket,
      onViewChange: changeIssueDisplayMode,
      onBucketChange: setIssueListBucket,
    },
    toolbar,
  };
}
