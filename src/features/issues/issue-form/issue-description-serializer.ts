import { convertFileSrc } from "@tauri-apps/api/core";

import {
  type IssueAttachmentDraftInput,
  type IssueAttachmentPreviewRecord,
  type IssueAttachmentRecord,
  type IssueRecord,
  type IssueStatus,
  saveIssueAttachmentDraft,
} from "../issue-commands";
import {
  type AttachmentPreviewState,
  type IssueFormState,
} from "../issue-activity-types";
import type { IssueAttachmentDraft } from "./issue-description-editor";
import { sortIssuesByStatusChangedAtDesc } from "../issue-lane-helpers";
import type { useI18n } from "../../../shared/i18n/i18n";

function issueToForm(issue: IssueRecord): IssueFormState {
  const parsed = parseIssueDescription(
    issue.description,
    issue.attachments ?? [],
  );
  return {
    title: issue.title,
    description: parsed.description,
    attachments: parsed.attachments,
    labelIds: (issue.labels ?? []).map((label) => label.id),
  };
}

function mergeIssue(
  currentIssues: IssueRecord[],
  nextIssue: IssueRecord,
): IssueRecord[] {
  const remainingIssues = currentIssues.filter(
    (issue) => issue.id !== nextIssue.id,
  );

  return sortIssuesByStatusChangedAtDesc([nextIssue, ...remainingIssues]);
}

function formatLocalTimestamp(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toLocaleString();
}

function markdownToExcerpt(markdown: string): string {
  return markdown
    .replace(/^\s*\{\{issue-attachment(?:-temp)?:[^}]+\}\}\s*$/gm, "")
    .replace(/\r\n/g, "\n")
    .replace(/```([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|\d+\.|[-*+]|>)\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildIssueDescription(
  description: string,
  attachments: Array<IssueAttachmentRecord | IssueAttachmentDraft>,
): string {
  const trimmedDescription = description.trimEnd();
  // 以裸 token 子串去重：图片附件在描述中以 ![alt](token) 形式存在时也命中，
  // 避免因 alt 文本不同而重复追加同一 token。
  const missingTokens = attachments
    .filter(
      (attachment) =>
        !trimmedDescription.includes(getAttachmentRawToken(attachment)),
    )
    .map(formatAttachmentDescriptionToken);

  if (missingTokens.length === 0) {
    return trimmedDescription;
  }

  if (trimmedDescription.length === 0) {
    return missingTokens.join("\n");
  }

  return `${trimmedDescription}\n\n${missingTokens.join("\n")}`;
}

function getAttachmentRawToken(
  attachment: IssueAttachmentRecord | IssueAttachmentDraft,
): string {
  if ("id" in attachment) {
    return `{{issue-attachment:${attachment.id}}}`;
  }

  return `{{issue-attachment-temp:${attachment.token}}}`;
}

function formatAttachmentDescriptionToken(
  attachment: IssueAttachmentRecord | IssueAttachmentDraft,
): string {
  const token =
    "id" in attachment
      ? `{{issue-attachment:${attachment.id}}}`
      : `{{issue-attachment-temp:${attachment.token}}}`;

  // 图片附件以 Markdown 图片语法承载 token（URL 即 token 占位符），编辑器与
  // 只读页据此内联渲染；非图片附件以裸 token 行承载（编辑器正文不显示，
  // 仅由底部卡片区展示）。两种形态都包含 token 子串，满足 Rust 硬约束。
  if (attachment.kind === "image") {
    return `![${attachment.displayName}](${token})`;
  }

  return token;
}

function serializeAttachments(
  attachments: Array<IssueAttachmentRecord | IssueAttachmentDraft>,
): IssueAttachmentDraftInput[] {
  return attachments.map((attachment) =>
    "id" in attachment
      ? {
          attachmentId: attachment.id,
          tempToken: null,
          sourcePath: null,
          displayName: attachment.displayName,
          mimeType: attachment.mimeType ?? null,
        }
      : {
          attachmentId: null,
          tempToken: attachment.token,
          sourcePath: attachment.sourcePath,
          displayName: attachment.displayName,
          mimeType: attachment.mimeType ?? null,
        },
  );
}

function parseIssueDescription(
  description: string,
  attachments: IssueAttachmentRecord[],
): {
  description: string;
  attachments: IssueAttachmentRecord[];
} {
  const tokenMatches = Array.from(
    description.matchAll(/\{\{issue-attachment:(\d+)\}\}/g),
  );
  const positionById = new Map<number, number>();
  tokenMatches.forEach((match, index) => {
    positionById.set(Number(match[1]), index);
  });

  const orderedAttachments = [...attachments].sort((left, right) => {
    const leftIndex = positionById.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = positionById.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });

  const visibleDescription = description
    .replace(/^\s*\{\{issue-attachment(?:-temp)?:[^}]+\}\}\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    description: visibleDescription,
    attachments: orderedAttachments,
  };
}

async function buildDraftAttachment(
  sourcePath: string,
): Promise<IssueAttachmentDraft> {
  const displayName = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
  const draft = await saveIssueAttachmentDraft({
    sourcePath,
    displayName,
  });
  return {
    token: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    displayName: draft.displayName,
    sourcePath: draft.path,
    kind: draft.kind,
    isPreviewable: draft.isPreviewable,
    absolutePath: draft.path,
  };
}

function canRunIssueFor(
  issue: Pick<IssueRecord, "status" | "linkedSessionId">,
): boolean {
  return issue.status === "backlog" && issue.linkedSessionId == null;
}

function issueStatusRank(status: IssueStatus): number {
  switch (status) {
    case "backlog":
      return 0;
    case "running":
      return 1;
    case "review":
      return 2;
    case "completed":
      return 3;
  }
}

function getIssueStatusLabel(
  status: IssueStatus,
  messages: ReturnType<typeof useI18n>["messages"],
): string {
  switch (status) {
    case "backlog":
      return messages.issues.backlog;
    case "running":
      return messages.issues.inProgress;
    case "review":
      return messages.issues.review;
    case "completed":
      return messages.issues.done;
  }
}

function toAttachmentPreviewState(
  preview: IssueAttachmentPreviewRecord,
): AttachmentPreviewState {
  return {
    displayName: preview.displayName,
    kind: preview.kind,
    textContent: preview.textContent,
    imageSrc: preview.absolutePath
      ? convertFileSrc(preview.absolutePath)
      : null,
  };
}

export {
  issueToForm,
  mergeIssue,
  formatLocalTimestamp,
  markdownToExcerpt,
  buildIssueDescription,
  serializeAttachments,
  buildDraftAttachment,
  canRunIssueFor,
  issueStatusRank,
  getIssueStatusLabel,
  toAttachmentPreviewState,
};
