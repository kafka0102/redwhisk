import type { IssueFormState } from "../issue-activity-types";

type IssueFormAttachment = IssueFormState["attachments"][number];

/**
 * 判断 Issue 表单相对基线是否有未保存改动。
 * 创建态基线为空表单；编辑态基线为已保存 issue 转换出的表单。
 * 标题按字符串、描述按 trim 后文本比较；附件按身份集合（顺序无关）比较；
 * labelIds 按有序数组比较（选择顺序即提交顺序）。
 */
export function isIssueFormDirty(
  current: IssueFormState,
  baseline: IssueFormState,
): boolean {
  if (current.title !== baseline.title) {
    return true;
  }
  if (current.description.trim() !== baseline.description.trim()) {
    return true;
  }
  if (!areAttachmentsEqual(current.attachments, baseline.attachments)) {
    return true;
  }
  return !areLabelIdsEqual(current.labelIds, baseline.labelIds);
}

function areAttachmentsEqual(
  current: IssueFormAttachment[],
  baseline: IssueFormAttachment[],
): boolean {
  if (current.length !== baseline.length) {
    return false;
  }
  const currentKeys = current.map(attachmentIdentityKey).sort().join("\n");
  const baselineKeys = baseline.map(attachmentIdentityKey).sort().join("\n");
  return currentKeys === baselineKeys;
}

function attachmentIdentityKey(attachment: IssueFormAttachment): string {
  const identity =
    "id" in attachment ? `id:${attachment.id}` : `token:${attachment.token}`;
  return `${identity} ${attachment.kind} ${attachment.displayName}`;
}

function areLabelIdsEqual(current: number[], baseline: number[]): boolean {
  if (current.length !== baseline.length) {
    return false;
  }
  return current.every((id, index) => id === baseline[index]);
}
