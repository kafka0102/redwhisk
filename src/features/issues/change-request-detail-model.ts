import type {
  ChangeRequestCheckRun,
  ChangeRequestDiscussionItem,
  ChangeRequestDetail,
} from "./change-request-commands";

export type ChangeRequestDetailTab =
  | "overview"
  | "files"
  | "checks"
  | "discussion";

const CHECK_ORDER: Record<string, number> = {
  failed: 0,
  pending: 1,
  passed: 2,
};

export function hostLabel(provider: string): "GitHub" | "GitLab" {
  return provider === "gitlab" ? "GitLab" : "GitHub";
}

export function isMerged(state: string): boolean {
  return state === "merged";
}

export function sortedChecks(
  checks: ChangeRequestCheckRun[],
): ChangeRequestCheckRun[] {
  return checks
    .map((check, index) => ({ check, index }))
    .sort((left, right) => {
      const leftRank = CHECK_ORDER[left.check.status] ?? 3;
      const rightRank = CHECK_ORDER[right.check.status] ?? 3;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.index - right.index;
    })
    .map((item) => item.check);
}

export function discussionsOf(
  detail: ChangeRequestDetail,
): ChangeRequestDiscussionItem[] {
  return [...detail.reviews, ...detail.comments].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }
    return left.author.localeCompare(right.author);
  });
}

export function checkCounts(checks: ChangeRequestCheckRun[]): {
  failed: number;
  pending: number;
  passed: number;
} {
  return {
    failed: checks.filter((check) => check.status === "failed").length,
    pending: checks.filter((check) => check.status === "pending").length,
    passed: checks.filter((check) => check.status === "passed").length,
  };
}

export function formatDurationMs(durationMs: number | null): string | null {
  if (durationMs == null) {
    return null;
  }
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}
