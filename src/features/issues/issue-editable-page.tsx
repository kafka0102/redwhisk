import { Check, Tag } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent as UiDialogContent,
  DialogDescription as UiDialogDescription,
  DialogFooter as UiDialogFooter,
  DialogHeader as UiDialogHeader,
  DialogTitle as UiDialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "../../shared/i18n/i18n";

import type {
  IssueAttachmentRecord,
  IssueLabelRecord,
  IssueRecord,
} from "./issue-commands";
import type { DialogMode, IssueFormState } from "./issue-activity-types";
import type { IssueAttachmentDraft } from "./issue-description-editor";
import { IssueDescriptionEditor } from "./issue-description-editor";
import { IssueSurfaceHeader } from "./issue-surface-header";

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
  onSelectAttachment: () => Promise<IssueAttachmentDraft | null>;
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
  onRunIssue?: (trigger: HTMLElement | null) => void;
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
  onRunIssue,
}: IssueEditablePageProps) {
  const { messages } = useI18n();
  const pageTitle =
    mode === "create" ? messages.issues.newIssue : messages.issues.edit;
  const canDelete = mode === "edit" && selectedIssue?.status === "backlog";
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  return (
    <>
      <form
        aria-label={pageTitle}
        className="issue-page issue-page--editable issue-page--fullscreen"
        onSubmit={onSubmit}
      >
        <IssueSurfaceHeader
          title={pageTitle}
          titleLevel={2}
          variant="fullscreen"
          actions={
            <>
              <Button
                className="issues-button"
                disabled={isSaving}
                type="button"
                variant="secondary"
                onClick={onCancel}
              >
                {messages.issues.backEditable}
              </Button>
              {mode === "edit" && onRunIssue ? (
                <Button
                  className="issues-button"
                  disabled={isSaving}
                  type="button"
                  variant="secondary"
                  onClick={(event) => onRunIssue(event.currentTarget)}
                >
                  {messages.issues.run}
                </Button>
              ) : null}
              <Button
                className="issues-button issues-button--primary"
                disabled={isSaving}
                type="submit"
              >
                {mode === "create"
                  ? messages.issues.create
                  : messages.issues.save}
              </Button>
              {canDelete ? (
                <Button
                  className="issues-button issue-page__delete-button"
                  disabled={isSaving}
                  type="button"
                  variant="destructive"
                  onClick={() => setIsDeleteDialogOpen(true)}
                >
                  {messages.issues.deleteEditable}
                </Button>
              ) : null}
            </>
          }
        />

        <div className="issue-page__body issue-page__body--fullscreen">
          <div className="issue-page__content-shell">
            <IssueEditableFields
              availableLabels={availableLabels}
              form={form}
              isLoadingLabels={isLoadingLabels}
              labelsErrorMessage={labelsErrorMessage}
              titleInputRef={titleInputRef}
              onFormChange={onFormChange}
              onOpenProjectLabelsSettings={onOpenProjectLabelsSettings}
              onSelectAttachment={onSelectAttachment}
              onDownloadAttachment={onDownloadAttachment}
              onPreviewAttachment={onPreviewAttachment}
              onRemoveAttachment={onRemoveAttachment}
            />
            <p
              className="issue-dialog__status issue-page__status issue-page__status--fullscreen"
              role="status"
              aria-label={messages.issues.dialogStatus}
            >
              {errorMessage}
            </p>
          </div>
        </div>
      </form>
      <Dialog
        open={isDeleteDialogOpen}
        onOpenChange={(nextOpen) => setIsDeleteDialogOpen(nextOpen)}
      >
        <UiDialogContent
          className="issue-delete-dialog"
          showCloseButton={false}
        >
          <UiDialogHeader>
            <UiDialogTitle>{messages.issues.deleteConfirmTitle}</UiDialogTitle>
            <UiDialogDescription>
              {messages.issues.deleteConfirmMessage}
            </UiDialogDescription>
          </UiDialogHeader>
          <UiDialogFooter className="issue-delete-dialog__footer">
            <Button
              disabled={isSaving}
              type="button"
              variant="secondary"
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              {messages.issues.backEditable}
            </Button>
            <Button
              disabled={isSaving}
              type="button"
              variant="destructive"
              onClick={() => {
                setIsDeleteDialogOpen(false);
                onDeleteIssue();
              }}
            >
              {messages.issues.deleteEditable}
            </Button>
          </UiDialogFooter>
        </UiDialogContent>
      </Dialog>
    </>
  );
}

function IssueEditableFields({
  availableLabels,
  form,
  isLoadingLabels,
  labelsErrorMessage,
  titleInputRef,
  onFormChange,
  onOpenProjectLabelsSettings,
  onSelectAttachment,
  onDownloadAttachment,
  onPreviewAttachment,
  onRemoveAttachment,
}: {
  availableLabels: IssueLabelRecord[];
  form: IssueFormState;
  isLoadingLabels: boolean;
  labelsErrorMessage: string | null;
  titleInputRef: RefObject<HTMLInputElement | null>;
  onFormChange: (form: IssueFormState) => void;
  onOpenProjectLabelsSettings: () => void;
  onSelectAttachment: () => Promise<IssueAttachmentDraft | null>;
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
  const { messages } = useI18n();
  return (
    <div className="issue-page__main issue-page__main--fullscreen">
      <div className="issue-field issue-field--title">
        <Input
          ref={titleInputRef}
          id="issue-title"
          aria-label={messages.issues.titleField}
          autoCapitalize="none"
          autoCorrect="off"
          name="title"
          placeholder={messages.issues.titlePlaceholder}
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
      <div className="issue-field issue-field--grow issue-field--editor">
        <IssueDescriptionEditor
          ariaLabel={messages.issues.description}
          placeholder={messages.issues.describeTask}
          value={form.description}
          attachments={form.attachments}
          onSelectAttachment={onSelectAttachment}
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
        <div className="issue-editor-toolbar-shell">
          <div className="issue-editor-toolbar">
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
        </div>
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
  const { messages } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedLabels = labelIds
    .map((labelId) =>
      availableLabels.find((labelOption) => labelOption.id === labelId),
    )
    .filter((label): label is IssueLabelRecord => label !== undefined);
  const hasAvailableLabels = availableLabels.length > 0;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

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
    <div
      className="issue-label-picker issue-label-picker--toolbar"
      ref={rootRef}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={messages.issues.addLabel}
        className="issue-editor-toolbar__icon-button"
        type="button"
        onClick={() => setIsOpen((current) => !current)}
      >
        <Tag aria-hidden="true" size={15} strokeWidth={1.9} />
      </button>
      <div className="issue-label-picker__inline">
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
        </div>
        {isOpen ? (
          <div
            className="issue-label-picker__menu issue-label-picker__menu--dropdown"
            role="listbox"
          >
            {labelsErrorMessage ? (
              <p className="issue-label-picker__state">{labelsErrorMessage}</p>
            ) : isLoading ? (
              <p className="issue-label-picker__state">
                {messages.issues.labelsLoading}
              </p>
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
                  {messages.issues.editLabels}
                </button>
              </>
            ) : (
              <button
                className="issue-label-picker__action"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={openLabelsSettings}
              >
                {messages.issues.addLabel}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
