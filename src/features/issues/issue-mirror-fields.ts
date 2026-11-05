export interface IssueMirrorView {
  source: "local" | "remote";
  externalNumber: number | null;
  remoteLabels: string[];
  syncStatus: string | null;
  remoteClosedWhileRunning: boolean;
  remoteReopened: boolean;
}

export function readIssueMirror(issue: object): IssueMirrorView {
  const record = issue as Record<string, unknown>;
  return {
    source: record.source === "remote" ? "remote" : "local",
    externalNumber:
      typeof record.externalNumber === "number" ? record.externalNumber : null,
    remoteLabels: Array.isArray(record.remoteLabels)
      ? record.remoteLabels.filter(
          (label): label is string => typeof label === "string",
        )
      : [],
    syncStatus:
      typeof record.syncStatus === "string" ? record.syncStatus : null,
    remoteClosedWhileRunning: record.remoteClosedWhileRunning === true,
    remoteReopened: record.remoteReopened === true,
  };
}

export function formatIssueAge(
  epochMilliseconds: number,
  now: number,
  labels: {
    justNow: string;
    minutesAgo: (minutes: number) => string;
    hoursAgo: (hours: number) => string;
    daysAgo: (days: number) => string;
  },
): string {
  const seconds = Math.max(0, Math.floor((now - epochMilliseconds) / 1000));
  if (seconds < 60) {
    return labels.justNow;
  }
  if (seconds < 3_600) {
    return labels.minutesAgo(Math.floor(seconds / 60));
  }
  if (seconds < 86_400) {
    return labels.hoursAgo(Math.floor(seconds / 3_600));
  }
  return labels.daysAgo(Math.floor(seconds / 86_400));
}
