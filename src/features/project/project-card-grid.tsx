import type { ProjectSummary } from "../../app/app";
import { CreateProjectCard } from "./create-project-card";
import { ProjectCard } from "./project-card";

interface ProjectCardGridProps {
  projects: ProjectSummary[];
  onProjectOpen: (project: ProjectSummary) => void;
}

export function ProjectCardGrid({
  projects,
  onProjectOpen,
}: ProjectCardGridProps) {
  return (
    <ul className="project-grid" aria-label="Local projects">
      {projects.map((project) => (
        <li key={project.id}>
          <ProjectCard
            project={project}
            onOpen={() => onProjectOpen(project)}
          />
        </li>
      ))}
      <li>
        <CreateProjectCard />
      </li>
    </ul>
  );
}
