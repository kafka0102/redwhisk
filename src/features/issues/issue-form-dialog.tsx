import {
  Check,
  ChevronDown,
  Download,
  Eye,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

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

interface IssueEditablePageProps {
  mode: DialogMode;
  form: IssueFormState;
  isSaving: boolean;
  errorMessage: string | null;
  availableLabels: IssueLabelRecord[];
  isLoadingLabels: boolean;
  labelsErrorMessage: string | null;
  titleInputRef: RefObject<HTMLInputElement | null>;
  selectedIssue: IssueRecord | null;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
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
  onDeleteIssue: () => void;
  onOpenProjectLabelsSettings: () => void;
}

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
  onOpenLinkedSession: () => void;
  onOpenSummary: () => void;
}

export function IssueEditablePage({
  mode,
  form,
  isSaving,
  errorMessage,
  availableLabels,
  isLoadingLabels,
  labelsErrorMessage,
  titleInputRef,
  selectedIssue,
  onCancel,
  onSubmit,
  onFormChange,
  onSelectAttachment,
  onPreviewAttachment,
  onDownloadAttachment,
  onRemoveAttachment,
  onDeleteIssue,
  onOpenProjectLabelsSettings,
}: IssueEditablePageProps) {
  const pageTitle = mode === "create" ? "New Issue" : "Edit Issue";
  const canDelete = mode === "edit" && selectedIssue?.status === "backlog";
  const deleteConfirmMessage = "Are you sure to delete this issue?";

  return (
    <form
      aria-label={pageTitle}
      className="issue-page issue-page--editable"
      onSubmit={onSubmit}
    >
      <header className="issue-page__header">
        <h3>{pageTitle}</h3>
        <div className="issue-page__header-actions">
          {canDelete ? (
            <button
              className="issue-dialog__delete-link"
              disabled={isSaving}
              type="button"
              onClick={() => {
                const isConfirmed = window.confirm(deleteConfirmMessage);
                if (isConfirmed) {
                  onDeleteIssue();
                }
              }}
            >
              删除
            </button>
          ) : null}
          <Button
            className="issues-button"
            disabled={isSaving}
            type="button"
            variant="secondary"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            className="issues-button issues-button--primary"
            disabled={isSaving}
            type="submit"
          >
            {mode === "create" ? "Create Issue" : "Save"}
          </Button>
        </div>
      </header>

      <div className="issue-page__body">
        <IssueEditableFields
          form={form}
          titleInputRef={titleInputRef}
          onFormChange={onFormChange}
          onDownloadAttachment={onDownloadAttachment}
          onPreviewAttachment={onPreviewAttachment}
          onRemoveAttachment={onRemoveAttachment}
        />
        <aside className="issue-page__side" aria-label="Issue metadata">
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
          <div className="issue-page__divider" aria-hidden="true" />
          <section className="issue-dialog__panel">
            <div className="issue-page__section-header">
              <h4>附件</h4>
              <Button
                aria-label="Attach file"
                className="issues-button issues-button--icon issue-dialog__attach-button"
                disabled={isSaving}
                type="button"
                variant="ghost"
                onClick={onSelectAttachment}
              >
                <Plus aria-hidden="true" size={14} strokeWidth={2} />
              </Button>
            </div>
            <p>{form.attachments.length} 个附件</p>
          </section>
        </aside>
      </div>

      <p
        className="issue-dialog__status issue-page__status"
        role="status"
        aria-label="Dialog status"
      >
        {errorMessage}
      </p>
    </form>
  );
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
  onOpenLinkedSession,
  onOpenSummary,
}: IssueReadOnlyPageProps) {
  const labels = selectedIssue?.labels ?? [];

  return (
    <section
      aria-label="Issue Detail"
      className="issue-page issue-page--readonly"
    >
      <header className="issue-page__header">
        <h3>{selectedIssue ? `Issue #${selectedIssue.id}` : "Issue Detail"}</h3>
        <div className="issue-page__header-actions">
          <Button
            className="issues-button"
            disabled={isSaving}
            type="button"
            variant="secondary"
            onClick={onBack}
          >
            返回
          </Button>
          <StatusMenu
            isSaving={isSaving}
            selectedIssue={selectedIssue}
            onAdvanceStatus={onAdvanceStatus}
          />
        </div>
      </header>

      <div className="issue-page__body">
        <IssueReadOnlyDetails form={form} />
        <aside className="issue-page__side" aria-label="Issue actions">
          <IssueActionsAside
            selectedIssue={selectedIssue}
            hasLinkedSession={hasLinkedSession}
            canViewSummary={canViewSummary}
            isSaving={isSaving}
            canOpenAgentsActivity={canOpenAgentsActivity}
            onDeleteIssue={onDeleteIssue}
            onOpenLinkedSession={onOpenLinkedSession}
            onOpenSummary={onOpenSummary}
          />
          <div className="issue-page__divider" aria-hidden="true" />
          <IssueReadOnlyLabels labels={labels} />
          {form.attachments.length > 0 ? (
            <>
              <div className="issue-page__divider" aria-hidden="true" />
              <section className="issue-dialog__panel">
                <h4>附件</h4>
                <IssueAttachmentList
                  attachments={form.attachments}
                  onDownloadAttachment={onDownloadAttachment}
                  onPreviewAttachment={onPreviewAttachment}
                />
              </section>
            </>
          ) : null}
        </aside>
      </div>

      <p
        className="issue-dialog__status issue-page__status"
        role="status"
        aria-label="Dialog status"
      >
        {errorMessage}
      </p>
    </section>
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
  titleInputRef: RefObject<HTMLInputElement | null>;
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
    <div className="issue-dialog__editor issue-dialog__editor--editable issue-page__main">
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
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
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
    <article className="issue-dialog__editor issue-dialog__editor--readonly issue-page__main">
      <h1 className="issue-detail__title">{form.title}</h1>
      <div className="issue-detail__divider" aria-hidden="true" />
      <div className="issue-detail__description">{form.description}</div>
    </article>
  );
}

function IssueReadOnlyLabels({ labels }: { labels: IssueLabelRecord[] }) {
  return (
    <section className="issue-dialog__panel">
      <h4>Labels</h4>
      {labels.length > 0 ? (
        <div className="issue-label-picker__selected">
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
      ) : (
        <p>No labels.</p>
      )}
    </section>
  );
}

function IssueActionsAside({
  selectedIssue,
  hasLinkedSession,
  canViewSummary,
  isSaving,
  canOpenAgentsActivity,
  onDeleteIssue,
  onOpenLinkedSession,
  onOpenSummary,
}: {
  selectedIssue: IssueRecord | null;
  hasLinkedSession: boolean;
  canViewSummary: boolean;
  isSaving: boolean;
  canOpenAgentsActivity: boolean;
  onDeleteIssue: () => void;
  onOpenLinkedSession: () => void;
  onOpenSummary: () => void;
}) {
  const deleteConfirmMessage = "Are you sure to delete this issue?";

  return (
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
          if (isConfirmed) {
            onDeleteIssue();
          }
        }}
      >
        <Trash2 aria-hidden="true" size={14} strokeWidth={2} />
        <span>Delete issue</span>
      </button>
    </section>
  );
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
  );
}

function IssueAttachmentList({
  attachments,
  canRemove = false,
  onDownloadAttachment,
  onPreviewAttachment,
  onRemoveAttachment,
}: {
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
}) {
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
                aria-label={`查看 ${attachment.displayName}`}
                className="issue-attachment-card__action"
                type="button"
                onClick={() => onPreviewAttachment(attachment)}
              >
                <Eye aria-hidden="true" size={14} strokeWidth={1.9} />
              </button>
            ) : null}
            <button
              aria-label={`下载 ${attachment.displayName}`}
              className="issue-attachment-card__action"
              type="button"
              onClick={() => onDownloadAttachment(attachment)}
            >
              <Download aria-hidden="true" size={14} strokeWidth={1.9} />
            </button>
            {canRemove ? (
              <button
                aria-label={`删除 ${attachment.displayName}`}
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
