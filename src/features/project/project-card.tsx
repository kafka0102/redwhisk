import { Folder } from "lucide-react";

import type { ProjectSummary } from "../../app/app";

interface ProjectCardProps {
  project: ProjectSummary;
  onOpen: () => void;
}

export function ProjectCard({ project, onOpen }: ProjectCardProps) {
  const isMissing = project.status === "missing";

  return (
    <button
      className="project-card"
      type="button"
      aria-label={`Open project ${project.name}`}
      onClick={onOpen}
    >
      <span className="project-card__icon" aria-hidden="true">
        <Folder size={18} strokeWidth={1.8} />
      </span>
      <span className="project-card__body">
        <span className="project-card__name">{project.name}</span>
        <span className="project-card__path">{project.path}</span>
        <span className="project-card__meta">
          {project.recentOpenedAt}
          {isMissing ? " - path unavailable" : ""}
        </span>
      </span>
    </button>
  );
}
