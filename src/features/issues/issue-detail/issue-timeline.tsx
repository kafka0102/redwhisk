import { convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

import defaultUserProfile from "@/assets/images/default_user_profile.png";

import { AgentMarkdown } from "../../agents/message-stream/agent-markdown";
import { getAgentLogoSrc } from "../../agents/agent-visuals";
import { useI18n } from "../../../shared/i18n/i18n";
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
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen<{ issueId?: number | null }>(
      "issue-timeline-changed",
      (event) => {
        const changedIssueId = event.payload?.issueId;
        if (changedIssueId == null || changedIssueId === issueId) {
          reload();
        }
      },
    ).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [issueId, reload]);

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
  };

  return (
    <li className="issue-timeline__entry">
      <span aria-hidden="true" className="issue-timeline__node" />
      <img
        alt=""
        className="issue-timeline__avatar"
        src={resolveActorAvatar(entry.actor)}
      />
      <span className="issue-timeline__actor">{entry.actor.name}</span>
      {entry.actionType === "issue_comment_added" && entry.commentBody ? (
        <div className="issue-timeline__comment">
          <AgentMarkdown>{entry.commentBody}</AgentMarkdown>
        </div>
      ) : (
        <span className="issue-timeline__action">
          {actionText[entry.actionType]}
        </span>
      )}
      <time
        className="issue-timeline__time"
        dateTime={new Date(entry.createdAt).toISOString()}
      >
        {formatRelativeTime(entry.createdAt, messages)}
      </time>
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
