import { useState, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { toCommandError } from "../../shared/commands/command-error";
import {
  type ProjectCompletionPolicy,
  type UpdateProjectSettingsInput,
  updateProjectSettings,
  validateProjectRepoPath,
} from "../project/project-commands";
import { ProjectDetailsForm } from "../project/project-details-form";
import type { ProjectSummary } from "../../app/app";
import { useI18n } from "../../shared/i18n/i18n";
import type { I18nMessages } from "../../shared/i18n/messages";

interface GeneralSettingsPanelProps {
  completionPolicy: ProjectCompletionPolicy;
  projectId: number;
  projectName: string;
  projectPath: string;
  onProjectUpdated?: (project: ProjectSummary) => void;
}

interface GeneralSettingsFormProps {
  completionPolicy: ProjectCompletionPolicy;
  messages: I18nMessages;
  onSave: (
    input: Pick<
      UpdateProjectSettingsInput,
      "name" | "repoPath" | "completionPolicy"
    >,
  ) => Promise<void>;
  projectName: string;
  projectPath: string;
}

export function GeneralSettingsPanel({
  completionPolicy,
  projectId,
  projectName,
  projectPath,
  onProjectUpdated,
}: GeneralSettingsPanelProps) {
  const { messages } = useI18n();

  async function handleGeneralSettingsSave(
    input: Pick<
      UpdateProjectSettingsInput,
      "name" | "repoPath" | "completionPolicy"
    >,
  ) {
    const updatedProject = await updateProjectSettings({
      projectId,
      name: input.name,
      repoPath: input.repoPath,
      completionPolicy: input.completionPolicy,
    });
    onProjectUpdated?.({
      id: updatedProject.id,
      name: updatedProject.name,
      path: updatedProject.repoPath,
      completionPolicy: updatedProject.completionPolicy,
      recentOpenedAt: `Opened ${new Date(updatedProject.lastOpenedAt).toLocaleString()}`,
      status: "available",
    });
  }

  return (
    <GeneralSettingsForm
      key={`${projectId}:${projectName}:${projectPath}:${completionPolicy}`}
      completionPolicy={completionPolicy}
      messages={messages}
      onSave={handleGeneralSettingsSave}
      projectName={projectName}
      projectPath={projectPath}
    />
  );
}

function GeneralSettingsForm({
  completionPolicy,
  messages,
  onSave,
  projectName,
  projectPath,
}: GeneralSettingsFormProps) {
  const [projectNameValue, setProjectNameValue] = useState(projectName);
  const [projectPathValue, setProjectPathValue] = useState(projectPath);
  const [completionPolicyValue, setCompletionPolicyValue] =
    useState<ProjectCompletionPolicy>(completionPolicy);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChoosingRepoPath, setIsChoosingRepoPath] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const trimmedProjectName = projectNameValue.trim();
  const trimmedProjectPath = projectPathValue.trim();
  const isDirty =
    trimmedProjectName !== projectName ||
    trimmedProjectPath !== projectPath ||
    completionPolicyValue !== completionPolicy;
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
        title: "Select Git Repository",
      });

      if (typeof selectedPath !== "string") {
        return;
      }

      const validatedPath = await validateProjectRepoPath({
        repoPath: selectedPath,
      });
      setProjectPathValue(validatedPath.repoPath);
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
        completionPolicy: completionPolicyValue,
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
      autoCommitLabel={messages.settings.autoCommit}
      chooseFolderLabel={messages.settings.chooseFolder}
      className="settings-card settings-general-card"
      completionPolicy={completionPolicyValue}
      completionStrategyLabel={messages.settings.completionStrategy}
      errorMessage={errorMessage}
      isChoosingRepoPath={isChoosingRepoPath}
      isSubmitting={isSaving}
      onChooseRepoPath={handleChooseRepoPath}
      onCompletionPolicyChange={setCompletionPolicyValue}
      onNameChange={setProjectNameValue}
      onSubmit={handleSubmit}
      projectName={projectNameValue}
      projectNameLabel={messages.settings.projectName}
      repoPath={projectPathValue}
      repoPathLabel={messages.settings.repositoryPath}
      manualLabel={messages.settings.manual}
      submitDisabled={isSaveDisabled}
      submitLabel={messages.settings.save}
      submittingLabel={messages.settings.saving}
    />
  );
}
