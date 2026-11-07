export type IssueTimelineActionType =
  | "issue_created"
  | "agent_session_started"
  | "issue_review_marked"
  | "issue_status_changed"
  | "issue_completed"
  | "issue_comment_added"
  | "remote_comment"
  | "remote_event"
  | "remote_origin";

export type IssueTimelineSource = "local" | "remote";

export interface IssueTimelineActor {
  name: string;
  avatarPath: string | null;
  /** 操作者类型：`user`、`agent` 或 `remote`。前端按此切换头像来源。 */
  actorKind: string;
  /** Agent 操作者的类型（如 `codex` / `claude`）；用户操作者为 `undefined`。 */
  agentType?: string;
}

export interface IssueTimelineEntry {
  actionType: IssueTimelineActionType;
  actor: IssueTimelineActor;
  createdAt: number;
  /** 评论正文。本地评论与远程评论都放这里，其余动作为 `undefined`。 */
  commentBody?: string;
  source: IssueTimelineSource;
}

export interface IssueTimelineResponse {
  entries: IssueTimelineEntry[];
}

export interface GetIssueTimelineInput {
  projectId: number;
  issueId: number;
}
