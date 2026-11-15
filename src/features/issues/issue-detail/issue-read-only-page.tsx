import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  IssueRecord,
  IssueStatus,
} from "../issue-commands";
import type { IssueFormState } from "../issue-activity-types";
import type { IssueAttachmentDraft } from "../issue-form/issue-description-editor";
import { IssueStatusMenu } from "./issue-status-menu";
import { IssueSurfaceHeader } from "../issue-surface-header";
import { IssueTimeline } from "./issue-timeline";
import { IssueDescriptionMarkdown } from "./issue-detail-description";
import { useI18n } from "../../../shared/i18n/i18n";
import {
  applyIssueRecovery,
  getIssueDetail,
  refreshIssueRemoteAvailability,
  retryIssueCompletionWriteback,
  type IssueDetailRecord,
  type RecoveryAction,
} from "./issue-detail-commands";
import { IssueUnavailableBanner } from "./issue-unavailable-banner";
import { IssueDetailHeading } from "./issue-detail-heading";
import { issueDetailTitleParts } from "./issue-detail-mode";
import { readOnlyDetailLabels } from "./issue-readonly-labels";
import { useIssueLabelCatalog } from "../use-issue-label-catalog";
import {
  IssueDetailSideCards,
  IssueReadOnlyLabelRow,
} from "./issue-detail-side-cards";

interface IssueReadOnlyPageProps {
  form: IssueFormState;
  selectedIssue: IssueRecord | null;
  isSaving: boolean;
  errorMessage: string | null;
  hasLinkedSession: boolean;
  canOpenAgentsActivity: boolean;
  onBack: () => void;
  onPreviewAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onDownloadAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onAdvanceStatus: (targetStatus: IssueStatus) => void;
  onReopenIssue?: () => void;
  onDeleteIssue: () => void;
  onEditIssue: () => void;
  onOpenLinkedSession: () => void;
  onRunIssue?: (trigger: HTMLElement | null) => void;
  onOpenChangeRequest?: (request: { provider: string; number: number }) => void;
}

export function IssueReadOnlyPage({
  form,
  selectedIssue,
  isSaving,
  errorMessage,
  hasLinkedSession,
  canOpenAgentsActivity,
  onBack,
  onPreviewAttachment,
  onDownloadAttachment,
  onAdvanceStatus,
  onReopenIssue,
  onDeleteIssue,
  onEditIssue,
  onOpenLinkedSession,
  onRunIssue,
  onOpenChangeRequest,
}: IssueReadOnlyPageProps) {
  const { messages, t } = useI18n();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [detail, setDetail] = useState<IssueDetailRecord | null>(null);
  const [detailIssueId, setDetailIssueId] = useState<number | null>(null);
  const detailEpochRef = useRef(0);
  const titleParts = selectedIssue
    ? issueDetailTitleParts(selectedIssue)
    : null;
  const rawDescription = selectedIssue?.description ?? form.description;
  const linkedSessionId = selectedIssue?.linkedSessionId ?? null;
  const projectId = selectedIssue?.projectId ?? 0;
  const labelCatalogProjectIdRef = useRef(projectId);
  useEffect(() => {
    labelCatalogProjectIdRef.current = projectId;
  }, [projectId]);
  const { availableLabels } = useIssueLabelCatalog(
    projectId,
    labelCatalogProjectIdRef,
    t,
  );
  const activeDetail =
    selectedIssue != null && detailIssueId === selectedIssue.id ? detail : null;
  const readonlyLabels = readOnlyDetailLabels({
    issueLabels: selectedIssue?.labels ?? [],
    hostLabels: activeDetail?.projection?.labels ?? [],
    catalog: availableLabels,
  });
  const unavailableBanner = activeDetail?.unavailableBanner ?? null;

  function runRecovery(action: RecoveryAction): void {
    if (selectedIssue == null) {
      return;
    }
    const issueId = selectedIssue.id;
    const requestProjectId = selectedIssue.projectId;
    void applyIssueRecovery({
      action,
      issueId,
      projectId: requestProjectId,
    }).then((next) => {
      commitDetail(issueId, next);
    });
  }

  function commitDetail(issueId: number, next: IssueDetailRecord | null): void {
    detailEpochRef.current += 1;
    setDetail(next);
    setDetailIssueId(issueId);
  }

  useEffect(() => {
    if (selectedIssue == null) {
      return;
    }
    const issueId = selectedIssue.id;
    const requestProjectId = selectedIssue.projectId;
    let cancelled = false;
    void getIssueDetail({ projectId: requestProjectId, issueId })
      .then((next) => {
        if (cancelled) {
          return;
        }
        detailEpochRef.current += 1;
        const epoch = detailEpochRef.current;
        setDetail(next);
        setDetailIssueId(issueId);
        if (next.projection == null) {
          return;
        }
        void refreshIssueRemoteAvailability({
          issueId,
          projectId: requestProjectId,
        })
          .then((refreshed) => {
            if (cancelled || detailEpochRef.current !== epoch) {
              return;
            }
            detailEpochRef.current += 1;
            setDetail(refreshed);
            setDetailIssueId(issueId);
          })
          .catch(() => {
            // 探测失败时保留已经画出的本地宿主卡片。
          });
      })
      .catch(() => {
        if (!cancelled) {
          detailEpochRef.current += 1;
          setDetail(null);
          setDetailIssueId(issueId);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedIssue]);

  return (
    <section
      aria-label={messages.issues.detailRegionLabel}
      className="issue-page issue-page--readonly issue-page--fullscreen"
    >
      <IssueSurfaceHeader
        title={
          <IssueDetailHeading
            backLabel={messages.issues.backReadonly}
            disabled={isSaving}
            numberLabel={titleParts?.numberLabel}
            title={titleParts?.title ?? messages.issues.detailFallbackTitle}
            onBack={onBack}
          />
        }
        titleAsChild
        variant="fullscreen"
        actions={
          <>
            <IssueStatusMenu
              isSaving={isSaving}
              selectedIssue={selectedIssue}
              onAdvanceStatus={onAdvanceStatus}
            />
            {selectedIssue?.status === "backlog" && onRunIssue ? (
              <Button
                className="issues-button issues-button--primary"
                disabled={isSaving}
                type="button"
                onClick={(event) => onRunIssue(event.currentTarget)}
              >
                {messages.issues.run}
              </Button>
            ) : null}
            <IssueMoreMenu
              isSaving={isSaving}
              onDeleteIssue={() => setIsDeleteDialogOpen(true)}
              onEditIssue={onEditIssue}
            />
          </>
        }
      />

      <div className="issue-page__body issue-page__body--readonly-fullscreen">
        {unavailableBanner != null &&
        !unavailableBanner.showsDeleteConfirmation ? (
          <IssueUnavailableBanner
            actions={unavailableBanner.actions}
            onAction={runRecovery}
          />
        ) : null}
        <div className="issue-page__content-shell issue-page__content-shell--readonly">
          <IssueReadOnlyDetails
            attachments={form.attachments}
            description={rawDescription}
            issueId={selectedIssue?.id ?? null}
            labels={readonlyLabels}
            projectId={selectedIssue?.projectId ?? null}
            onDownloadAttachment={onDownloadAttachment}
            onPreviewAttachment={onPreviewAttachment}
          />
        </div>
        <IssueDetailSideCards
          canOpenSession={hasLinkedSession && canOpenAgentsActivity}
          issueStatus={selectedIssue?.status ?? null}
          linkedChangeRequests={activeDetail?.linkedChangeRequests ?? []}
          linkedSessionId={linkedSessionId}
          projectId={projectId}
          projection={activeDetail?.projection ?? null}
          writebackError={activeDetail?.writebackError ?? null}
          writebackPending={activeDetail?.writebackPending ?? false}
          onOpenSession={onOpenLinkedSession}
          onOpenChangeRequest={onOpenChangeRequest}
          onReopenIssue={onReopenIssue}
          onRetryWriteback={() => {
            if (selectedIssue == null) {
              return;
            }
            const issueId = selectedIssue.id;
            const requestProjectId = selectedIssue.projectId;
            void retryIssueCompletionWriteback({
              issueId,
              projectId: requestProjectId,
            }).then(() =>
              getIssueDetail({ issueId, projectId: requestProjectId }).then(
                (next) => {
                  commitDetail(issueId, next);
                },
              ),
            );
          }}
        />
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
  issueId,
  labels,
  projectId,
  onDownloadAttachment,
  onPreviewAttachment,
}: {
  attachments: Array<IssueAttachmentRecord | IssueAttachmentDraft>;
  description: string;
  issueId: number | null;
  labels: ReturnType<typeof readOnlyDetailLabels>;
  projectId: number | null;
  onPreviewAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onDownloadAttachment: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
}) {
  return (
    <article className="issue-dialog__editor issue-dialog__editor--readonly issue-page__main issue-page__main--fullscreen issue-page__main--readonly">
      <IssueReadOnlyLabelRow labels={labels} />
      <div className="issue-detail__description">
        <IssueDescriptionMarkdown
          description={description}
          attachments={attachments}
          onDownloadAttachment={onDownloadAttachment}
          onPreviewAttachment={onPreviewAttachment}
        />
      </div>
      {projectId !== null && issueId !== null ? (
        <IssueTimeline projectId={projectId} issueId={issueId} />
      ) : null}
    </article>
  );
}

function IssueMoreMenu({
  isSaving,
  onDeleteIssue,
  onEditIssue,
}: {
  isSaving: boolean;
  onDeleteIssue: () => void;
  onEditIssue: () => void;
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
