import type { FormEvent } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
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
      <div className="grid gap-1.5">
        <Label htmlFor="project-name" className="text-xs text-muted-foreground">
          {projectNameLabel}
        </Label>
        <Input
          id="project-name"
          aria-label={projectNameLabel}
          disabled={isSubmitting}
          value={projectName}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label
          htmlFor="project-repo-path"
          className="text-xs text-muted-foreground"
        >
          {repoPathLabel}
        </Label>
        <div className="settings-field__control-row">
          <Input
            id="project-repo-path"
            aria-label={repoPathLabel}
            disabled={isSubmitting || isChoosingRepoPath}
            readOnly
            value={repoPath}
          />
          <Button
            className="settings-field__repo-button"
            disabled={isSubmitting || isChoosingRepoPath}
            type="button"
            variant="outline"
            onClick={onChooseRepoPath}
          >
            {isChoosingRepoPath ? choosingFolderLabel : chooseFolderLabel}
          </Button>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label
          htmlFor="project-completion-strategy"
          className="text-xs text-muted-foreground"
        >
          {completionStrategyLabel}
        </Label>
        <Select
          items={[
            { value: "agent_auto_commit", label: autoCommitLabel },
            { value: "manual", label: manualLabel },
          ]}
          value={completionPolicy}
          onValueChange={(value) =>
            onCompletionPolicyChange(value as ProjectCompletionPolicy)
          }
        >
          <SelectTrigger
            id="project-completion-strategy"
            aria-label={completionStrategyLabel}
            className="w-full"
            disabled={isSubmitting}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="agent_auto_commit">{autoCommitLabel}</SelectItem>
            <SelectItem value="manual">{manualLabel}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {errorMessage ? (
        <p
          className="settings-status"
          role="status"
          aria-label={ariaStatusLabel}
        >
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
