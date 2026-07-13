import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import defaultUserProfile from "@/assets/images/default_user_profile.png";

import { useI18n } from "../../shared/i18n/i18n";
import { getIssueTimeline, type IssueTimelineEntry } from "./issue-commands";

interface IssueTimelineProps {
  projectId: number;
  issueId: number;
}

export function IssueTimeline({ projectId, issueId }: IssueTimelineProps) {
  const { messages } = useI18n();
  const timelineKey = `${projectId}:${issueId}`;
  const [timeline, setTimeline] = useState({
    key: timelineKey,
    entries: [] as IssueTimelineEntry[],
  });

  useEffect(() => {
    let isCurrent = true;

    void getIssueTimeline({ projectId, issueId })
      .then((response) => {
        if (isCurrent) {
          setTimeline({ key: timelineKey, entries: response.entries });
        }
      })
      .catch(() => {
        // 时间轴读取失败时保持详情可用，并安全降级为不显示模块。
      });

    return () => {
      isCurrent = false;
    };
  }, [issueId, projectId, timelineKey]);

  if (timeline.key !== timelineKey || timeline.entries.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={messages.issues.timelineTitle}
      className="issue-timeline"
    >
      <div className="issue-detail__divider" />
      <h2 className="issue-timeline__title">{messages.issues.timelineTitle}</h2>
      <ol className="issue-timeline__entries">
        {timeline.entries.map((entry, index) => (
          <IssueTimelineEntryRow
            key={`${entry.actionType}-${entry.createdAt}-${index}`}
            entry={entry}
          />
        ))}
      </ol>
    </section>
  );
}

function IssueTimelineEntryRow({ entry }: { entry: IssueTimelineEntry }) {
  const { messages } = useI18n();
  const actionText: Record<IssueTimelineEntry["actionType"], string> = {
    issue_created: messages.issues.timelineCreated,
    agent_session_started: messages.issues.timelineAgentSessionStarted,
    issue_review_marked: messages.issues.timelineReviewMarked,
    issue_status_changed: messages.issues.timelineStatusChanged,
    issue_completed: messages.issues.timelineCompleted,
  };

  return (
    <li className="issue-timeline__entry">
      <span aria-hidden="true" className="issue-timeline__node" />
      <img
        alt=""
        className="issue-timeline__avatar"
        src={
          entry.actor.avatarPath
            ? convertFileSrc(entry.actor.avatarPath)
            : defaultUserProfile
        }
      />
      <span className="issue-timeline__actor">{entry.actor.name}</span>
      <span className="issue-timeline__action">
        {actionText[entry.actionType]}
      </span>
      <time
        className="issue-timeline__time"
        dateTime={new Date(entry.createdAt).toISOString()}
      >
        {formatRelativeTime(entry.createdAt, messages)}
      </time>
    </li>
  );
}

function formatRelativeTime(
  createdAt: number,
  messages: ReturnType<typeof useI18n>["messages"],
): string {
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1_000));
  if (seconds < 60) {
    return messages.issues.timelineJustNow;
  }
  if (seconds < 3_600) {
    return messages.issues.timelineMinutesAgo(Math.floor(seconds / 60));
  }
  if (seconds < 86_400) {
    return messages.issues.timelineHoursAgo(Math.floor(seconds / 3_600));
  }
  return messages.issues.timelineDaysAgo(Math.floor(seconds / 86_400));
}
