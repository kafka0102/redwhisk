import { Button } from "@/components/ui/button";

import type { AttachmentPreviewState } from "./issue-activity-types";

interface IssueAttachmentPreviewDialogProps {
  preview: AttachmentPreviewState;
  onClose: () => void;
}

export function IssueAttachmentPreviewDialog({
  preview,
  onClose,
}: IssueAttachmentPreviewDialogProps) {
  return (
    <div
      className="issue-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        aria-label="Attachment Preview"
        aria-modal="true"
        className="issue-dialog issue-dialog--compact"
        role="dialog"
      >
        <div className="issue-dialog__header">
          <h3>{preview.displayName}</h3>
          <button
            aria-label="Close attachment preview"
            className="issue-dialog__close"
            type="button"
            onClick={onClose}
          >
            x
          </button>
        </div>
        <div className="issue-dialog__body issue-dialog__body--single">
          <div className="issue-dialog__editor">
            {preview.imageSrc ? (
              <img
                alt={preview.displayName}
                className="issue-attachment-preview__image"
                src={preview.imageSrc}
              />
            ) : (
              <pre className="completion-preview__prompt">
                {preview.textContent}
              </pre>
            )}
          </div>
        </div>
        <div className="issue-dialog__footer">
          <Button
            className="issues-button"
            type="button"
            variant="outline"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
