import {
  Check,
  ChevronDown,
  Download,
  Ellipsis,
  Eye,
  FileText,
  MessageSquare,
  Pencil,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";

import { Button } from "@/components/ui/button";
import { ConfirmContent } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type {
  IssueAttachmentRecord,
  IssueLabelRecord,
  IssueRecord,
  IssueStatus,
} from "./issue-commands";
import type { IssueFormState } from "./issue-activity-types";
import type { IssueAttachmentDraft } from "./issue-description-editor";
import { IssueReadonlySessionPanel } from "./issue-readonly-session-panel";
import { IssueSurfaceHeader } from "./issue-surface-header";
import { useI18n } from "../../shared/i18n/i18n";

interface IssueReadOnlyPageProps {
  form: IssueFormState;
  selectedIssue: IssueRecord | null;
  isSaving: boolean;
  errorMessage: string | null;
  hasLinkedSession: boolean;
  canViewSummary: boolean;
  canOpenAgentsActivity: boolean;
  onBack: () => void;
  onPreviewAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onDownloadAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onAdvanceStatus: (targetStatus: IssueStatus) => void;
  onDeleteIssue: () => void;
  onEditIssue: () => void;
  onOpenLinkedSession: () => void;
  onOpenSummary: () => void;
}

export function IssueReadOnlyPage({
  form,
  selectedIssue,
  isSaving,
  errorMessage,
  hasLinkedSession,
  canViewSummary,
  canOpenAgentsActivity,
  onBack,
  onPreviewAttachment,
  onDownloadAttachment,
  onAdvanceStatus,
  onDeleteIssue,
  onEditIssue,
  onOpenLinkedSession,
  onOpenSummary,
}: IssueReadOnlyPageProps) {
  const { messages } = useI18n();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const labels = selectedIssue?.labels ?? [];
  const title = selectedIssue
    ? messages.issues.detailTitle(selectedIssue.number)
    : messages.issues.detailFallbackTitle;
  const rawDescription = selectedIssue?.description ?? form.description;
  const linkedSessionId = selectedIssue?.linkedSessionId ?? null;
  const projectId = selectedIssue?.projectId ?? 0;

  return (
    <section
      aria-label={messages.issues.detailRegionLabel}
      className="issue-page issue-page--readonly issue-page--fullscreen"
    >
      <IssueSurfaceHeader
        title={title}
        titleLevel={2}
        variant="fullscreen"
        actions={
          <>
            <Button
              className="issues-button"
              disabled={isSaving}
              type="button"
              variant="secondary"
              onClick={onBack}
            >
              {messages.issues.backReadonly}
            </Button>
            <StatusMenu
              isSaving={isSaving}
              selectedIssue={selectedIssue}
              onAdvanceStatus={onAdvanceStatus}
            />
            <IssueMoreMenu
              canOpenAgentsActivity={canOpenAgentsActivity}
              canViewSummary={canViewSummary}
              hasLinkedSession={hasLinkedSession}
              isSaving={isSaving}
              onDeleteIssue={() => setIsDeleteDialogOpen(true)}
              onEditIssue={onEditIssue}
              onOpenLinkedSession={onOpenLinkedSession}
              onOpenSummary={onOpenSummary}
            />
          </>
        }
      />

      <div className="issue-page__body issue-page__body--readonly-fullscreen">
        <div className="issue-page__content-shell issue-page__content-shell--readonly">
          <IssueReadOnlyDetails
            attachments={form.attachments}
            description={rawDescription}
            labels={labels}
            title={form.title}
            onDownloadAttachment={onDownloadAttachment}
            onPreviewAttachment={onPreviewAttachment}
          />
        </div>
        <aside
          aria-label={messages.agentsFeature.sessionInfo}
          className="issue-page__side issue-page__side--readonly"
        >
          <IssueReadonlySessionPanel
            canOpenSession={hasLinkedSession && canOpenAgentsActivity}
            linkedSessionId={linkedSessionId}
            projectId={projectId}
            onOpenSession={onOpenLinkedSession}
          />
        </aside>
      </div>

      <p
        className="issue-dialog__status issue-page__status issue-page__status--fullscreen"
        role="status"
        aria-label={messages.issues.statusLabel}
      >
        {errorMessage}
      </p>
      <Dialog
        open={isDeleteDialogOpen}
        onOpenChange={(nextOpen) => setIsDeleteDialogOpen(nextOpen)}
      >
        <ConfirmContent
          cancelLabel={messages.issues.completionCancel}
          confirmLabel={messages.issues.deleteReadonly}
          confirmVariant="destructive"
          message={messages.issues.deleteConfirmMessage}
          onCancel={() => setIsDeleteDialogOpen(false)}
          onConfirm={() => {
            setIsDeleteDialogOpen(false);
            onDeleteIssue();
          }}
        />
      </Dialog>
    </section>
  );
}

function IssueReadOnlyDetails({
  attachments,
  description,
  labels,
  title,
  onDownloadAttachment,
  onPreviewAttachment,
}: {
  attachments: Array<IssueAttachmentRecord | IssueAttachmentDraft>;
  description: string;
  labels: IssueLabelRecord[];
  title: string;
  onPreviewAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onDownloadAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
}) {
  return (
    <article className="issue-dialog__editor issue-dialog__editor--readonly issue-page__main issue-page__main--fullscreen issue-page__main--readonly">
      <h1 className="issue-detail__title">{title}</h1>
      <div className="issue-detail__divider" aria-hidden="true" />
      <div className="issue-detail__description">
        <IssueDescriptionMarkdown
          description={description}
          attachments={attachments}
          onDownloadAttachment={onDownloadAttachment}
          onPreviewAttachment={onPreviewAttachment}
        />
      </div>
      {labels.length > 0 ? (
        <>
          <div className="issue-detail__divider" aria-hidden="true" />
          <IssueReadOnlyLabels labels={labels} />
        </>
      ) : null}
    </article>
  );
}

// 渲染 Issue 描述为 Markdown，并把图片占位符 ![alt]({{issue-attachment:id}})
// 解析为真实 asset:// URL（由附件记录的 absolutePath 经 convertFileSrc 转换）。
// 非 token URL 的普通图片按原样渲染；无法解析的 token URL 降级为 alt 文本。
function IssueDescriptionMarkdown({
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
}) {
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

function IssueReadOnlyLabels({ labels }: { labels: IssueLabelRecord[] }) {
  return (
    <div className="issue-label-picker__selected issue-detail__labels">
      {labels.map((label) => (
        <span
          key={label.id}
          className="issue-label-chip"
          style={{ backgroundColor: label.color }}
        >
          <span>{label.name}</span>
        </span>
      ))}
    </div>
  );
}

function IssueMoreMenu({
  hasLinkedSession,
  canViewSummary,
  isSaving,
  canOpenAgentsActivity,
  onDeleteIssue,
  onEditIssue,
  onOpenLinkedSession,
  onOpenSummary,
}: {
  hasLinkedSession: boolean;
  canViewSummary: boolean;
  isSaving: boolean;
  canOpenAgentsActivity: boolean;
  onDeleteIssue: () => void;
  onEditIssue: () => void;
  onOpenLinkedSession: () => void;
  onOpenSummary: () => void;
}) {
  const { messages } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={messages.issues.moreActions}
        className="issues-button issue-page__more-button"
        disabled={isSaving}
      >
        <Ellipsis aria-hidden="true" size={16} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="issue-page__more-menu">
        <DropdownMenuItem disabled={isSaving} onClick={onEditIssue}>
          <Pencil aria-hidden="true" size={14} strokeWidth={1.8} />
          {messages.issues.edit}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isSaving || !hasLinkedSession || !canOpenAgentsActivity}
          onClick={onOpenLinkedSession}
        >
          <MessageSquare aria-hidden="true" size={14} strokeWidth={1.8} />
          {messages.issues.viewSession}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isSaving || !canViewSummary}
          onClick={onOpenSummary}
        >
          <FileText aria-hidden="true" size={14} strokeWidth={1.8} />
          {messages.issues.viewSummary}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isSaving}
          variant="destructive"
          onClick={onDeleteIssue}
        >
          <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
          {messages.issues.deleteReadonly}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

function StatusMenu({
  selectedIssue,
  isSaving,
  onAdvanceStatus,
}: {
  selectedIssue: IssueRecord | null;
  isSaving: boolean;
  onAdvanceStatus: (targetStatus: IssueStatus) => void;
}) {
  const { messages } = useI18n();
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const currentStatus = selectedIssue?.status ?? "backlog";

  useEffect(() => {
    if (!isStatusMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!statusMenuRef.current?.contains(event.target as Node)) {
        setIsStatusMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [isStatusMenuOpen]);

  return (
    <div ref={statusMenuRef} className="issue-dialog__status-menu">
      <Button
        aria-expanded={isStatusMenuOpen}
        aria-haspopup="menu"
        aria-label={messages.issues.openStatusOptions}
        className="issue-dialog__status-trigger"
        disabled={isSaving}
        size="sm"
        type="button"
        variant="outline"
        onClick={() => setIsStatusMenuOpen((currentValue) => !currentValue)}
      >
        <span>{statusLabelFor(currentStatus, messages)}</span>
        <ChevronDown aria-hidden="true" size={14} strokeWidth={1.9} />
      </Button>
      {isStatusMenuOpen ? (
        <div className="issue-dialog__status-popup" role="menu">
          {ISSUE_STATUS_ORDER.map((status) => {
            const isCurrent = status === currentStatus;

            return (
              <button
                key={status}
                className="issue-dialog__status-option"
                disabled={isSaving || isCurrent}
                role="menuitem"
                type="button"
                onClick={() => {
                  setIsStatusMenuOpen(false);
                  if (!isCurrent) {
                    onAdvanceStatus(status);
                  }
                }}
              >
                <span>{statusLabelFor(status, messages)}</span>
                {isCurrent ? (
                  <Check aria-hidden="true" size={14} strokeWidth={2} />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const ISSUE_STATUS_ORDER: IssueStatus[] = [
  "backlog",
  "running",
  "review",
  "completed",
];

function statusLabelFor(
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
