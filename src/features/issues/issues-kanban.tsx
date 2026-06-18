import { Play, Plus } from "lucide-react";

import type { IssueRecord, IssueStatus } from "./issue-commands";

interface IssueLane {
  status: IssueStatus;
  label: string;
  issues: IssueRecord[];
}

interface IssuesKanbanProps {
  isLoading: boolean;
  lanes: IssueLane[];
  selectedIssueId: number | null;
  cardRefs: React.RefObject<Map<number, HTMLButtonElement>>;
  createButtonRef: React.RefObject<HTMLButtonElement | null>;
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
}

export function IssuesKanban({
  isLoading,
  lanes,
  selectedIssueId,
  cardRefs,
  createButtonRef,
  onCreateIssue,
  onOpenIssue,
  onRunIssue,
  canRunIssue,
  formatTimestamp,
  toDescriptionExcerpt,
}: IssuesKanbanProps) {
  return (
    <section className="issues-kanban" aria-label="Issues kanban">
      {isLoading ? (
        <p className="issues-loading" role="status">
          Loading issues...
        </p>
      ) : null}
      {lanes.map((lane) => (
        <section
          key={lane.status}
          aria-label={lane.label}
          className={`issue-lane issue-lane--${lane.status}`}
        >
          <div className="issue-lane__header">
            <div className="issue-lane__title-row">
              <span className="issue-lane__status-dot" aria-hidden="true" />
              <h3>{lane.label}</h3>
              <span className="issue-lane__count">{lane.issues.length}</span>
              {lane.status === "backlog" ? (
                <button
                  ref={createButtonRef}
                  aria-label="New Issue"
                  className="issue-lane__create"
                  title="New Issue"
                  type="button"
                  onClick={(event) => onCreateIssue(event.currentTarget)}
                >
                  <Plus aria-hidden="true" size={14} strokeWidth={2} />
                </button>
              ) : null}
            </div>
          </div>
          <div className="issue-lane__cards" role="list">
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
              <p className="issue-lane__empty">no issues</p>
            ) : null}
          </div>
        </section>
      ))}
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
                {formatTimestamp(issue.updatedAt)}
              </span>
            </span>
            <span className="issue-card__title">{issue.title}</span>
            {issue.linkedSessionAttention === "requested" ? (
              <span
                id={attentionId}
                className="attention-marker issue-card__attention"
              >
                <span aria-hidden="true" className="attention-marker__dot" />
                <span className="attention-marker__text">Codex 需要确认</span>
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
              aria-label={`Run ${issue.title}`}
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
              {`Labels: ${labels.map((label) => label.name).join(", ")}`}
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
