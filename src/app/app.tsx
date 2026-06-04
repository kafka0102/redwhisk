import { useEffect, useState } from "react";

import { AppShell } from "./app-shell";
import "./app.css";
import { ProjectHome } from "../features/project/project-home";
import { initializeLocalData } from "../features/project/project-commands";
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
  const [localDataError, setLocalDataError] = useState<string | null>(null);

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
        <ProjectHome
          projects={MOCK_PROJECTS}
          onProjectOpen={setSelectedProject}
        />
      </>
    );
  }

  return <AppShell project={selectedProject} />;
}
