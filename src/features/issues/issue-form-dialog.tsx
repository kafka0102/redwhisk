import { Check, Plus, Paperclip, Trash2, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type {
  IssueAttachmentRecord,
  IssueLabelRecord,
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
  availableLabels: IssueLabelRecord[];
  isLoadingLabels: boolean;
  labelsErrorMessage: string | null;
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
  onOpenProjectLabelsSettings: () => void;
  canOpenAgentsActivity: boolean;
}

export function IssueFormDialog({
  mode,
  form,
  selectedIssue,
  isSaving,
  canDismissWithoutCloseButton,
  errorMessage,
  availableLabels,
  isLoadingLabels,
  labelsErrorMessage,
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
  onOpenProjectLabelsSettings,
  canOpenAgentsActivity,
}: IssueFormDialogProps) {
  const isEditableDialog = mode === "create" || isBacklogDialog;
  const canDeleteFromHeader = mode === "edit" && isBacklogDialog;
  const deleteConfirmMessage = "Are you sure to delete this issue?";
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
          <div className="issue-dialog__header-actions">
            {canDeleteFromHeader ? (
              <button
                className="issue-dialog__delete-link"
                disabled={isSaving}
                type="button"
                onClick={() => {
                  const isConfirmed = window.confirm(deleteConfirmMessage);
                  if (!isConfirmed) {
                    return;
                  }

                  onDeleteIssue();
                }}
              >
                删除
              </button>
            ) : null}
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
        {isEditableDialog ? (
          <div className="issue-dialog__labels-section">
            <IssueLabelsPicker
              availableLabels={availableLabels}
              isLoading={isLoadingLabels}
              labelIds={form.labelIds}
              labelsErrorMessage={labelsErrorMessage}
              onChange={(labelIds) =>
                onFormChange({
                  ...form,
                  labelIds,
                })
              }
              onOpenProjectLabelsSettings={onOpenProjectLabelsSettings}
            />
          </div>
        ) : null}
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
          id="issue-title"
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

function IssueLabelsPicker({
  availableLabels,
  isLoading,
  labelIds,
  labelsErrorMessage,
  onChange,
  onOpenProjectLabelsSettings,
}: {
  availableLabels: IssueLabelRecord[];
  isLoading: boolean;
  labelIds: number[];
  labelsErrorMessage: string | null;
  onChange: (labelIds: number[]) => void;
  onOpenProjectLabelsSettings: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const selectedLabels = labelIds
    .map((labelId) =>
      availableLabels.find((labelOption) => labelOption.id === labelId),
    )
    .filter((label): label is IssueLabelRecord => label !== undefined);
  const hasAvailableLabels = availableLabels.length > 0;

  useEffect(() => {
    if (!isOpen || !triggerRef.current) {
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPosition({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
    });

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  function toggleLabel(labelId: number) {
    onChange(
      labelIds.includes(labelId)
        ? labelIds.filter((value) => value !== labelId)
        : [...labelIds, labelId],
    );
  }

  function openLabelsSettings() {
    setIsOpen(false);
    onOpenProjectLabelsSettings();
  }

  return (
    <div className="issue-field issue-field--labels" ref={rootRef}>
      <span className="issue-field__label">Labels</span>
      <div className="issue-label-picker" ref={triggerRef}>
        <div className="issue-label-picker__trigger-area">
          <div className="issue-label-picker__selected">
            {selectedLabels.map((label) => (
              <span
                key={label.id}
                className="issue-label-chip"
                style={{ backgroundColor: label.color }}
              >
                <span>{label.name}</span>
              </span>
            ))}
          </div>
          <span
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            aria-label="添加标签"
            className="issue-label-picker__add-icon"
            role="button"
            tabIndex={0}
            onClick={() => setIsOpen((current) => !current)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsOpen((current) => !current);
              }
            }}
          >
            <Plus aria-hidden="true" size={14} strokeWidth={2} />
          </span>
        </div>
        {isOpen ? (
          <div
            className="issue-label-picker__menu issue-label-picker__menu--fixed"
            role="listbox"
            style={{
              position: "fixed",
              top: menuPosition.top,
              left: menuPosition.left,
            }}
          >
            {labelsErrorMessage ? (
              <p className="issue-label-picker__state">{labelsErrorMessage}</p>
            ) : isLoading ? (
              <p className="issue-label-picker__state">加载 Labels...</p>
            ) : hasAvailableLabels ? (
              <>
                <div className="issue-label-picker__options">
                  {availableLabels.map((label) => {
                    const isSelected = labelIds.includes(label.id);

                    return (
                      <button
                        key={label.id}
                        aria-selected={isSelected}
                        className="issue-label-picker__option issue-label-picker__option--simple"
                        role="option"
                        tabIndex={-1}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => toggleLabel(label.id)}
                      >
                        <span
                          className="issue-label-picker__option-color-dot"
                          style={{ backgroundColor: label.color }}
                          aria-hidden="true"
                        />
                        <span className="issue-label-picker__option-name">
                          {label.name}
                        </span>
                        {isSelected ? (
                          <Check
                            className="issue-label-picker__option-check-simple"
                            aria-hidden="true"
                            size={14}
                            strokeWidth={2}
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                <div
                  className="issue-label-picker__divider"
                  aria-hidden="true"
                />
                <button
                  className="issue-label-picker__action"
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={openLabelsSettings}
                >
                  编辑 Labels
                </button>
              </>
            ) : (
              <button
                className="issue-label-picker__action"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={openLabelsSettings}
              >
                添加标签
              </button>
            )}
          </div>
        ) : null}
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
  const deleteConfirmMessage = "Are you sure to delete this issue?";

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
              onClick={() =>
                setIsStatusMenuOpen((currentValue) => !currentValue)
              }
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
          onClick={() => {
            const isConfirmed = window.confirm(deleteConfirmMessage);
            if (!isConfirmed) {
              return;
            }

            onDeleteIssue();
          }}
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
