import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { AppShell } from "./app-shell";
import "./app.css";
import { ProjectHome } from "../features/project/project-home";
import {
  createProject,
  initializeLocalData,
  type ProjectRecord,
} from "../features/project/project-commands";
import { toCommandError } from "../shared/commands/command-error";

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  recentOpenedAt: string;
  status: "available" | "missing";
}

const MOCK_PROJECTS: ProjectSummary[] = [
  {
    id: "redwhisk",
    name: "RedWhisk",
    path: "/Users/kafka0102/workspace/kafka/redwhisk",
    recentOpenedAt: "Opened today",
    status: "available",
  },
  {
    id: "local-agents",
    name: "Local Agents Lab",
    path: "/Users/kafka0102/workspace/local-agents",
    recentOpenedAt: "Opened yesterday",
    status: "missing",
  },
];

export function App() {
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(
    null,
  );
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [localDataError, setLocalDataError] = useState<string | null>(null);
  const [projectCreationError, setProjectCreationError] = useState<
    string | null
  >(null);

  useEffect(() => {
    let isMounted = true;

    initializeLocalData().catch((error: unknown) => {
      if (isMounted) {
        setLocalDataError(toCommandError(error).message);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleCreateProject() {
    if (isCreatingProject) {
      return;
    }

    setProjectCreationError(null);
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
      setSelectedProject(toProjectSummary(project));
    } catch (error) {
      setProjectCreationError(toCommandError(error).message);
    } finally {
      setIsCreatingProject(false);
    }
  }

  if (!selectedProject) {
    return (
      <>
        {localDataError ? (
          <div
            className="local-data-status"
            role="status"
            aria-label="Local data status"
          >
            {localDataError}
          </div>
        ) : null}
        {projectCreationError ? (
          <div
            className="local-data-status"
            role="status"
            aria-label="Project creation status"
          >
            {projectCreationError}
          </div>
        ) : null}
        <ProjectHome
          isCreatingProject={isCreatingProject}
          projects={MOCK_PROJECTS}
          onCreateProject={handleCreateProject}
          onProjectOpen={setSelectedProject}
        />
      </>
    );
  }

  return <AppShell project={selectedProject} />;
}

function toProjectSummary(project: ProjectRecord): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    path: project.repoPath,
    recentOpenedAt: `Opened ${project.lastOpenedAt}`,
    status: "available",
  };
}
