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
import type { ProjectWorktreeLocation } from "./project-commands";
import { formatHomePathForDisplay } from "../../shared/paths/home-path";

interface ProjectDetailsFormProps {
  ariaStatusLabel: string;
  cancelLabel?: string;
  chooseFolderLabel: string;
  choosingFolderLabel?: string;
  className?: string;
  errorMessage: string | null;
  isChoosingRepoPath: boolean;
  isSubmitting: boolean;
  onCancel?: () => void;
  onChooseRepoPath: () => void;
  onNameChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onWorktreeLocationChange?: (value: ProjectWorktreeLocation) => void;
  onWorktreeSetupCommandChange?: (value: string) => void;
  projectName: string;
  projectNameLabel: string;
  repoPath: string;
  repoPathLabel: string;
  submitDisabled: boolean;
  submitLabel: string;
  submittingLabel: string;
  worktreeLocation?: ProjectWorktreeLocation;
  worktreeLocationLabel?: string;
  worktreeSetupCommand?: string;
  worktreeSetupCommandLabel?: string;
  worktreeSetupCommandPlaceholder?: string;
}

export function ProjectDetailsForm({
  ariaStatusLabel,
  cancelLabel,
  chooseFolderLabel,
  choosingFolderLabel = chooseFolderLabel,
  className = "settings-card settings-general-card",
  errorMessage,
  isChoosingRepoPath,
  isSubmitting,
  onCancel,
  onChooseRepoPath,
  onNameChange,
  onSubmit,
  onWorktreeLocationChange,
  onWorktreeSetupCommandChange,
  projectName,
  projectNameLabel,
  repoPath,
  repoPathLabel,
  submitDisabled,
  submitLabel,
  submittingLabel,
  worktreeLocation = "repo_sibling",
  worktreeLocationLabel,
  worktreeSetupCommand = "",
  worktreeSetupCommandLabel,
  worktreeSetupCommandPlaceholder = "",
}: ProjectDetailsFormProps) {
  const worktreeOptions = buildWorktreeLocationOptions(repoPath);

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
      {worktreeLocationLabel ? (
        <div className="grid gap-1.5">
          <Label
            htmlFor="project-worktree-location"
            className="text-xs text-muted-foreground"
          >
            {worktreeLocationLabel}
          </Label>
          <Select
            items={worktreeOptions.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={worktreeLocation}
            onValueChange={(value) =>
              onWorktreeLocationChange?.(value as ProjectWorktreeLocation)
            }
          >
            <SelectTrigger
              id="project-worktree-location"
              aria-label={worktreeLocationLabel}
              className="w-full"
              disabled={isSubmitting}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {worktreeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {worktreeSetupCommandLabel ? (
        <div className="grid gap-1.5">
          <Label
            htmlFor="project-worktree-setup-command"
            className="text-xs text-muted-foreground"
          >
            {worktreeSetupCommandLabel}
          </Label>
          <textarea
            id="project-worktree-setup-command"
            aria-label={worktreeSetupCommandLabel}
            autoCapitalize="none"
            className="min-h-[78px] w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSubmitting}
            placeholder={worktreeSetupCommandPlaceholder}
            rows={3}
            spellCheck={false}
            value={worktreeSetupCommand}
            onChange={(event) =>
              onWorktreeSetupCommandChange?.(event.target.value)
            }
          />
        </div>
      ) : null}
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

interface WorktreeLocationOption {
  value: ProjectWorktreeLocation;
  label: string;
}

function buildWorktreeLocationOptions(
  repoPath: string,
): WorktreeLocationOption[] {
  const trimmedRepoPath = repoPath.trim();
  const repoName = repoNameFromPath(trimmedRepoPath);
  const siblingPath =
    trimmedRepoPath.length === 0 ? "" : `${trimmedRepoPath}.worktrees`;
  const internalPath =
    trimmedRepoPath.length === 0 ? "" : `${trimmedRepoPath}/.worktrees`;
  const homePath = repoName ? `~/.redwhisk/worktrees/${repoName}` : "";

  return [
    { value: "repo_sibling", label: formatHomePathForDisplay(siblingPath) },
    { value: "repo_internal", label: formatHomePathForDisplay(internalPath) },
    { value: "user_home", label: homePath },
  ];
}

function repoNameFromPath(repoPath: string): string {
  const parts = repoPath.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}
