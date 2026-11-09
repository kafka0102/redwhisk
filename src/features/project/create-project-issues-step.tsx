import type { FormEvent, ReactElement } from "react";

import { Button } from "../../components/ui/button";
import { useI18n } from "../../shared/i18n/i18n";
import type { ProjectIssueConnection } from "../settings/issue-source-commands";
import { IssueSourceCompletionCard } from "../settings/settings-issues-completion-card";
import { IssueSourceConnectionCard } from "../settings/settings-issues-connection-card";
import { IssueSourceModeCard } from "../settings/settings-issues-mode-card";
import {
  unknownConnection,
  type CreateProjectIssueForm,
} from "./create-project-issue-form";
import type {
  ForgeHostName,
  ProjectCompletionAction,
} from "./project-forge-commands";

interface CreateProjectIssuesStepProps {
  completionAction: ProjectCompletionAction;
  confirmCompletionAction: boolean;
  connection: ProjectIssueConnection | null;
  createDisabled: boolean;
  errorMessage: string | null;
  form: CreateProjectIssueForm;
  host: ForgeHostName | "";
  isInspecting: boolean;
  locked: boolean;
  repoDefaultBranch: string | null;
  showCards: boolean;
  statusLabel: string;
  onBack: () => void;
  onCancel: () => void;
  onCompletionActionChange: (value: ProjectCompletionAction) => void;
  onConfirmCompletionActionChange: (value: boolean) => void;
  onFormChange: (patch: Partial<CreateProjectIssueForm>) => void;
  onRelogin: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function CreateProjectIssuesStep({
  completionAction,
  confirmCompletionAction,
  connection,
  createDisabled,
  errorMessage,
  form,
  host,
  isInspecting,
  locked,
  repoDefaultBranch,
  showCards,
  statusLabel,
  onBack,
  onCancel,
  onCompletionActionChange,
  onConfirmCompletionActionChange,
  onFormChange,
  onRelogin,
  onSubmit,
}: CreateProjectIssuesStepProps): ReactElement {
  const { messages, t } = useI18n();
  const showRemote = showCards && form.mode !== "local";
  const showCompletion = showCards && (host === "github" || host === "gitlab");
  const provider =
    host === "github" || host === "gitlab"
      ? host
      : (connection?.provider ?? null);
  const shownConnection = connection ?? unknownConnection(provider);

  return (
    <form className="grid gap-3" onSubmit={onSubmit}>
      {showCards ? (
        <IssueSourceModeCard
          disabled={locked}
          mode={form.mode}
          onModeChange={(mode) => onFormChange({ mode })}
        />
      ) : null}
      {showRemote ? (
        <IssueSourceConnectionCard
          closeOnComplete={form.closeOnComplete}
          closeOnMerge={form.closeOnMerge}
          connection={shownConnection}
          disabled={locked}
          intervalSeconds={form.intervalSeconds}
          isInspecting={isInspecting}
          isLoading={false}
          label={form.label}
          scope={form.scope}
          syncEnabled={form.syncEnabled}
          writebackComment={form.writebackComment}
          onCloseOnCompleteChange={(closeOnComplete) =>
            onFormChange({ closeOnComplete })
          }
          onCloseOnMergeChange={(closeOnMerge) =>
            onFormChange({ closeOnMerge })
          }
          onIntervalChange={(intervalSeconds) =>
            onFormChange({ intervalSeconds })
          }
          onLabelChange={(label) => onFormChange({ label })}
          onRelogin={onRelogin}
          onScopeChange={(scope) => onFormChange({ scope })}
          onSyncEnabledChange={(syncEnabled) => onFormChange({ syncEnabled })}
          onWritebackCommentChange={(writebackComment) =>
            onFormChange({ writebackComment })
          }
        />
      ) : null}
      {showCompletion ? (
        <IssueSourceCompletionCard
          action={completionAction}
          confirmCompletionAction={confirmCompletionAction}
          disabled={locked}
          draft={form.prDraft}
          host={host}
          repoDefaultBranch={repoDefaultBranch}
          target={form.prTarget}
          onActionChange={onCompletionActionChange}
          onConfirmCompletionActionChange={onConfirmCompletionActionChange}
          onDraftChange={(prDraft) => onFormChange({ prDraft })}
          onTargetChange={(prTarget) => onFormChange({ prTarget })}
        />
      ) : null}
      {errorMessage ? (
        <p aria-label={statusLabel} className="settings-status" role="status">
          {errorMessage}
        </p>
      ) : null}
      <div className="settings-form__actions-row settings-form__actions-row--footer">
        <Button type="button" variant="outline" onClick={onBack}>
          {t("createProject.back")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {messages.settings.cancel}
        </Button>
        <Button disabled={createDisabled} type="submit">
          {messages.createProject.create}
        </Button>
      </div>
    </form>
  );
}
