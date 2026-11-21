import type { JSX } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import type { IssueRecord } from "./issue-commands";
import { partitionIssueLabels } from "./issue-label-partition";

export function IssueLabelRow({
  issue,
  id,
}: {
  issue: IssueRecord;
  id: string;
}): JSX.Element | null {
  const { messages } = useI18n();
  const { projectLabels, remoteLabels } = partitionIssueLabels(issue);
  if (projectLabels.length === 0 && remoteLabels.length === 0) {
    return null;
  }
  return (
    <span className="issue-card__labels" id={id}>
      <span className="sr-only">
        {`${messages.issues.labels}: ${projectLabels
          .map((label) => label.name)
          .concat(remoteLabels)
          .join(", ")}`}
      </span>
      {projectLabels.map((label) => (
        <span
          aria-hidden="true"
          className="issue-card__label-chip"
          key={label.id}
          style={{ backgroundColor: label.color }}
        >
          {label.name}
        </span>
      ))}
      {remoteLabels.map((label) => (
        <span
          aria-hidden="true"
          className="issue-card__label-chip issue-card__label-chip--remote"
          key={label}
        >
          {label}
        </span>
      ))}
    </span>
  );
}
