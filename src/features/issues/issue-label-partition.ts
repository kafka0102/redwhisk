import type { IssueLabelRecord, IssueRecord } from "./issue-commands";
import { readIssueMirror, toBoardRecord } from "./issue-mirror-fields";

export function partitionIssueLabels(issue: IssueRecord): {
  projectLabels: IssueLabelRecord[];
  remoteLabels: string[];
} {
  const mirror = readIssueMirror(toBoardRecord(issue));
  const projectLabels = issue.labels ?? [];
  return {
    projectLabels,
    remoteLabels: visibleHostLabels(
      mirror.source,
      mirror.remoteLabels,
      projectLabels,
    ),
  };
}

export function issueHasVisibleLabels(issue: IssueRecord): boolean {
  const labels = partitionIssueLabels(issue);
  return labels.projectLabels.length > 0 || labels.remoteLabels.length > 0;
}

function sameLabelName(left: string, right: string): boolean {
  return left.localeCompare(right, "en", { sensitivity: "accent" }) === 0;
}

function visibleHostLabels(
  source: "local" | "remote",
  remoteLabels: readonly string[],
  projectLabels: readonly { name: string }[],
): string[] {
  if (source !== "remote") {
    return [];
  }
  return remoteLabels.filter(
    (hostLabel) =>
      !projectLabels.some((projectLabel) =>
        sameLabelName(projectLabel.name, hostLabel),
      ),
  );
}
