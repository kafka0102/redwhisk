import type { ProjectSummary } from "../../app/app";
import { ProjectCardGrid } from "./project-card-grid";

interface ProjectHomeProps {
  isCreatingProject: boolean;
  projects: ProjectSummary[];
  onCreateProject: () => void;
  onProjectOpen: (project: ProjectSummary) => void;
}

export function ProjectHome({
  isCreatingProject,
  onCreateProject,
  projects,
  onProjectOpen,
}: ProjectHomeProps) {
  return (
    <main className="project-home">
      <header className="project-home__header">
        <div>
          <p className="eyebrow">RedWhisk</p>
          <h1>Projects</h1>
          <p className="project-home__lede">
            Open a local Git repository to manage issues, agent sessions, and
            completion checks from one workbench.
          </p>
        </div>
      </header>
      <ProjectCardGrid
        isCreatingProject={isCreatingProject}
        projects={projects}
        onCreateProject={onCreateProject}
        onProjectOpen={onProjectOpen}
      />
    </main>
  );
}
