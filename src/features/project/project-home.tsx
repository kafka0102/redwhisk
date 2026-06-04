import type { ProjectSummary } from "../../app/app";
import { ProjectCardGrid } from "./project-card-grid";

interface ProjectHomeProps {
  projects: ProjectSummary[];
  onProjectOpen: (project: ProjectSummary) => void;
}

export function ProjectHome({ projects, onProjectOpen }: ProjectHomeProps) {
  return (
    <main className="project-home">
      <header className="project-home__header">
        <div>
          <p className="eyebrow">RedWhisk</p>
          <h1>Projects</h1>
        </div>
      </header>
      <ProjectCardGrid projects={projects} onProjectOpen={onProjectOpen} />
    </main>
  );
}
