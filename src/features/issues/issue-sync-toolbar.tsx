import type { TFunction } from "i18next";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import { subscribeTauriEvent } from "../../shared/tauri-event/use-tauri-event";
import { formatIssueAge } from "./issue-mirror-fields";
import {
  getIssueSyncStatus,
  ISSUE_SYNC_CHANGED_EVENT,
  syncProjectIssues,
  type IssueSyncChangedEvent,
  type IssueSyncStatus,
} from "./issue-mirror-commands";

export function IssueSyncToolbar({
  projectId,
  onReload,
}: {
  projectId: number;
  onReload: () => void;
}) {
  const { t } = useI18n();
  const [now] = useState(() => Date.now());
  const [status, setStatus] = useState<IssueSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

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
        onReload();
        void getIssueSyncStatus(projectId)
          .then(setStatus)
          .catch(() => undefined);
      },
    );
  }, [onReload, projectId]);

  async function refresh(): Promise<void> {
    setSyncing(true);
    try {
      await syncProjectIssues(projectId);
      setStatus(await getIssueSyncStatus(projectId));
      onReload();
    } catch {
      setStatus((current) => current);
    } finally {
      setSyncing(false);
    }
  }

  const text = syncStatusText(status, syncing, t, now);
  const tone = syncing
    ? undefined
    : status?.syncError
      ? "error"
      : status?.lastSyncedAt != null
        ? "success"
        : undefined;

  return (
    <div className="issue-sync-status">
      {text ? (
        <span className="issue-sync-status__text">
          {tone ? (
            <span
              aria-hidden="true"
              className="issue-sync-status__dot"
              data-tone={tone}
            />
          ) : null}
          {text}
        </span>
      ) : null}
      <button
        aria-label={t("issues.syncRefresh")}
        className="issue-sync-status__refresh"
        type="button"
        onClick={() => {
          void refresh();
        }}
      >
        <RefreshCw aria-hidden="true" size={14} strokeWidth={2} />
      </button>
    </div>
  );
}

function syncStatusText(
  status: IssueSyncStatus | null,
  syncing: boolean,
  t: TFunction,
  now: number,
): string | null {
  if (syncing) {
    return t("issues.syncing");
  }
  if (status?.syncError === "credential_expired") {
    return t("issues.githubCredentialExpired");
  }
  if (status?.syncError === "cache_failed") {
    return t("issues.syncCacheFailed");
  }
  if (status?.lastSyncedAt == null) {
    return null;
  }
  return formatIssueAge(status.lastSyncedAt, now, {
    justNow: t("issues.syncedJustNow"),
    minutesAgo: (minutes) => t("issues.syncedMinutesAgo", { minutes }),
    hoursAgo: (hours) => t("issues.syncedHoursAgo", { hours }),
    daysAgo: (days) => t("issues.syncedDaysAgo", { days }),
  });
}
