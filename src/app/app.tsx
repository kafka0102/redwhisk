import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { AppShell } from "./app-shell";
import "./app.css";
import { ProjectHome } from "../features/project/project-home";
import {
  createProject,
  initializeLocalData,
  listProjects,
  openProject,
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

export function App() {
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(
    null,
  );
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
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

      const project = await createProject({ repoPath: selectedPath });
      const projectSummary = toProjectSummary(project);
      setProjects((currentProjects) =>
        mergeProject(currentProjects, projectSummary),
      );
      setSelectedProject(projectSummary);
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
      </>
    );
  }

  return (
    <AppShell
      onProjectUpdated={handleProjectUpdated}
      project={selectedProject}
      projects={projects}
      onProjectsRefresh={refreshProjects}
    />
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
