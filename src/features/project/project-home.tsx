import type { ProjectSummary } from "../../app/app";
import { ProjectList } from "./project-list";

interface ProjectHomeProps {
  isCreatingProject: boolean;
  projects: ProjectSummary[];
  onCreateProject: () => void;
  onProjectOpen: (project: ProjectSummary) => void;
  onOpenInCurrentWindow: (project: ProjectSummary) => Promise<void> | void;
  onProjectsRefresh: () => Promise<void>;
}

export function ProjectHome({
  isCreatingProject,
  onCreateProject,
  onProjectsRefresh,
  projects,
  onOpenInCurrentWindow,
  onProjectOpen,
}: ProjectHomeProps) {
  return (
    <main className="project-home">
      <header className="project-home__window-header" data-tauri-drag-region />
      <ProjectList
        isCreatingProject={isCreatingProject}
        projects={projects}
        onCreateProject={onCreateProject}
        onProjectOpen={onProjectOpen}
        onOpenInCurrentWindow={onOpenInCurrentWindow}
        onProjectsRefresh={onProjectsRefresh}
      />
    </main>
  );
}
