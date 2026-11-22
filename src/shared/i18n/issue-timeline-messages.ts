export interface IssueTimelineMessages {
  timelineAgentSessionStarted: string;
  timelineCommentAdded: string;
  timelineCompleted: string;
  timelineCreated: string;
  timelineDaysAgo: (days: number) => string;
  timelineHoursAgo: (hours: number) => string;
  timelineJustNow: string;
  timelineMinutesAgo: (minutes: number) => string;
  timelineMonthsAgo: (months: number) => string;
  timelineRemoteEvent: string;
  timelineRemoteOrigin: string;
  timelineReviewMarked: string;
  timelineSourceLocal: string;
  timelineSourceRemote: string;
  timelineStatusChanged: string;
  timelineTitle: string;
  timelineYearsAgo: (years: number) => string;
}
