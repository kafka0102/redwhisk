import type { ProjectSummary } from "../../app/app";
import { CreateProjectCard } from "./create-project-card";
import { ProjectCard } from "./project-card";

interface ProjectCardGridProps {
  projects: ProjectSummary[];
  isCreatingProject: boolean;
  onCreateProject: () => void;
  onProjectOpen: (project: ProjectSummary) => void;
}

export function ProjectCardGrid({
  isCreatingProject,
  onCreateProject,
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
        <CreateProjectCard
          isCreating={isCreatingProject}
          onCreate={onCreateProject}
        />
      </li>
    </ul>
  );
}
