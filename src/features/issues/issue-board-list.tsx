import { useState, type JSX } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import { IssueAssigneeAvatar } from "./issue-assignee-avatar";
import {
  issueBoardNumberLabel,
  readIssueMirrorView,
  type IssueListBucket,
} from "./issue-board-list-model";
import type { IssueRecord } from "./issue-commands";
import { IssueLabelRow } from "./issue-label-row";
import { formatIssueAge } from "./issue-mirror-fields";
import { IssueSourceMark } from "./issue-source-mark";

export function IssueBoardList({
  issues,
  isLoading,
  bucket,
  selectedIssueId,
  toDescriptionExcerpt,
  onOpenIssue,
}: {
  issues: IssueRecord[];
  isLoading: boolean;
  bucket: IssueListBucket;
  selectedIssueId: number | null;
  toDescriptionExcerpt: (markdown: string) => string;
  onOpenIssue: (issue: IssueRecord, trigger: HTMLElement | null) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [now] = useState(() => Date.now());
  const emptyLabel =
    bucket === "open" ? t("issues.emptyOpenList") : t("issues.emptyClosedList");
  return (
    <section aria-label={t("issues.issueList")} className="issue-board-list">
      {isLoading ? (
        <p className="issues-loading" role="status">
          {t("issues.loadingIssues")}
        </p>
      ) : null}
      {!isLoading && issues.length === 0 ? (
        <p className="issue-board-list__empty">{emptyLabel}</p>
      ) : null}
      {issues.map((issue) => (
        <IssueListRow
          isSelected={issue.id === selectedIssueId}
          issue={issue}
          key={issue.id}
          now={now}
          toDescriptionExcerpt={toDescriptionExcerpt}
          onOpenIssue={onOpenIssue}
        />
      ))}
    </section>
  );
}

function IssueListRow({
  issue,
  now,
  isSelected,
  toDescriptionExcerpt,
  onOpenIssue,
}: {
  issue: IssueRecord;
  now: number;
  isSelected: boolean;
  toDescriptionExcerpt: (markdown: string) => string;
  onOpenIssue: (issue: IssueRecord, trigger: HTMLElement | null) => void;
}): JSX.Element {
  const { t } = useI18n();
  const mirror = readIssueMirrorView(issue);
  const excerpt = issue.description
    ? toDescriptionExcerpt(issue.description)
    : "";
  return (
    <article className="issue-list-row">
      <button
        aria-label={issue.title}
        aria-pressed={isSelected}
        className="issue-list-row__hit"
        type="button"
        onClick={(event) => onOpenIssue(issue, event.currentTarget)}
      />
      <div className="issue-list-row__top">
        <span className="issue-list-row__title">
          <IssueSourceMark mirror={mirror} />
          <span className="issue-list-row__id">
            {issueBoardNumberLabel(issue.number, mirror)}
          </span>
          <span className="issue-list-row__name">{issue.title}</span>
        </span>
        <span className="issue-list-row__aside">
          <span>
            {formatIssueAge(issue.updatedAt, now, {
              justNow: t("issues.timelineJustNow"),
              minutesAgo: (minutes) =>
                t("issues.timelineMinutesAgo", { minutes }),
              hoursAgo: (hours) => t("issues.timelineHoursAgo", { hours }),
              daysAgo: (days) => t("issues.timelineDaysAgo", { days }),
            })}
          </span>
          <IssueAssigneeAvatar issue={issue} />
        </span>
      </div>
      {excerpt ? (
        <span className="issue-list-row__summary">{excerpt}</span>
      ) : null}
      <IssueLabelRow id={`issue-list-labels-${issue.id}`} issue={issue} />
    </article>
  );
}
