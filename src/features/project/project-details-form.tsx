import type { FormEvent } from "react";

import { Button } from "../../components/ui/button";
import type { ProjectCompletionPolicy } from "./project-commands";

interface ProjectDetailsFormProps {
  ariaStatusLabel: string;
  autoCommitLabel?: string;
  cancelLabel?: string;
  chooseFolderLabel: string;
  choosingFolderLabel?: string;
  className?: string;
  completionPolicy: ProjectCompletionPolicy;
  completionStrategyLabel: string;
  errorMessage: string | null;
  isChoosingRepoPath: boolean;
  isSubmitting: boolean;
  onCancel?: () => void;
  onChooseRepoPath: () => void;
  onCompletionPolicyChange: (value: ProjectCompletionPolicy) => void;
  onNameChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  projectName: string;
  projectNameLabel: string;
  repoPath: string;
  repoPathLabel: string;
  manualLabel?: string;
  submitDisabled: boolean;
  submitLabel: string;
  submittingLabel: string;
}

export function ProjectDetailsForm({
  ariaStatusLabel,
  autoCommitLabel = "Auto Commit",
  cancelLabel,
  chooseFolderLabel,
  choosingFolderLabel = chooseFolderLabel,
  className = "settings-card settings-general-card",
  completionPolicy,
  completionStrategyLabel,
  errorMessage,
  isChoosingRepoPath,
  isSubmitting,
  onCancel,
  onChooseRepoPath,
  onCompletionPolicyChange,
  onNameChange,
  onSubmit,
  projectName,
  projectNameLabel,
  repoPath,
  repoPathLabel,
  manualLabel = "Manual",
  submitDisabled,
  submitLabel,
  submittingLabel,
}: ProjectDetailsFormProps) {
  return (
    <form className={className} onSubmit={onSubmit}>
      <label className="settings-field">
        <span>{projectNameLabel}</span>
        <input
          aria-label={projectNameLabel}
          className="settings-input settings-input--form-control"
          disabled={isSubmitting}
          value={projectName}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </label>
      <label className="settings-field">
        <span>{repoPathLabel}</span>
        <div className="settings-field__control-row">
          <input
            aria-label={repoPathLabel}
            className="settings-input settings-input--form-control"
            disabled={isSubmitting || isChoosingRepoPath}
            readOnly
            value={repoPath}
          />
          <Button
            className="settings-field__repo-button"
            disabled={isSubmitting || isChoosingRepoPath}
            type="button"
            onClick={onChooseRepoPath}
          >
            {isChoosingRepoPath ? choosingFolderLabel : chooseFolderLabel}
          </Button>
        </div>
      </label>
      <label className="settings-field">
        <span>{completionStrategyLabel}</span>
        <select
          aria-label={completionStrategyLabel}
          className="settings-input settings-input--form-control"
          disabled={isSubmitting}
          value={completionPolicy}
          onChange={(event) =>
            onCompletionPolicyChange(
              event.target.value as ProjectCompletionPolicy,
            )
          }
        >
          <option value="agent_auto_commit">{autoCommitLabel}</option>
          <option value="manual">{manualLabel}</option>
        </select>
      </label>
      {errorMessage ? (
        <p className="settings-status" role="status" aria-label={ariaStatusLabel}>
          {errorMessage}
        </p>
      ) : null}
      <div className="settings-form__actions-row settings-form__actions-row--footer">
        {onCancel ? (
          <Button
            className="settings-save-button"
            disabled={isSubmitting}
            type="button"
            variant="outline"
            onClick={onCancel}
          >
            {cancelLabel ?? "Cancel"}
          </Button>
        ) : null}
        <Button
          className="settings-save-button"
          disabled={submitDisabled}
          type="submit"
        >
          {isSubmitting ? submittingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
