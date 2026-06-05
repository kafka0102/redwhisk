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
        <div className="project-home__title-block">
          <h1>Projects</h1>
          <p className="project-home__lede">
            Open a local Git repository to keep issues, runs, review, and
            completion checks in one workbench.
          </p>
          <div className="project-home__meta" aria-label="Project summary">
            <span>
              {projects.length} local{" "}
              {projects.length === 1 ? "repository" : "repositories"}
            </span>
            <span>Git-first desktop flow</span>
          </div>
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
