import { useEffect, useRef } from "react";
import {
  Download,
  Eye,
  File,
  FileImage,
  FileText,
  FileType2,
  Trash2,
} from "lucide-react";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

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

function normalizeMarkdown(markdown: string): string {
  return markdown.trimEnd();
}

export function IssueDescriptionEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
  attachments = [],
  onPreviewAttachment,
  onDownloadAttachment,
  onRemoveAttachment,
}: IssueDescriptionEditorProps) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    immediatelyRender: false,
    content: value,
    contentType: "markdown",
    extensions: [
      StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Markdown,
    ],
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        "aria-multiline": "true",
        autocapitalize: "none",
        autocorrect: "off",
        class: "issue-description-editor__content",
        role: "textbox",
        spellcheck: "false",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChangeRef.current(normalizeMarkdown(currentEditor.getMarkdown()));
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }

    const currentValue = normalizeMarkdown(editor.getMarkdown());
    const nextValue = normalizeMarkdown(value);

    if (currentValue === nextValue) {
      return;
    }

    editor.commands.setContent(nextValue, {
      contentType: "markdown",
      emitUpdate: false,
    });
  }, [editor, value]);

  return (
    <div
      className="issue-description-editor"
      data-empty={normalizeMarkdown(value).length === 0 ? "true" : undefined}
    >
      <span className="issue-description-editor__placeholder">
        {placeholder}
      </span>
      <div className="issue-description-editor__surface">
        <EditorContent editor={editor} />
      </div>
      {attachments.length > 0 ? (
        <div className="issue-description-editor__attachments">
          {attachments.map((attachment) => (
            <div
              key={getAttachmentKey(attachment)}
              className="issue-attachment-card"
            >
              <div className="issue-attachment-card__main">
                <span
                  className="issue-attachment-card__icon"
                  aria-hidden="true"
                >
                  <AttachmentKindIcon kind={attachment.kind} />
                </span>
                <span className="issue-attachment-card__name">
                  {attachment.displayName}
                </span>
              </div>
              <div className="issue-attachment-card__actions">
                {attachment.isPreviewable ? (
                  <button
                    aria-label={`查看 ${attachment.displayName}`}
                    className="issue-attachment-card__action"
                    type="button"
                    onClick={() => onPreviewAttachment?.(attachment)}
                  >
                    <Eye aria-hidden="true" size={15} strokeWidth={1.9} />
                  </button>
                ) : null}
                <button
                  aria-label={`下载 ${attachment.displayName}`}
                  className="issue-attachment-card__action"
                  type="button"
                  onClick={() => onDownloadAttachment?.(attachment)}
                >
                  <Download aria-hidden="true" size={15} strokeWidth={1.9} />
                </button>
                <button
                  aria-label={`删除 ${attachment.displayName}`}
                  className="issue-attachment-card__action"
                  type="button"
                  onClick={() => onRemoveAttachment?.(attachment)}
                >
                  <Trash2 aria-hidden="true" size={15} strokeWidth={1.9} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getAttachmentKey(
  attachment: IssueAttachmentRecord | IssueAttachmentDraft,
): string {
  if ("id" in attachment) {
    return `saved-${attachment.id}`;
  }

  return `draft-${attachment.token}`;
}

function AttachmentKindIcon({
  kind,
}: {
  kind: IssueAttachmentRecord["kind"] | IssueAttachmentDraft["kind"];
}) {
  switch (kind) {
    case "image":
      return <FileImage size={20} strokeWidth={1.8} />;
    case "pdf":
      return <FileType2 size={20} strokeWidth={1.8} />;
    case "word":
      return <FileText size={20} strokeWidth={1.8} />;
    case "text":
      return <FileText size={20} strokeWidth={1.8} />;
    default:
      return <File size={20} strokeWidth={1.8} />;
  }
}
