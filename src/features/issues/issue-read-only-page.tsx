import { Check, ChevronDown, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

import type {
  IssueAttachmentRecord,
  IssueLabelRecord,
  IssueRecord,
  IssueStatus,
} from "./issue-commands";
import type { IssueFormState } from "./issue-activity-types";
import { IssueAttachmentList } from "./issue-attachment-list";
import type { IssueAttachmentDraft } from "./issue-description-editor";
import { IssueSurfaceHeader } from "./issue-surface-header";

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
      <IssueSurfaceHeader
        title={selectedIssue ? `Issue #${selectedIssue.id}` : "Issue Detail"}
        actions={
          <>
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
          </>
        }
      />

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
      <ConfirmDialog
        confirmLabel="Delete"
        message={deleteConfirmMessage}
        onConfirm={onDeleteIssue}
      >
        <button
          className="issue-dialog__delete-button"
          disabled={isSaving}
          type="button"
        >
          <Trash2 aria-hidden="true" size={14} strokeWidth={2} />
          <span>Delete issue</span>
        </button>
      </ConfirmDialog>
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
