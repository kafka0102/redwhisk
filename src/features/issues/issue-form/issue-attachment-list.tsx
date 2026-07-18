import { Download, Eye, Paperclip, Trash2 } from "lucide-react";

import { useI18n } from "@/shared/i18n/i18n";
import type { IssueAttachmentRecord } from "../issue-commands";
import type { IssueAttachmentDraft } from "./issue-description-editor";

interface IssueAttachmentListProps {
  attachments: Array<IssueAttachmentRecord | IssueAttachmentDraft>;
  canRemove?: boolean;
  onPreviewAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onDownloadAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onRemoveAttachment?: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
}

export function IssueAttachmentList({
  attachments,
  canRemove = false,
  onDownloadAttachment,
  onPreviewAttachment,
  onRemoveAttachment,
}: IssueAttachmentListProps) {
  const { t } = useI18n();
  return (
    <div className="issue-page__attachment-list">
      {attachments.map((attachment) => (
        <div
          key={getAttachmentKey(attachment)}
          className="issue-page__attachment-row"
        >
          <Paperclip aria-hidden="true" size={14} strokeWidth={1.9} />
          <span className="issue-page__attachment-name">
            {attachment.displayName}
          </span>
          <div className="issue-page__attachment-actions">
            {attachment.isPreviewable ? (
              <button
                aria-label={t("issues.previewAttachment", {
                  displayName: attachment.displayName,
                })}
                className="issue-attachment-card__action"
                type="button"
                onClick={() => onPreviewAttachment(attachment)}
              >
                <Eye aria-hidden="true" size={14} strokeWidth={1.9} />
              </button>
            ) : null}
            <button
              aria-label={t("issues.downloadAttachment", {
                displayName: attachment.displayName,
              })}
              className="issue-attachment-card__action"
              type="button"
              onClick={() => onDownloadAttachment(attachment)}
            >
              <Download aria-hidden="true" size={14} strokeWidth={1.9} />
            </button>
            {canRemove ? (
              <button
                aria-label={t("issues.removeAttachment", {
                  displayName: attachment.displayName,
                })}
                className="issue-attachment-card__action"
                type="button"
                onClick={() => onRemoveAttachment?.(attachment)}
              >
                <Trash2 aria-hidden="true" size={14} strokeWidth={1.9} />
              </button>
            ) : null}
          </div>
        </div>
      ))}
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
