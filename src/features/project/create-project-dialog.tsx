import { useState, type FormEvent, type ReactElement } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { ProjectCompletionFields } from "./project-completion-fields";
import { ProjectDetailsForm } from "./project-details-form";
import {
  validateProjectRepoPath,
  type CreateProjectInput,
  type ProjectWorktreeLocation,
  type ValidateProjectRepoPathResponse,
} from "./project-commands";
import type {
  ForgeHostName,
  ProjectCompletionAction,
} from "./project-forge-commands";
import { detectWorktreeSetupCommand } from "./worktree-setup-command";

export interface CreateProjectDialogDraft {
  name: string;
  repoPath: string;
  suggestedName: string;
  worktreeLocation: ProjectWorktreeLocation;
  worktreeSetupCommand: string;
  host: ForgeHostName;
  completionAction: ProjectCompletionAction;
  confirmCompletionAction: boolean;
}

interface CreateProjectDialogProps {
  initialDraft: CreateProjectDialogDraft;
  onClose: () => void;
  onCreate: (input: CreateProjectInput) => Promise<void>;
}

function knownForgeHost(host: string): host is "github" | "gitlab" {
  return host === "github" || host === "gitlab";
}

export function CreateProjectDialog({
  initialDraft,
  onClose,
  onCreate,
}: CreateProjectDialogProps): ReactElement {
  const { messages, t } = useI18n();
  const initialHost = knownForgeHost(initialDraft.host)
    ? initialDraft.host
    : "none";
  const [projectNameValue, setProjectNameValue] = useState(initialDraft.name);
  const [projectPathValue, setProjectPathValue] = useState(
    initialDraft.repoPath,
  );
  const [worktreeLocationValue, setWorktreeLocationValue] =
    useState<ProjectWorktreeLocation>(initialDraft.worktreeLocation);
  const [worktreeSetupCommandValue, setWorktreeSetupCommandValue] = useState(
    initialDraft.worktreeSetupCommand,
  );
  const [suggestedName, setSuggestedName] = useState(
    initialDraft.suggestedName,
  );
  const [host, setHost] = useState<ForgeHostName>(initialHost);
  const [completionAction, setCompletionAction] =
    useState<ProjectCompletionAction>(
      initialHost === "none" ? "merge_to_base" : initialDraft.completionAction,
    );
  const [confirmCompletionAction, setConfirmCompletionAction] = useState(
    initialHost === "none" ? false : initialDraft.confirmCompletionAction,
  );
  const [completionTouched, setCompletionTouched] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChoosingRepoPath, setIsChoosingRepoPath] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const trimmedProjectName = projectNameValue.trim();
  const trimmedProjectPath = projectPathValue.trim();
  const showCompletionFields =
    trimmedProjectPath.length > 0 && knownForgeHost(host);
  const isSubmitDisabled =
    isSubmitting ||
    isChoosingRepoPath ||
    trimmedProjectName.length === 0 ||
    trimmedProjectPath.length === 0;

  function applyValidatedCompletion(
    validated: ValidateProjectRepoPathResponse,
  ): void {
    const nextHost = knownForgeHost(validated.host) ? validated.host : "none";
    setHost(nextHost);
    if (nextHost === "none") {
      setCompletionAction("merge_to_base");
      setConfirmCompletionAction(false);
      return;
    }
    if (!completionTouched) {
      setCompletionAction(validated.completionAction);
      setConfirmCompletionAction(validated.confirmCompletionAction);
    }
  }

  function clearRepoPath(): void {
    setProjectPathValue("");
    setHost("none");
    setCompletionAction("merge_to_base");
    setConfirmCompletionAction(false);
  }

  async function handleChooseRepoPath(): Promise<void> {
    setErrorMessage(null);
    setIsChoosingRepoPath(true);

    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: messages.createProject.selectGitRepository,
      });

      if (typeof selectedPath !== "string") {
        return;
      }
      if (selectedPath.trim().length === 0) {
        clearRepoPath();
        return;
      }

      const validatedProject = await validateProjectRepoPath({
        repoPath: selectedPath,
      });
      const shouldReplaceName =
        trimmedProjectName.length === 0 || trimmedProjectName === suggestedName;
      const currentDetectedCommand =
        detectWorktreeSetupCommand(projectPathValue);
      const nextDetectedCommand = detectWorktreeSetupCommand(
        validatedProject.repoPath,
      );

      setProjectPathValue(validatedProject.repoPath);
      setSuggestedName(validatedProject.suggestedName);
      if (shouldReplaceName) {
        setProjectNameValue(validatedProject.suggestedName);
      }
      if (
        worktreeSetupCommandValue.trim().length === 0 ||
        worktreeSetupCommandValue === currentDetectedCommand
      ) {
        setWorktreeSetupCommandValue(nextDetectedCommand ?? "");
      }
      applyValidatedCompletion(validatedProject);
    } catch (error: unknown) {
      setErrorMessage(getCommandErrorMessage(error, t));
    } finally {
      setIsChoosingRepoPath(false);
    }
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (isSubmitDisabled) {
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      await onCreate({
        name: trimmedProjectName,
        repoPath: trimmedProjectPath,
        worktreeLocation: worktreeLocationValue,
        worktreeSetupCommand: worktreeSetupCommandValue.trim(),
        completionAction: showCompletionFields
          ? completionAction
          : "merge_to_base",
        confirmCompletionAction: showCompletionFields
          ? confirmCompletionAction
          : false,
        prTarget: "issue_base",
        prDraft: false,
      });
    } catch (error: unknown) {
      setErrorMessage(getCommandErrorMessage(error, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="issue-dialog-overlay" role="presentation">
      <div
        className="issue-dialog issue-dialog--compact"
        role="dialog"
        aria-label={messages.createProject.dialogTitle}
      >
        <div className="issue-dialog__header">
          <h3>{messages.createProject.dialogTitle}</h3>
        </div>
        <div className="issue-dialog__body issue-dialog__body--single">
          <ProjectDetailsForm
            ariaStatusLabel={messages.createProject.status}
            cancelLabel={messages.settings.cancel}
            chooseFolderLabel={messages.projectHome.chooseFolder}
            className="settings-card settings-general-card project-details-card"
            errorMessage={errorMessage}
            isChoosingRepoPath={isChoosingRepoPath}
            isSubmitting={isSubmitting}
            onCancel={onClose}
            onChooseRepoPath={() => {
              void handleChooseRepoPath();
            }}
            onNameChange={setProjectNameValue}
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
            onWorktreeLocationChange={setWorktreeLocationValue}
            onWorktreeSetupCommandChange={setWorktreeSetupCommandValue}
            projectName={projectNameValue}
            projectNameLabel={messages.settings.projectName}
            repoPath={projectPathValue}
            repoPathLabel={messages.settings.repositoryPath}
            submitDisabled={isSubmitDisabled}
            submitLabel={messages.createProject.create}
            submittingLabel={messages.createProject.creating}
            worktreeLocation={worktreeLocationValue}
            worktreeLocationLabel={messages.settings.worktreePath}
            worktreeSetupCommand={worktreeSetupCommandValue}
            worktreeSetupCommandLabel={
              messages.settings.worktreeSetupAfterCreation
            }
            worktreeSetupCommandPlaceholder={
              messages.createProject.worktreeSetupPlaceholder
            }
            afterWorktreeLocation={
              showCompletionFields ? (
                <ProjectCompletionFields
                  host={host}
                  cliInstalled
                  cliAuthenticated
                  repoDefaultBranch={null}
                  action={completionAction}
                  target="issue_base"
                  draft={false}
                  confirmCompletionAction={confirmCompletionAction}
                  disabled={isSubmitting}
                  showRequestDetails={false}
                  showCliStatus={false}
                  onActionChange={(value) => {
                    setCompletionTouched(true);
                    setCompletionAction(value);
                  }}
                  onConfirmCompletionActionChange={(value) => {
                    setCompletionTouched(true);
                    setConfirmCompletionAction(value);
                  }}
                  onTargetChange={() => undefined}
                  onDraftChange={() => undefined}
                />
              ) : null
            }
          />
        </div>
      </div>
    </div>
  );
}
