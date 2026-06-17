import type { IssueAttachmentRecord } from "./issue-commands";
import type { IssueAttachmentDraft } from "./issue-description-editor";

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

export const EMPTY_FORM: IssueFormState = {
  title: "",
  description: "",
  attachments: [],
  labelIds: [],
};
