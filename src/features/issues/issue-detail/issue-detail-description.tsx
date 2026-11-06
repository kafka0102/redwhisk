import { useMemo, type JSX } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { Download, Eye, FileText } from "lucide-react";

import type { IssueAttachmentRecord } from "../issue-commands";
import type { IssueAttachmentDraft } from "../issue-form/issue-description-editor";
import { useI18n } from "../../../shared/i18n/i18n";

// 渲染 Issue 描述为 Markdown，并把图片占位符 ![alt]({{issue-attachment:id}})
// 解析为真实 asset:// URL。无法解析的 token URL 降级为 alt 文本。
export function IssueDescriptionMarkdown({
  description,
  attachments,
  onDownloadAttachment,
  onPreviewAttachment,
}: {
  description: string;
  attachments: Array<IssueAttachmentRecord | IssueAttachmentDraft>;
  onPreviewAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onDownloadAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
}): JSX.Element {
  const { messages } = useI18n();
  const attachmentByToken = useMemo(() => {
    const map = new Map<string, IssueAttachmentRecord | IssueAttachmentDraft>();
    for (const attachment of attachments) {
      map.set(getAttachmentMarkdownToken(attachment), attachment);
    }
    return map;
  }, [attachments]);
  const descriptionSegments = useMemo(
    () => buildDescriptionSegments(description, attachments, attachmentByToken),
    [attachmentByToken, attachments, description],
  );

  const components: Components = useMemo(
    () => ({
      img({ src, alt }) {
        const token = typeof src === "string" ? src : "";
        if (token.length === 0) {
          return <span>{alt ?? ""}</span>;
        }
        const attachment = attachmentByToken.get(token);
        if (
          attachment &&
          attachment.kind === "image" &&
          "absolutePath" in attachment &&
          attachment.absolutePath
        ) {
          return (
            <img
              alt={alt ?? attachment.displayName}
              src={convertFileSrc(attachment.absolutePath)}
            />
          );
        }
        // 非 token URL 的普通图片按原样渲染；无法解析的 token 降级为 alt 文本。
        if (token.startsWith("{{issue-attachment")) {
          return <span>{alt ?? ""}</span>;
        }
        return <img alt={alt ?? ""} src={src} />;
      },
    }),
    [attachmentByToken],
  );

  return (
    <>
      {descriptionSegments.map((segment, index) =>
        segment.type === "markdown" ? (
          <ReactMarkdown
            key={`markdown-${index}`}
            remarkPlugins={[remarkGfm]}
            components={components}
          >
            {segment.content}
          </ReactMarkdown>
        ) : (
          <IssueDescriptionAttachment
            key={`attachment-${segment.token}-${index}`}
            attachment={segment.attachment}
            messages={messages}
            onDownloadAttachment={onDownloadAttachment}
            onPreviewAttachment={onPreviewAttachment}
          />
        ),
      )}
    </>
  );
}

type DescriptionSegment =
  | {
      type: "markdown";
      content: string;
    }
  | {
      type: "attachment";
      attachment: IssueAttachmentRecord | IssueAttachmentDraft;
      token: string;
    };

function buildDescriptionSegments(
  description: string,
  attachments: Array<IssueAttachmentRecord | IssueAttachmentDraft>,
  attachmentByToken: Map<string, IssueAttachmentRecord | IssueAttachmentDraft>,
): DescriptionSegment[] {
  const segments: DescriptionSegment[] = [];
  const markdownLines: string[] = [];
  const renderedTokens = new Set<string>();

  function flushMarkdownLines() {
    const content = markdownLines.join("\n").trimEnd();
    if (content.length > 0) {
      segments.push({ type: "markdown", content });
    }
    markdownLines.length = 0;
  }

  for (const line of description.replace(/\r\n/g, "\n").split("\n")) {
    const token =
      getStandaloneAttachmentToken(line) ?? getImageAttachmentToken(line);
    const attachment = token ? attachmentByToken.get(token) : null;
    if (token && attachment) {
      flushMarkdownLines();
      segments.push({ type: "attachment", attachment, token });
      renderedTokens.add(token);
      continue;
    }

    markdownLines.push(line);
  }

  flushMarkdownLines();

  for (const attachment of attachments) {
    const token = getAttachmentMarkdownToken(attachment);
    if (renderedTokens.has(token) || description.includes(token)) {
      continue;
    }
    if (attachment.kind !== "image") {
      segments.push({ type: "attachment", attachment, token });
    }
  }

  return segments;
}

function IssueDescriptionAttachment({
  attachment,
  messages,
  onDownloadAttachment,
  onPreviewAttachment,
}: {
  attachment: IssueAttachmentRecord | IssueAttachmentDraft;
  messages: ReturnType<typeof useI18n>["messages"];
  onPreviewAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onDownloadAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
}) {
  const absolutePath =
    "absolutePath" in attachment ? attachment.absolutePath : null;

  if (attachment.kind === "image" && absolutePath) {
    return (
      <img
        alt={attachment.displayName}
        className="issue-description-attachment__image"
        src={convertFileSrc(absolutePath)}
      />
    );
  }

  return (
    <div className="issue-description-attachment">
      <FileText aria-hidden="true" size={16} strokeWidth={1.8} />
      <span className="issue-description-attachment__name">
        {attachment.displayName}
      </span>
      <div className="issue-description-attachment__actions">
        {attachment.isPreviewable ? (
          <button
            aria-label={messages.issues.previewAttachment(
              attachment.displayName,
            )}
            className="issue-attachment-card__action"
            type="button"
            onClick={() => onPreviewAttachment(attachment)}
          >
            <Eye aria-hidden="true" size={14} strokeWidth={1.9} />
          </button>
        ) : null}
        <button
          aria-label={messages.issues.downloadAttachment(
            attachment.displayName,
          )}
          className="issue-attachment-card__action"
          type="button"
          onClick={() => onDownloadAttachment(attachment)}
        >
          <Download aria-hidden="true" size={14} strokeWidth={1.9} />
        </button>
      </div>
    </div>
  );
}

function getStandaloneAttachmentToken(line: string): string | null {
  const match = /^\s*(\{\{issue-attachment(?:-temp)?:[^}]+\}\})\s*$/.exec(line);
  return match?.[1] ?? null;
}

function getImageAttachmentToken(line: string): string | null {
  const match =
    /^\s*!\[[^\]]*]\((\{\{issue-attachment(?:-temp)?:[^}]+}})\)\s*$/.exec(line);
  return match?.[1] ?? null;
}

function getAttachmentMarkdownToken(
  attachment: IssueAttachmentRecord | IssueAttachmentDraft,
): string {
  if ("id" in attachment) {
    return `{{issue-attachment:${attachment.id}}}`;
  }

  return `{{issue-attachment-temp:${attachment.token}}}`;
}
