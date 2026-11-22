import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

import defaultUserProfile from "@/assets/images/default_user_profile.png";

import { AgentMarkdown } from "../../agents/message-stream/agent-markdown";
import { getAgentLogoSrc } from "../../agents/agent-visuals";
import { useI18n } from "../../../shared/i18n/i18n";
import { formatRelativeTime } from "../../../shared/time/relative-time";
import { useTauriEvent } from "../../../shared/tauri-event/use-tauri-event";
import {
  getIssueTimeline,
  type IssueTimelineActor,
  type IssueTimelineEntry,
} from "../issue-commands";

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

  const reload = useCallback(() => {
    void getIssueTimeline({ projectId, issueId })
      .then((response) => {
        setTimeline((prev) =>
          prev.key === timelineKey
            ? { key: timelineKey, entries: response.entries }
            : prev,
        );
      })
      .catch(() => {
        // 时间轴读取失败时保持详情可用，并安全降级为不显示模块。
      });
  }, [issueId, projectId, timelineKey]);

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

  // 评论自动发表后后端广播 issue-timeline-changed，据此刷新当前 Issue 的时间轴
  //（payload 未带 issueId 时也刷新，作为兜底）。
  useTauriEvent<{ issueId?: number | null } | undefined>(
    "issue-timeline-changed",
    (payload) => {
      const changedIssueId = payload?.issueId;
      if (changedIssueId == null || changedIssueId === issueId) {
        reload();
      }
    },
  );

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
    issue_comment_added: messages.issues.timelineCommentAdded,
    remote_comment: messages.issues.timelineSourceRemote,
    remote_event: messages.issues.timelineRemoteEvent,
    remote_origin: messages.issues.timelineRemoteOrigin,
  };

  const isComment =
    (entry.actionType === "issue_comment_added" ||
      entry.actionType === "remote_comment") &&
    Boolean(entry.commentBody);
  const sourceLabel =
    entry.source === "remote"
      ? messages.issues.timelineSourceRemote
      : messages.issues.timelineSourceLocal;

  return (
    <li
      className={
        isComment
          ? "issue-timeline__entry issue-timeline__entry--comment"
          : "issue-timeline__entry"
      }
    >
      <span aria-hidden="true" className="issue-timeline__node" />
      <div className="issue-timeline__meta">
        <img
          alt=""
          className="issue-timeline__avatar"
          src={resolveActorAvatar(entry.actor)}
        />
        <span className="issue-timeline__actor">{entry.actor.name}</span>
        {!isComment ? (
          <span className="issue-timeline__action">
            {actionText[entry.actionType]}
            {entry.actionType === "remote_origin" && entry.commentBody
              ? ` ${entry.commentBody}`
              : ""}
          </span>
        ) : null}
        <time
          className="issue-timeline__time"
          dateTime={new Date(entry.createdAt).toISOString()}
        >
          {formatRelativeTime(entry.createdAt, {
            justNow: messages.issues.timelineJustNow,
            minutesAgo: messages.issues.timelineMinutesAgo,
            hoursAgo: messages.issues.timelineHoursAgo,
            daysAgo: messages.issues.timelineDaysAgo,
            monthsAgo: messages.issues.timelineMonthsAgo,
            yearsAgo: messages.issues.timelineYearsAgo,
          })}
        </time>
        <span className="issue-timeline__source">{sourceLabel}</span>
      </div>
      {isComment && entry.commentBody ? (
        <div className="issue-timeline__comment">
          <AgentMarkdown>{entry.commentBody}</AgentMarkdown>
        </div>
      ) : null}
    </li>
  );
}

function resolveActorAvatar(actor: IssueTimelineActor): string {
  if (actor.actorKind === "agent") {
    return getAgentLogoSrc(actor.agentType ?? "codex");
  }
  return actor.avatarPath
    ? convertFileSrc(actor.avatarPath)
    : defaultUserProfile;
}
