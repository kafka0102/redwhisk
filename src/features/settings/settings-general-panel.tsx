import { useState, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { toCommandError } from "../../shared/commands/command-error";
import {
  type ProjectWorktreeLocation,
  type UpdateProjectSettingsInput,
  updateProjectSettings,
  validateProjectRepoPath,
} from "../project/project-commands";
import { ProjectDetailsForm } from "../project/project-details-form";
import {
  detectWorktreeSetupCommand,
  initialWorktreeSetupCommand,
} from "../project/worktree-setup-command";
import type { ProjectSummary } from "../../app/app";
import { useI18n } from "../../shared/i18n/i18n";
import type { I18nMessages } from "../../shared/i18n/messages";

interface GeneralSettingsPanelProps {
  projectId: number;
  projectName: string;
  projectPath: string;
  worktreeLocation: ProjectWorktreeLocation;
  worktreeSetupCommand: string;
  onProjectUpdated?: (project: ProjectSummary) => void;
}

interface GeneralSettingsFormProps {
  messages: I18nMessages;
  onSave: (input: GeneralSettingsSaveInput) => Promise<void>;
  projectName: string;
  projectPath: string;
  worktreeLocation: ProjectWorktreeLocation;
  worktreeSetupCommand: string;
}

type GeneralSettingsSaveInput = Pick<
  UpdateProjectSettingsInput,
  "name" | "repoPath" | "worktreeLocation" | "worktreeSetupCommand"
>;

export function GeneralSettingsPanel({
  projectId,
  projectName,
  projectPath,
  worktreeLocation,
  worktreeSetupCommand,
  onProjectUpdated,
}: GeneralSettingsPanelProps) {
  const { messages } = useI18n();

  async function handleGeneralSettingsSave(input: GeneralSettingsSaveInput) {
    const updatedProject = await updateProjectSettings({
      projectId,
      name: input.name,
      repoPath: input.repoPath,
      worktreeLocation: input.worktreeLocation,
      worktreeSetupCommand: input.worktreeSetupCommand,
    });
    onProjectUpdated?.({
      id: updatedProject.id,
      name: updatedProject.name,
      path: updatedProject.repoPath,
      worktreeLocation: updatedProject.worktreeLocation ?? "repo_sibling",
      worktreeSetupCommand: updatedProject.worktreeSetupCommand ?? "",
      recentOpenedAt: `Opened ${new Date(updatedProject.lastOpenedAt).toLocaleString()}`,
      status: "available",
    });
  }

  return (
    <GeneralSettingsForm
      key={`${projectId}:${projectName}:${projectPath}:${worktreeLocation}:${worktreeSetupCommand}`}
      messages={messages}
      onSave={handleGeneralSettingsSave}
      projectName={projectName}
      projectPath={projectPath}
      worktreeLocation={worktreeLocation}
      worktreeSetupCommand={worktreeSetupCommand}
    />
  );
}

function GeneralSettingsForm({
  messages,
  onSave,
  projectName,
  projectPath,
  worktreeLocation,
  worktreeSetupCommand,
}: GeneralSettingsFormProps) {
  const [projectNameValue, setProjectNameValue] = useState(projectName);
  const [projectPathValue, setProjectPathValue] = useState(projectPath);
  const [worktreeLocationValue, setWorktreeLocationValue] =
    useState<ProjectWorktreeLocation>(worktreeLocation);
  const [worktreeSetupCommandValue, setWorktreeSetupCommandValue] = useState(
    () => initialWorktreeSetupCommand(worktreeSetupCommand, projectPath),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChoosingRepoPath, setIsChoosingRepoPath] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const trimmedProjectName = projectNameValue.trim();
  const trimmedProjectPath = projectPathValue.trim();
  const isDirty =
    trimmedProjectName !== projectName ||
    trimmedProjectPath !== projectPath ||
    worktreeLocationValue !== worktreeLocation ||
    worktreeSetupCommandValue !== worktreeSetupCommand;
  const isSaveDisabled =
    isSaving ||
    isChoosingRepoPath ||
    trimmedProjectName.length === 0 ||
    trimmedProjectPath.length === 0 ||
    !isDirty;

  async function handleChooseRepoPath() {
    setErrorMessage(null);
    setIsChoosingRepoPath(true);

    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: messages.projectHome.selectGitRepository,
      });

      if (typeof selectedPath !== "string") {
        return;
      }

      const validatedPath = await validateProjectRepoPath({
        repoPath: selectedPath,
      });
      const currentDetectedCommand =
        detectWorktreeSetupCommand(projectPathValue);
      const nextDetectedCommand = detectWorktreeSetupCommand(
        validatedPath.repoPath,
      );
      setProjectPathValue(validatedPath.repoPath);
      if (
        worktreeSetupCommandValue.trim().length === 0 ||
        worktreeSetupCommandValue === currentDetectedCommand
      ) {
        setWorktreeSetupCommandValue(nextDetectedCommand ?? "");
      }
    } catch (error: unknown) {
      setErrorMessage(toCommandError(error).message);
    } finally {
      setIsChoosingRepoPath(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaveDisabled) {
      return;
    }

    setErrorMessage(null);
    setIsSaving(true);

    try {
      await onSave({
        name: trimmedProjectName,
        repoPath: trimmedProjectPath,
        worktreeLocation: worktreeLocationValue,
        worktreeSetupCommand: worktreeSetupCommandValue.trim(),
      });
    } catch (error: unknown) {
      setErrorMessage(toCommandError(error).message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ProjectDetailsForm
      ariaStatusLabel={`${messages.settings.general} ${messages.settings.status}`}
      chooseFolderLabel={messages.projectHome.chooseFolder}
      className="settings-card settings-general-card"
      errorMessage={errorMessage}
      isChoosingRepoPath={isChoosingRepoPath}
      isSubmitting={isSaving}
      onChooseRepoPath={handleChooseRepoPath}
      onNameChange={setProjectNameValue}
      onSubmit={handleSubmit}
      onWorktreeLocationChange={setWorktreeLocationValue}
      onWorktreeSetupCommandChange={setWorktreeSetupCommandValue}
      projectName={projectNameValue}
      projectNameLabel={messages.settings.projectName}
      repoPath={projectPathValue}
      repoPathLabel={messages.settings.repositoryPath}
      submitDisabled={isSaveDisabled}
      submitLabel={messages.settings.save}
      submittingLabel={messages.settings.saving}
      worktreeLocation={worktreeLocationValue}
      worktreeLocationLabel={messages.settings.worktreePath}
      worktreeSetupCommand={worktreeSetupCommandValue}
      worktreeSetupCommandLabel={messages.settings.worktreeSetupAfterCreation}
      worktreeSetupCommandPlaceholder={
        messages.createProject.worktreeSetupPlaceholder
      }
    />
  );
}
