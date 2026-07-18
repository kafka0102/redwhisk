import type { IssueAttachmentRecord } from "./issue-commands";
import type { IssueAttachmentDraft } from "./issue-form/issue-description-editor";

export interface IssueFormState {
  title: string;
  description: string;
  attachments: Array<IssueAttachmentRecord | IssueAttachmentDraft>;
  labelIds: number[];
}

export interface AttachmentPreviewState {
  displayName: string;
  kind: "image" | "pdf" | "word" | "text" | "generic";
  textContent?: string | null;
  imageSrc?: string | null;
}

export type DialogMode = "create" | "edit";

/** 看板每个甬道默认加载的条数，滚动到底部再加载下一页。 */
export const ISSUE_PAGE_SIZE = 20;

export const EMPTY_FORM: IssueFormState = {
  title: "",
  description: "",
  attachments: [],
  labelIds: [],
};
