import { convertFileSrc } from "@tauri-apps/api/core";
import { useRef } from "react";

import {
  RichTextEditor,
  type RichTextAttachment,
  type RichTextEditorLabels,
} from "@/components/ui/rich-text-editor";
import { useI18n } from "../../shared/i18n/i18n";
import type { I18nMessages } from "../../shared/i18n/messages";

import type { IssueAttachmentRecord } from "./issue-commands";

export interface IssueAttachmentDraft {
  token: string;
  displayName: string;
  sourcePath: string;
  mimeType?: string | null;
  kind: "image" | "pdf" | "word" | "text" | "generic";
  isPreviewable: boolean;
  attachmentId?: number | null;
  relativePath?: string | null;
  absolutePath?: string | null;
}

interface IssueDescriptionEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  attachments?: Array<IssueAttachmentRecord | IssueAttachmentDraft>;
  onSelectAttachment?: (
    filter?: "image" | "file",
  ) => Promise<IssueAttachmentDraft | null>;
  onPreviewAttachment?: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onDownloadAttachment?: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onRemoveAttachment?: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
}

export function IssueDescriptionEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
  attachments = [],
  onSelectAttachment,
  onPreviewAttachment,
  onDownloadAttachment,
  onRemoveAttachment,
}: IssueDescriptionEditorProps) {
  const { messages } = useI18n();
  const uploadedAttachmentsRef = useRef(
    new Map<string, IssueAttachmentRecord | IssueAttachmentDraft>(),
  );
  const attachmentByToken = new Map(
    attachments.map((attachment) => [
      getRichTextAttachmentToken(attachment),
      attachment,
    ]),
  );

  async function handleUploadAttachment(
    filter?: "image" | "file",
  ): Promise<RichTextAttachment | null> {
    const attachment = await onSelectAttachment?.(filter);
    if (!attachment) {
      return null;
    }

    const richTextAttachment = toRichTextAttachment(attachment);
    uploadedAttachmentsRef.current.set(richTextAttachment.token, attachment);
    return richTextAttachment;
  }

  function resolveAttachment(attachment: RichTextAttachment) {
    return (
      attachmentByToken.get(attachment.token) ??
      uploadedAttachmentsRef.current.get(attachment.token) ??
      null
    );
  }

  return (
    <RichTextEditor
      ariaLabel={ariaLabel}
      attachments={attachments.map(toRichTextAttachment)}
      labels={toRichTextLabels(messages)}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      onDownloadAttachment={(attachment) => {
        const issueAttachment = resolveAttachment(attachment);
        if (issueAttachment) {
          onDownloadAttachment?.(issueAttachment);
        }
      }}
      onPreviewAttachment={(attachment) => {
        const issueAttachment = resolveAttachment(attachment);
        if (issueAttachment) {
          onPreviewAttachment?.(issueAttachment);
        }
      }}
      onRemoveAttachment={(attachment) => {
        const issueAttachment = resolveAttachment(attachment);
        if (issueAttachment) {
          uploadedAttachmentsRef.current.delete(attachment.token);
          onRemoveAttachment?.(issueAttachment);
        }
      }}
      onUploadAttachment={
        onSelectAttachment ? () => handleUploadAttachment("file") : undefined
      }
      onUploadImage={
        onSelectAttachment ? () => handleUploadAttachment("image") : undefined
      }
    />
  );
}

function toRichTextAttachment(
  attachment: IssueAttachmentRecord | IssueAttachmentDraft,
): RichTextAttachment {
  const absolutePath =
    "absolutePath" in attachment ? attachment.absolutePath : undefined;

  return {
    token: getRichTextAttachmentToken(attachment),
    displayName: attachment.displayName,
    kind: attachment.kind,
    markdownToken: getAttachmentMarkdownToken(attachment),
    isPreviewable: attachment.isPreviewable,
    imageSrc:
      attachment.kind === "image" && absolutePath
        ? convertFileSrc(absolutePath)
        : null,
  };
}

function getRichTextAttachmentToken(
  attachment: IssueAttachmentRecord | IssueAttachmentDraft,
): string {
  if ("id" in attachment) {
    return `saved-${attachment.id}`;
  }

  return `draft-${attachment.token}`;
}

function getAttachmentMarkdownToken(
  attachment: IssueAttachmentRecord | IssueAttachmentDraft,
): string {
  if ("id" in attachment) {
    return `{{issue-attachment:${attachment.id}}}`;
  }

  return `{{issue-attachment-temp:${attachment.token}}}`;
}

function toRichTextLabels(messages: I18nMessages): RichTextEditorLabels {
  return {
    attachFile: messages.richText.attachFile,
    bold: messages.richText.bold,
    clearFormatting: messages.richText.clearFormatting,
    codeBlock: messages.richText.codeBlock,
    codeQuote: messages.richText.codeQuote,
    heading: messages.richText.heading,
    image: messages.richText.image,
    headingOne: messages.richText.headingOne,
    headingTwo: messages.richText.headingTwo,
    normalText: messages.richText.normalText,
    orderedList: messages.richText.orderedList,
    unorderedList: messages.richText.unorderedList,
    previewAttachment: (displayName) =>
      messages.issues.previewAttachment(displayName),
    downloadAttachment: (displayName) =>
      messages.issues.downloadAttachment(displayName),
    removeAttachment: (displayName) =>
      messages.issues.removeAttachment(displayName),
  };
}
