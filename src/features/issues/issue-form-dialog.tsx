import { Check, ChevronDown, Paperclip, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type {
  IssueAttachmentRecord,
  IssueRecord,
  IssueStatus,
} from "./issue-commands";
import type { IssueAttachmentDraft } from "./issue-description-editor";
import { IssueDescriptionEditor } from "./issue-description-editor";
import type { DialogMode, IssueFormState } from "./issue-activity-types";

interface IssueFormDialogProps {
  mode: DialogMode;
  form: IssueFormState;
  selectedIssue: IssueRecord | null;
  isSaving: boolean;
  canDismissWithoutCloseButton: boolean;
  errorMessage: string | null;
  hasLinkedSession: boolean;
  isBacklogDialog: boolean;
  canViewSummary: boolean;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  dialogFormRef: React.RefObject<HTMLFormElement | null>;
  closeButtonRef: React.RefObject<HTMLButtonElement | null>;
  saveButtonRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLFormElement>) => void;
  onFormChange: (form: IssueFormState) => void;
  onSelectAttachment: () => void;
  onPreviewAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onDownloadAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onRemoveAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onAdvanceStatus: (targetStatus: IssueStatus) => void;
  onDeleteIssue: () => void;
  onOpenLinkedSession: () => void;
  onOpenSummary: () => void;
  canOpenAgentsActivity: boolean;
}

export function IssueFormDialog({
  mode,
  form,
  selectedIssue,
  isSaving,
  canDismissWithoutCloseButton,
  errorMessage,
  hasLinkedSession,
  isBacklogDialog,
  canViewSummary,
  titleInputRef,
  dialogFormRef,
  closeButtonRef,
  saveButtonRef,
  onClose,
  onSubmit,
  onKeyDown,
  onFormChange,
  onSelectAttachment,
  onPreviewAttachment,
  onDownloadAttachment,
  onRemoveAttachment,
  onAdvanceStatus,
  onDeleteIssue,
  onOpenLinkedSession,
  onOpenSummary,
  canOpenAgentsActivity,
}: IssueFormDialogProps) {
  const isEditableDialog = mode === "create" || isBacklogDialog;
  let dialogTitle = "Issue Detail";
  if (mode === "create") {
    dialogTitle = "New Issue";
  } else if (isBacklogDialog) {
    dialogTitle = "Edit Issue";
  }

  return (
    <div
      className="issue-dialog-overlay"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          canDismissWithoutCloseButton
        ) {
          onClose();
        }
      }}
    >
      <form
        ref={dialogFormRef}
        aria-label={dialogTitle}
        aria-modal="true"
        className={`issue-dialog${isBacklogDialog ? " issue-dialog--backlog" : ""}`}
        role="dialog"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onSubmit={onSubmit}
      >
        <div className="issue-dialog__header">
          <h3>{dialogTitle}</h3>
          <button
            ref={closeButtonRef}
            aria-label="Close issue dialog"
            className="issue-dialog__close"
            type="button"
            disabled={isSaving}
            onClick={onClose}
          >
            x
          </button>
        </div>
        <div
          className={`issue-dialog__body${isBacklogDialog ? " issue-dialog__body--single" : ""}`}
        >
          {isEditableDialog ? (
            <IssueEditableFields
              form={form}
              titleInputRef={titleInputRef}
              onFormChange={onFormChange}
              onDownloadAttachment={onDownloadAttachment}
              onPreviewAttachment={onPreviewAttachment}
              onRemoveAttachment={onRemoveAttachment}
            />
          ) : (
            <IssueReadOnlyDetails form={form} />
          )}
          {!isBacklogDialog ? (
            <IssueActionsAside
              key={`${selectedIssue?.id ?? "none"}:${selectedIssue?.status ?? "backlog"}`}
              selectedIssue={selectedIssue}
              hasLinkedSession={hasLinkedSession}
              canViewSummary={canViewSummary}
              isSaving={isSaving}
              canOpenAgentsActivity={canOpenAgentsActivity}
              onAdvanceStatus={onAdvanceStatus}
              onDeleteIssue={onDeleteIssue}
              onOpenLinkedSession={onOpenLinkedSession}
              onOpenSummary={onOpenSummary}
            />
          ) : null}
        </div>
        <p
          className="issue-dialog__status"
          role="status"
          aria-label="Dialog status"
        >
          {errorMessage}
        </p>
        {isEditableDialog ? (
          <div className="issue-dialog__footer">
            <div className="issue-dialog__footer-start">
              <Button
                aria-label="Attach file"
                className="issues-button issues-button--icon issue-dialog__attach-button"
                type="button"
                variant="ghost"
                disabled={isSaving}
                onClick={onSelectAttachment}
              >
                <Paperclip aria-hidden="true" size={15} strokeWidth={2} />
              </Button>
            </div>
            <div className="issue-dialog__footer-end">
              <Button
                ref={saveButtonRef}
                className="issues-button issues-button--primary"
                type="submit"
                disabled={isSaving}
              >
                {mode === "create" ? "Create Issue" : "Save"}
              </Button>
            </div>
          </div>
        ) : null}
      </form>
    </div>
  );
}

function IssueEditableFields({
  form,
  titleInputRef,
  onFormChange,
  onDownloadAttachment,
  onPreviewAttachment,
  onRemoveAttachment,
}: {
  form: IssueFormState;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  onFormChange: (form: IssueFormState) => void;
  onPreviewAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onDownloadAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onRemoveAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
}) {
  return (
    <div className="issue-dialog__editor issue-dialog__editor--editable">
      <div className="issue-field">
        <Input
          ref={titleInputRef}
          aria-label="Title"
          autoCapitalize="none"
          autoCorrect="off"
          name="title"
          placeholder="Issue title"
          spellCheck={false}
          value={form.title}
          onChange={(event) =>
            onFormChange({
              ...form,
              title: event.target.value,
            })
          }
        />
      </div>
      <div className="issue-field issue-field--grow">
        <IssueDescriptionEditor
          ariaLabel="Description"
          placeholder="Describe the task"
          value={form.description}
          attachments={form.attachments}
          onDownloadAttachment={onDownloadAttachment}
          onChange={(description) =>
            onFormChange({
              ...form,
              description,
            })
          }
          onPreviewAttachment={onPreviewAttachment}
          onRemoveAttachment={onRemoveAttachment}
        />
      </div>
    </div>
  );
}

function IssueReadOnlyDetails({ form }: { form: IssueFormState }) {
  return (
    <div className="issue-dialog__editor issue-dialog__editor--readonly">
      <p className="issue-detail__title">{form.title}</p>
      <div className="issue-detail__divider" aria-hidden="true" />
      <div className="issue-detail__description">{form.description}</div>
    </div>
  );
}

function IssueActionsAside({
  selectedIssue,
  hasLinkedSession,
  canViewSummary,
  isSaving,
  canOpenAgentsActivity,
  onAdvanceStatus,
  onDeleteIssue,
  onOpenLinkedSession,
  onOpenSummary,
}: {
  selectedIssue: IssueRecord | null;
  hasLinkedSession: boolean;
  canViewSummary: boolean;
  isSaving: boolean;
  canOpenAgentsActivity: boolean;
  onAdvanceStatus: (targetStatus: IssueStatus) => void;
  onDeleteIssue: () => void;
  onOpenLinkedSession: () => void;
  onOpenSummary: () => void;
}) {
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const currentStatus = selectedIssue?.status ?? "backlog";
  const currentStatusIndex = ISSUE_STATUS_ORDER.indexOf(currentStatus);

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
    <aside className="issue-dialog__side" aria-label="Issue actions">
      <section className="issue-dialog__panel issue-dialog__panel--stack">
        <div className="issue-dialog__meta-row">
          <span className="issue-dialog__meta-label">Linked session</span>
          {hasLinkedSession && selectedIssue?.linkedSessionId != null ? (
            <button
              aria-label={`Open linked session #${selectedIssue.linkedSessionId}`}
              className="issue-dialog__session-link"
              type="button"
              disabled={isSaving || !canOpenAgentsActivity}
              onClick={onOpenLinkedSession}
            >
              {`#${selectedIssue.linkedSessionId}`}
            </button>
          ) : (
            <span className="issue-dialog__meta-value">No session linked.</span>
          )}
        </div>
        <div className="issue-dialog__meta-row">
          <span className="issue-dialog__meta-label">Status</span>
          <div ref={statusMenuRef} className="issue-dialog__status-menu">
            <button
              aria-expanded={isStatusMenuOpen}
              aria-haspopup="menu"
              aria-label="Open status options"
              className="issue-dialog__status-trigger"
              disabled={isSaving}
              type="button"
              onClick={() => setIsStatusMenuOpen((currentValue) => !currentValue)}
            >
              <span>{statusLabelFor(currentStatus)}</span>
              <ChevronDown aria-hidden="true" size={14} strokeWidth={1.9} />
            </button>
            {isStatusMenuOpen ? (
              <div className="issue-dialog__status-popup" role="menu">
                {ISSUE_STATUS_ORDER.map((status) => {
                  const isCurrent = status === currentStatus;
                  const isDisabled =
                    ISSUE_STATUS_ORDER.indexOf(status) <= currentStatusIndex;

                  return (
                    <button
                      key={status}
                      className="issue-dialog__status-option"
                      disabled={isSaving || isDisabled}
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setIsStatusMenuOpen(false);
                        if (!isDisabled) {
                          onAdvanceStatus(status);
                        }
                      }}
                    >
                      <span>{statusLabelFor(status)}</span>
                      {isCurrent ? (
                        <Check aria-hidden="true" size={14} strokeWidth={2} />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
        {canViewSummary ? (
          <Button
            className="issues-button"
            disabled={isSaving}
            type="button"
            variant="outline"
            onClick={onOpenSummary}
          >
            View Summary
          </Button>
        ) : null}
        <button
          className="issue-dialog__delete-button"
          disabled={isSaving}
          type="button"
          onClick={onDeleteIssue}
        >
          <Trash2 aria-hidden="true" size={14} strokeWidth={2} />
          <span>Delete issue</span>
        </button>
      </section>
    </aside>
  );
}

const ISSUE_STATUS_ORDER: IssueStatus[] = [
  "backlog",
  "running",
  "review",
  "completed",
];

function statusLabelFor(status: IssueStatus): string {
  switch (status) {
    case "backlog":
      return "Backlog";
    case "running":
      return "In progress";
    case "review":
      return "In review";
    case "completed":
      return "Done";
  }
}
