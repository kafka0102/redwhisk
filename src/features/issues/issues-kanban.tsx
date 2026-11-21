import { LoaderCircle, Play } from "lucide-react";
import { useState } from "react";

import type { IssueRecord, IssueStatus } from "./issue-commands";
import {
  formatIssueAge,
  linkedRequestLabel,
  readIssueMirror,
  toBoardRecord,
} from "./issue-mirror-fields";
import { IssueAssigneeAvatar } from "./issue-assignee-avatar";
import { issueBoardNumberLabel } from "./issue-board-list-model";
import { issueHasVisibleLabels } from "./issue-label-partition";
import { IssueLabelRow } from "./issue-label-row";
import { IssueSourceMark } from "./issue-source-mark";
import type { RunDialogIssue } from "./use-issue-run-dialog";
import { useI18n } from "../../shared/i18n/i18n";

/** 滚动到距底部多少像素时触发加载下一页。 */
const ISSUE_LANE_LOAD_MORE_THRESHOLD = 80;

interface IssueLane {
  status: IssueStatus;
  label: string;
  issues: IssueRecord[];
  /** 该甬道（状态）下的 Issue 总数，由后端按状态分组统计返回。 */
  total: number;
}

/** 看板只关心每个甬道是否还有更多、是否正在加载更多。 */
interface LaneLoadStateView {
  hasMore: boolean;
  isLoadingMore: boolean;
}

interface IssuesKanbanProps {
  isLoading: boolean;
  lanes: IssueLane[];
  selectedIssueId: number | null;
  cardRefs: React.RefObject<Map<number, HTMLButtonElement>>;
  laneLoadState: Record<IssueStatus, LaneLoadStateView>;
  onOpenIssue: (issue: IssueRecord, trigger: HTMLElement | null) => void;
  onRunIssue: (issue: RunDialogIssue, trigger: HTMLElement | null) => void;
  canRunIssue: (
    issue: Pick<IssueRecord, "status" | "linkedSessionId">,
  ) => boolean;
  toDescriptionExcerpt: (markdown: string) => string;
  onLoadMore: (status: IssueStatus) => void;
  sourceMode?: "local" | "remote" | "mixed" | null;
}

export function IssuesKanban({
  isLoading,
  lanes,
  selectedIssueId,
  cardRefs,
  laneLoadState,
  onOpenIssue,
  onRunIssue,
  canRunIssue,
  toDescriptionExcerpt,
  onLoadMore,
  sourceMode = null,
}: IssuesKanbanProps) {
  const { messages } = useI18n();
  return (
    <section
      className="issues-kanban"
      aria-label={messages.issues.issuesKanban}
    >
      {isLoading ? (
        <p className="issues-loading" role="status">
          {messages.issues.loadingIssues}
        </p>
      ) : null}
      {lanes.map((lane) => {
        const laneView = laneLoadState[lane.status];
        return (
          <section
            key={lane.status}
            aria-label={lane.label}
            className={`issue-lane issue-lane--${lane.status}`}
          >
            <div className="issue-lane__header">
              <div className="issue-lane__title-row">
                <span className="issue-lane__status-dot" aria-hidden="true" />
                <h3>{lane.label}</h3>
                <span className="issue-lane__count">{lane.total}</span>
              </div>
            </div>
            <div
              className="issue-lane__cards"
              role="list"
              onScroll={(event) => {
                if (isLoading) {
                  return;
                }
                if (!laneView || !laneView.hasMore || laneView.isLoadingMore) {
                  return;
                }
                const target = event.currentTarget;
                if (target.scrollHeight === 0) {
                  return;
                }
                if (
                  target.scrollHeight - target.clientHeight - target.scrollTop <
                  ISSUE_LANE_LOAD_MORE_THRESHOLD
                ) {
                  onLoadMore(lane.status);
                }
              }}
            >
              {lane.issues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  isSelected={issue.id === selectedIssueId}
                  cardRefs={cardRefs}
                  canRunIssue={canRunIssue}
                  toDescriptionExcerpt={toDescriptionExcerpt}
                  sourceMode={sourceMode}
                  onOpenIssue={onOpenIssue}
                  onRunIssue={onRunIssue}
                />
              ))}
              {!isLoading && lane.issues.length === 0 ? (
                <p className="issue-lane__empty">{messages.issues.emptyLane}</p>
              ) : null}
              {laneView?.isLoadingMore ? (
                <div className="issue-lane__load-more" role="status">
                  <LoaderCircle
                    aria-hidden="true"
                    className="issue-lane__load-more-spinner"
                    size={13}
                    strokeWidth={2}
                  />
                  <span>{messages.issues.loadingMore}</span>
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
    </section>
  );
}

function IssueCard({
  issue,
  isSelected,
  cardRefs,
  canRunIssue,
  toDescriptionExcerpt,
  sourceMode,
  onOpenIssue,
  onRunIssue,
}: {
  issue: IssueRecord;
  isSelected: boolean;
  cardRefs: React.RefObject<Map<number, HTMLButtonElement>>;
  canRunIssue: (
    issue: Pick<IssueRecord, "status" | "linkedSessionId">,
  ) => boolean;
  toDescriptionExcerpt: (markdown: string) => string;
  sourceMode: "local" | "remote" | "mixed" | null;
  onOpenIssue: (issue: IssueRecord, trigger: HTMLElement | null) => void;
  onRunIssue: (issue: RunDialogIssue, trigger: HTMLElement | null) => void;
}) {
  const { messages, t } = useI18n();
  const [now] = useState(() => Date.now());
  const mirror = readIssueMirror(toBoardRecord(issue));
  const metaId = `issue-card-meta-${issue.id}`;
  const attentionId = `issue-card-attention-${issue.id}`;
  const descriptionId = `issue-card-description-${issue.id}`;
  const labelsId = `issue-card-labels-${issue.id}`;
  const hasLabels = issueHasVisibleLabels(issue);
  const isRunnable = canRunIssue(issue);
  const tone =
    mirror.syncStatus === "error"
      ? "error"
      : sourceMode === "mixed" && mirror.source === "remote"
        ? "info"
        : undefined;
  const issueNumber = issueBoardNumberLabel(issue.number, mirror);
  const requestLabel = linkedRequestLabel(mirror);
  const describedBy = [
    metaId,
    issue.linkedSessionAttention === "requested" ? attentionId : null,
    issue.description ? descriptionId : null,
    hasLabels ? labelsId : null,
  ]
    .filter((value): value is string => value != null)
    .join(" ");

  return (
    <div role="listitem">
      <div className="issue-card__shell" data-tone={tone}>
        <button
          ref={(element) => {
            if (element) {
              cardRefs.current.set(issue.id, element);
            } else {
              cardRefs.current.delete(issue.id);
            }
          }}
          aria-describedby={describedBy}
          aria-label={issue.title}
          aria-pressed={isSelected}
          className="issue-card issue-card__hit"
          type="button"
          onClick={(event) => onOpenIssue(issue, event.currentTarget)}
        />
        <span className="issue-card__meta-row" id={metaId}>
          <span className="issue-card__id-line">
            <IssueSourceMark mirror={mirror} />
            <span className="issue-card__id">{issueNumber}</span>
          </span>
          <span className="issue-card__meta-aside">
            <span className="issue-card__updated">
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
        </span>
        <div className="issue-card__body-row">
          <div className="issue-card__body">
            <span className="issue-card__title">{issue.title}</span>
            {requestLabel ? (
              <span className="issue-card__remote-note">{requestLabel}</span>
            ) : null}
            {mirror.remoteClosedWhileRunning ? (
              <span className="issue-card__remote-note">
                {t("issues.remoteClosed")}
              </span>
            ) : null}
            {mirror.remoteReopened ? (
              <span className="issue-card__remote-note">
                {t("issues.remoteReopened")}
              </span>
            ) : null}
            {mirror.syncStatus === "error" ? (
              <span className="issue-card__remote-note">
                {t("issues.syncFailed")}
              </span>
            ) : null}
            {issue.linkedSessionAttention === "requested" ? (
              <span
                className="attention-marker issue-card__attention"
                id={attentionId}
              >
                <span aria-hidden="true" className="attention-marker__dot" />
                <span className="attention-marker__text">
                  {messages.agentsFeature.attentionRequested}
                </span>
              </span>
            ) : null}
            {issue.description ? (
              <span className="issue-card__description" id={descriptionId}>
                {toDescriptionExcerpt(issue.description)}
              </span>
            ) : null}
            <IssueLabelRow id={labelsId} issue={issue} />
          </div>
          {isRunnable ? (
            <button
              aria-label={`${messages.issues.run} ${issue.title}`}
              className="issue-card__run"
              type="button"
              onClick={(event) => {
                onRunIssue(issue, event.currentTarget);
              }}
            >
              <Play
                aria-hidden="true"
                fill="none"
                size={14}
                stroke="currentColor"
                strokeWidth={2}
              />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
