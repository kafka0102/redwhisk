import { LoaderCircle, Play, Plus } from "lucide-react";

import type { IssueRecord, IssueStatus } from "./issue-commands";
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
  createButtonRef: React.RefObject<HTMLButtonElement | null>;
  laneLoadState: Record<IssueStatus, LaneLoadStateView>;
  onCreateIssue: (trigger: HTMLElement | null) => void;
  onOpenIssue: (issue: IssueRecord, trigger: HTMLElement | null) => void;
  onRunIssue: (
    issue: Pick<
      IssueRecord,
      | "id"
      | "title"
      | "description"
      | "attachments"
      | "status"
      | "linkedSessionId"
    >,
    trigger: HTMLElement | null,
  ) => void;
  canRunIssue: (
    issue: Pick<IssueRecord, "status" | "linkedSessionId">,
  ) => boolean;
  formatTimestamp: (epochMilliseconds: number) => string;
  toDescriptionExcerpt: (markdown: string) => string;
  onLoadMore: (status: IssueStatus) => void;
}

export function IssuesKanban({
  isLoading,
  lanes,
  selectedIssueId,
  cardRefs,
  createButtonRef,
  laneLoadState,
  onCreateIssue,
  onOpenIssue,
  onRunIssue,
  canRunIssue,
  formatTimestamp,
  toDescriptionExcerpt,
  onLoadMore,
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
                {lane.status === "backlog" ? (
                  <button
                    ref={createButtonRef}
                    aria-label={messages.issues.newIssue}
                    className="issue-lane__create"
                    title={messages.issues.newIssue}
                    type="button"
                    onClick={(event) => onCreateIssue(event.currentTarget)}
                  >
                    <Plus aria-hidden="true" size={14} strokeWidth={2} />
                  </button>
                ) : null}
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
                  formatTimestamp={formatTimestamp}
                  toDescriptionExcerpt={toDescriptionExcerpt}
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
  formatTimestamp,
  toDescriptionExcerpt,
  onOpenIssue,
  onRunIssue,
}: {
  issue: IssueRecord;
  isSelected: boolean;
  cardRefs: React.RefObject<Map<number, HTMLButtonElement>>;
  canRunIssue: (
    issue: Pick<IssueRecord, "status" | "linkedSessionId">,
  ) => boolean;
  formatTimestamp: (epochMilliseconds: number) => string;
  toDescriptionExcerpt: (markdown: string) => string;
  onOpenIssue: (issue: IssueRecord, trigger: HTMLElement | null) => void;
  onRunIssue: (
    issue: Pick<
      IssueRecord,
      | "id"
      | "title"
      | "description"
      | "attachments"
      | "status"
      | "linkedSessionId"
    >,
    trigger: HTMLElement | null,
  ) => void;
}) {
  const { messages } = useI18n();
  const metaId = `issue-card-meta-${issue.id}`;
  const attentionId = `issue-card-attention-${issue.id}`;
  const descriptionId = `issue-card-description-${issue.id}`;
  const labelsId = `issue-card-labels-${issue.id}`;
  const labels = issue.labels ?? [];
  const hasLabels = labels.length > 0;
  const isRunnable = canRunIssue(issue);
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
      <div className="issue-card__shell">
        <div className="issue-card__content-row">
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
            className="issue-card"
            type="button"
            onClick={(event) => onOpenIssue(issue, event.currentTarget)}
          >
            <span id={metaId} className="issue-card__meta-row">
              <span className="issue-card__id">#{issue.id}</span>
              <span className="issue-card__updated">
                {formatTimestamp(issue.createdAt)}
              </span>
            </span>
            <span className="issue-card__title">{issue.title}</span>
            {issue.linkedSessionAttention === "requested" ? (
              <span
                id={attentionId}
                className="attention-marker issue-card__attention"
              >
                <span aria-hidden="true" className="attention-marker__dot" />
                <span className="attention-marker__text">
                  {messages.agentsFeature.attentionRequested}
                </span>
              </span>
            ) : null}
            {issue.description ? (
              <span id={descriptionId} className="issue-card__description">
                {toDescriptionExcerpt(issue.description)}
              </span>
            ) : null}
          </button>
          {isRunnable ? (
            <button
              aria-label={`${messages.issues.run} ${issue.title}`}
              className="issue-card__run"
              type="button"
              onClick={(event) => {
                onRunIssue(issue, event.currentTarget);
              }}
            >
              <Play aria-hidden="true" size={14} strokeWidth={2} />
            </button>
          ) : null}
        </div>
        {hasLabels ? (
          <span id={labelsId} className="issue-card__labels">
            <span className="sr-only">
              {`${messages.issues.labels}: ${labels
                .map((label) => label.name)
                .join(", ")}`}
            </span>
            {labels.map((label) => (
              <span
                key={label.id}
                aria-hidden="true"
                className="issue-card__label-chip"
                style={{ backgroundColor: label.color }}
              >
                {label.name}
              </span>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}
