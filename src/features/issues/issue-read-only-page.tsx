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
  const { messages } = useI18n();
  const labels = selectedIssue?.labels ?? [];
  const title = selectedIssue
    ? messages.issues.detailTitle(selectedIssue.id)
    : messages.issues.detailFallbackTitle;

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
              {messages.issues.back}
            </Button>
            <StatusMenu
              isSaving={isSaving}
              selectedIssue={selectedIssue}
              onAdvanceStatus={onAdvanceStatus}
            />
            <ConfirmDialog
              confirmLabel={messages.issues.delete}
              message={messages.issues.deleteConfirmMessage}
              title={messages.issues.deleteConfirmTitle}
              onConfirm={onDeleteIssue}
            >
              <Button
                className="issues-button issue-page__delete-button"
                disabled={isSaving}
                type="button"
                variant="destructive"
              >
                <Trash2 aria-hidden="true" size={14} strokeWidth={2} />
                {messages.issues.delete}
              </Button>
            </ConfirmDialog>
          </>
        }
      />

      <div className="issue-page__body issue-page__body--readonly-fullscreen">
        <IssueReadOnlyDetails form={form} />
        <aside
          className="issue-page__side"
          aria-label={messages.issues.actionsLabel}
        >
          <IssueActionsAside
            selectedIssue={selectedIssue}
            hasLinkedSession={hasLinkedSession}
            canViewSummary={canViewSummary}
            isSaving={isSaving}
            canOpenAgentsActivity={canOpenAgentsActivity}
            messages={messages}
            onOpenLinkedSession={onOpenLinkedSession}
            onOpenSummary={onOpenSummary}
          />
          <div className="issue-page__divider" aria-hidden="true" />
          <IssueReadOnlyLabels labels={labels} messages={messages} />
          {form.attachments.length > 0 ? (
            <>
              <div className="issue-page__divider" aria-hidden="true" />
              <section className="issue-dialog__panel">
                <h4>{messages.issues.attachments}</h4>
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
        aria-label={messages.issues.statusLabel}
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

function IssueReadOnlyLabels({
  labels,
  messages,
}: {
  labels: IssueLabelRecord[];
  messages: ReturnType<typeof useI18n>["messages"];
}) {
  return (
    <section className="issue-dialog__panel">
      <h4>{messages.issues.labels}</h4>
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
        <p>{messages.issues.noLabels}</p>
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
  messages,
  onOpenLinkedSession,
  onOpenSummary,
}: {
  selectedIssue: IssueRecord | null;
  hasLinkedSession: boolean;
  canViewSummary: boolean;
  isSaving: boolean;
  canOpenAgentsActivity: boolean;
  messages: ReturnType<typeof useI18n>["messages"];
  onOpenLinkedSession: () => void;
  onOpenSummary: () => void;
}) {
  return (
    <section className="issue-dialog__panel issue-dialog__panel--stack">
      <div className="issue-dialog__meta-row">
        <span className="issue-dialog__meta-label">
          {messages.issues.session}
        </span>
        {hasLinkedSession && selectedIssue?.linkedSessionId != null ? (
          <button
            aria-label={messages.issues.openLinkedSession(
              selectedIssue.linkedSessionId,
            )}
            className="issue-dialog__session-link"
            type="button"
            disabled={isSaving || !canOpenAgentsActivity}
            onClick={onOpenLinkedSession}
          >
            {`#${selectedIssue.linkedSessionId}`}
          </button>
        ) : (
          <span className="issue-dialog__meta-value">
            {messages.issues.noSessionLinked}
          </span>
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
          {messages.issues.viewSummary}
        </Button>
      ) : null}
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
  const { messages } = useI18n();
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
