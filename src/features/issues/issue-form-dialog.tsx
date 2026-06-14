import { Paperclip } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type {
  AgentSessionStatus,
  IssueAttachmentRecord,
  IssueRecord,
} from "./issue-commands";
import type { IssueAttachmentDraft } from "./issue-description-editor";
import { IssueDescriptionEditor } from "./issue-description-editor";
import type { DialogMode, IssueFormState } from "./issue-activity-types";

interface IssueFormDialogProps {
  mode: DialogMode;
  form: IssueFormState;
  selectedIssue: IssueRecord | null;
  isSaving: boolean;
  isOpeningLog: boolean;
  errorMessage: string | null;
  hasLinkedSession: boolean;
  isBacklogDialog: boolean;
  canOpenSession: boolean;
  canOpenLog: boolean;
  canViewSummary: boolean;
  runStatusMessage: string | null;
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
  onOpenLinkedSession: () => void;
  onOpenLog: () => void;
  onOpenSummary: () => void;
  formatSessionStatus: (status: AgentSessionStatus | null) => string;
  canOpenAgentsActivity: boolean;
}

export function IssueFormDialog({
  mode,
  form,
  selectedIssue,
  isSaving,
  isOpeningLog,
  errorMessage,
  hasLinkedSession,
  isBacklogDialog,
  canOpenSession,
  canOpenLog,
  canViewSummary,
  runStatusMessage,
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
  onOpenLinkedSession,
  onOpenLog,
  onOpenSummary,
  formatSessionStatus,
  canOpenAgentsActivity,
}: IssueFormDialogProps) {
  const dialogTitle = mode === "create" ? "New Issue" : "Issue Detail";

  return (
    <div
      className="issue-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
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
          <div className="issue-dialog__editor">
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
            <div className="issue-field">
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
          {!isBacklogDialog ? (
            <IssueActionsAside
              mode={mode}
              selectedIssue={selectedIssue}
              hasLinkedSession={hasLinkedSession}
              canOpenSession={canOpenSession}
              canOpenLog={canOpenLog}
              canViewSummary={canViewSummary}
              isOpeningLog={isOpeningLog}
              runStatusMessage={runStatusMessage}
              canOpenAgentsActivity={canOpenAgentsActivity}
              onOpenLinkedSession={onOpenLinkedSession}
              onOpenLog={onOpenLog}
              onOpenSummary={onOpenSummary}
              formatSessionStatus={formatSessionStatus}
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
      </form>
    </div>
  );
}

function IssueActionsAside({
  mode,
  selectedIssue,
  hasLinkedSession,
  canOpenSession,
  canOpenLog,
  canViewSummary,
  isOpeningLog,
  runStatusMessage,
  canOpenAgentsActivity,
  onOpenLinkedSession,
  onOpenLog,
  onOpenSummary,
  formatSessionStatus,
}: {
  mode: DialogMode;
  selectedIssue: IssueRecord | null;
  hasLinkedSession: boolean;
  canOpenSession: boolean;
  canOpenLog: boolean;
  canViewSummary: boolean;
  isOpeningLog: boolean;
  runStatusMessage: string | null;
  canOpenAgentsActivity: boolean;
  onOpenLinkedSession: () => void;
  onOpenLog: () => void;
  onOpenSummary: () => void;
  formatSessionStatus: (status: AgentSessionStatus | null) => string;
}) {
  return (
    <aside className="issue-dialog__side" aria-label="Issue actions">
      <section className="issue-dialog__panel">
        <h4>Session</h4>
        {hasLinkedSession ? (
          <>
            <p>{`Linked session #${selectedIssue?.linkedSessionId}`}</p>
            <p>
              {`Status: ${formatSessionStatus(
                selectedIssue?.linkedSessionStatus ?? null,
              )}`}
            </p>
            {selectedIssue?.linkedSessionLogPath ? (
              <p>{`Log path: ${selectedIssue.linkedSessionLogPath}`}</p>
            ) : null}
          </>
        ) : (
          <p>No session linked.</p>
        )}
      </section>
      <section className="issue-dialog__panel">
        <h4>Actions</h4>
        {mode === "edit" && canOpenSession ? (
          <>
            <Button
              className="issues-button"
              type="button"
              variant="outline"
              disabled={!canOpenAgentsActivity}
              onClick={onOpenLinkedSession}
            >
              Open Session
            </Button>
            <p>Continue this issue from Agents.</p>
          </>
        ) : canViewSummary ? (
          <>
            <Button
              className="issues-button"
              type="button"
              variant="outline"
              onClick={onOpenSummary}
            >
              View Summary
            </Button>
            <p>Review the completed issue summary.</p>
            <Button
              className="issues-button"
              type="button"
              variant="outline"
              disabled={isOpeningLog}
              onClick={onOpenLog}
            >
              {isOpeningLog ? "打开中..." : "Open Log"}
            </Button>
            <p>Open the completed session log for review.</p>
          </>
        ) : mode === "edit" && canOpenLog ? (
          <>
            <Button
              className="issues-button"
              type="button"
              variant="outline"
              disabled={isOpeningLog}
              onClick={onOpenLog}
            >
              {isOpeningLog ? "打开中..." : "Open Log"}
            </Button>
            <p>Open the abnormal session log for diagnosis.</p>
          </>
        ) : mode === "edit" &&
          selectedIssue?.status === "backlog" &&
          !hasLinkedSession ? (
          <>{runStatusMessage ? <p>{runStatusMessage}</p> : null}</>
        ) : (
          <p>No actions available.</p>
        )}
      </section>
    </aside>
  );
}
