import { useCallback, useEffect, useState, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { AppShell } from "./app-shell";
import "./app.css";
import { ProjectDetailsForm } from "../features/project/project-details-form";
import { ProjectHome } from "../features/project/project-home";
import { I18nProvider } from "../shared/i18n/i18n";
import {
  createProject,
  initializeLocalData,
  listProjects,
  openProject,
  openProjectWindow,
  validateProjectRepoPath,
  type CreateProjectInput,
  type ProjectCompletionPolicy,
  type ProjectRecord,
  type ProjectListItem,
} from "../features/project/project-commands";
import { toCommandError } from "../shared/commands/command-error";

export interface ProjectSummary {
  id: number;
  name: string;
  path: string;
  completionPolicy: ProjectCompletionPolicy;
  recentOpenedAt: string;
  status: "available" | "missing";
}

interface CreateProjectDraft {
  completionPolicy: ProjectCompletionPolicy;
  name: string;
  openInNewWindow: boolean;
  repoPath: string;
  suggestedName: string;
}

export function App() {
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(
    null,
  );
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [createProjectDraft, setCreateProjectDraft] =
    useState<CreateProjectDraft | null>(null);
  const [localDataError, setLocalDataError] = useState<string | null>(null);
  const [projectCreationError, setProjectCreationError] = useState<
    string | null
  >(null);
  const [projectOpenError, setProjectOpenError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function initializeApp() {
      try {
        await initializeLocalData();
        const response = await listProjects();
        if (isMounted) {
          setProjects(response.projects.map(toProjectSummary));
        }
      } catch (error: unknown) {
        if (isMounted) {
          setLocalDataError(toCommandError(error).message);
        }

        return;
      }

      try {
        const project = await openInitialProjectFromUrl();
        if (isMounted && project) {
          const projectSummary = toProjectSummary(project);
          setProjects((currentProjects) =>
            mergeProject(currentProjects, projectSummary),
          );
          setSelectedProject(projectSummary);
        }
      } catch (error: unknown) {
        if (isMounted) {
          setProjectOpenError(toCommandError(error).message);
        }
      }
    }

    void initializeApp();

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleCreateProject() {
    if (isCreatingProject) {
      return;
    }

    setProjectCreationError(null);
    setProjectOpenError(null);
    setIsCreatingProject(true);

    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select Git Repository",
      });

      if (typeof selectedPath !== "string") {
        return;
      }

      const validatedProject = await validateProjectRepoPath({
        repoPath: selectedPath,
      });
      setCreateProjectDraft({
        completionPolicy: "agent_auto_commit",
        name: validatedProject.suggestedName,
        openInNewWindow: false,
        repoPath: validatedProject.repoPath,
        suggestedName: validatedProject.suggestedName,
      });
    } catch (error) {
      setProjectCreationError(toCommandError(error).message);
    } finally {
      setIsCreatingProject(false);
    }
  }

  async function handleProjectOpen(project: ProjectSummary) {
    setProjectCreationError(null);
    setProjectOpenError(null);

    try {
      const openedProject = await openProject({ projectId: project.id });
      const projectSummary = toProjectSummary(openedProject);
      setProjects((currentProjects) =>
        mergeProject(currentProjects, projectSummary),
      );
      setSelectedProject(projectSummary);
    } catch (error) {
      setProjectOpenError(toCommandError(error).message);
    }
  }

  const refreshProjects = useCallback(async () => {
    const response = await listProjects();
    setProjects(response.projects.map(toProjectSummary));
  }, []);

  const handleProjectUpdated = useCallback((project: ProjectSummary) => {
    setSelectedProject((currentProject) =>
      currentProject?.id === project.id ? project : currentProject,
    );
    setProjects((currentProjects) => mergeProject(currentProjects, project));
  }, []);

  const handleCreateProjectConfirmed = useCallback(
    async (input: CreateProjectInput) => {
      const project = await createProject(input);
      const projectSummary = toProjectSummary(project);
      setProjects((currentProjects) =>
        mergeProject(currentProjects, projectSummary),
      );

      if (createProjectDraft?.openInNewWindow) {
        await openProjectWindow({ projectId: project.id });
      } else {
        setSelectedProject(projectSummary);
      }

      setCreateProjectDraft(null);
    },
    [createProjectDraft],
  );

  const handleCreateProjectFromSwitcher = useCallback(() => {
    setProjectCreationError(null);
    setProjectOpenError(null);
    setCreateProjectDraft({
      completionPolicy: "agent_auto_commit",
      name: "",
      openInNewWindow: true,
      repoPath: "",
      suggestedName: "",
    });
  }, []);

  if (!selectedProject) {
    const statusMessages = [
      {
        label: "Local data status",
        message: localDataError,
      },
      {
        label: "Project creation status",
        message: projectCreationError,
      },
      {
        label: "Project open status",
        message: projectOpenError,
      },
    ].filter(
      (status): status is { label: string; message: string } =>
        status.message !== null,
    );

    return (
      <>
        {statusMessages.length > 0 ? (
          <div className="local-data-status-stack">
            {statusMessages.map((status) => (
              <div
                className="local-data-status"
                key={status.label}
                role="status"
                aria-label={status.label}
              >
                {status.message}
              </div>
            ))}
          </div>
        ) : null}
        <ProjectHome
          isCreatingProject={isCreatingProject}
          projects={projects}
          onCreateProject={handleCreateProject}
          onProjectOpen={handleProjectOpen}
        />
        {createProjectDraft ? (
          <CreateProjectDialog
            key={createProjectDraft.repoPath}
            initialDraft={createProjectDraft}
            onClose={() => setCreateProjectDraft(null)}
            onCreate={handleCreateProjectConfirmed}
          />
        ) : null}
      </>
    );
  }

  return (
    <I18nProvider>
      <>
        <AppShell
          onCreateProject={handleCreateProjectFromSwitcher}
          onProjectUpdated={handleProjectUpdated}
          project={selectedProject}
          projects={projects}
          onProjectsRefresh={refreshProjects}
        />
        {createProjectDraft ? (
          <CreateProjectDialog
            key={createProjectDraft.repoPath}
            initialDraft={createProjectDraft}
            onClose={() => setCreateProjectDraft(null)}
            onCreate={handleCreateProjectConfirmed}
          />
        ) : null}
      </>
    </I18nProvider>
  );
}

function toProjectSummary(
  project: ProjectRecord | ProjectListItem,
): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    path: project.repoPath,
    completionPolicy: project.completionPolicy,
    recentOpenedAt: `Opened ${formatLocalTimestamp(project.lastOpenedAt)}`,
    status: "pathStatus" in project ? project.pathStatus : "available",
  };
}

function formatLocalTimestamp(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toLocaleString();
}

function mergeProject(
  currentProjects: ProjectSummary[],
  nextProject: ProjectSummary,
): ProjectSummary[] {
  const remainingProjects = currentProjects.filter(
    (project) => project.id !== nextProject.id,
  );

  return [nextProject, ...remainingProjects];
}

function openInitialProjectFromUrl(): Promise<ProjectRecord | null> {
  const projectIdParam = new URLSearchParams(window.location.search).get(
    "projectId",
  );

  if (!projectIdParam) {
    return Promise.resolve(null);
  }

  const projectId = Number(projectIdParam);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return Promise.reject({
      code: "PROJECT_NOT_FOUND",
      message: "Project 不存在。",
    });
  }

  return openProject({ projectId });
}

interface CreateProjectDialogProps {
  initialDraft: CreateProjectDraft;
  onClose: () => void;
  onCreate: (input: CreateProjectInput) => Promise<void>;
}

function CreateProjectDialog({
  initialDraft,
  onClose,
  onCreate,
}: CreateProjectDialogProps) {
  const [projectNameValue, setProjectNameValue] = useState(initialDraft.name);
  const [projectPathValue, setProjectPathValue] = useState(initialDraft.repoPath);
  const [completionPolicyValue, setCompletionPolicyValue] =
    useState<ProjectCompletionPolicy>(initialDraft.completionPolicy);
  const [suggestedName, setSuggestedName] = useState(initialDraft.suggestedName);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChoosingRepoPath, setIsChoosingRepoPath] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const trimmedProjectName = projectNameValue.trim();
  const trimmedProjectPath = projectPathValue.trim();
  const isSubmitDisabled =
    isSubmitting ||
    isChoosingRepoPath ||
    trimmedProjectName.length === 0 ||
    trimmedProjectPath.length === 0;

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

      const validatedProject = await validateProjectRepoPath({
        repoPath: selectedPath,
      });
      const shouldReplaceName =
        trimmedProjectName.length === 0 || trimmedProjectName === suggestedName;

      setProjectPathValue(validatedProject.repoPath);
      setSuggestedName(validatedProject.suggestedName);
      if (shouldReplaceName) {
        setProjectNameValue(validatedProject.suggestedName);
      }
    } catch (error: unknown) {
      setErrorMessage(toCommandError(error).message);
    } finally {
      setIsChoosingRepoPath(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
        completionPolicy: completionPolicyValue,
      });
    } catch (error: unknown) {
      setErrorMessage(toCommandError(error).message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="issue-dialog-overlay" role="presentation">
      <div
        className="issue-dialog issue-dialog--compact"
        role="dialog"
        aria-label="New Project"
      >
        <div className="issue-dialog__header">
          <h3>New Project</h3>
        </div>
        <div className="issue-dialog__body issue-dialog__body--single">
          <ProjectDetailsForm
            ariaStatusLabel="Project creation status"
            cancelLabel="Cancel"
            chooseFolderLabel="Choose folder"
            className="settings-card settings-general-card project-details-card"
            completionPolicy={completionPolicyValue}
            completionStrategyLabel="Git completion strategy"
            errorMessage={errorMessage}
            isChoosingRepoPath={isChoosingRepoPath}
            isSubmitting={isSubmitting}
            onCancel={onClose}
            onChooseRepoPath={handleChooseRepoPath}
            onCompletionPolicyChange={setCompletionPolicyValue}
            onNameChange={setProjectNameValue}
            onSubmit={handleSubmit}
            projectName={projectNameValue}
            projectNameLabel="Project Name"
            repoPath={projectPathValue}
            repoPathLabel="Repository path"
            submitDisabled={isSubmitDisabled}
            submitLabel="Create Project"
            submittingLabel="Creating Project"
          />
        </div>
      </div>
    </div>
  );
}
