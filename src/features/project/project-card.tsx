import { ChevronRight, Folder } from "lucide-react";

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
        <span className="project-card__name-row">
          <span className="project-card__name">{project.name}</span>
          <ChevronRight
            aria-hidden="true"
            className="project-card__chevron"
            size={16}
            strokeWidth={1.8}
          />
        </span>
        <span className="project-card__path" translate="no">
          {project.path}
        </span>
        <span className="project-card__meta-row">
          <span className="project-card__meta">{project.recentOpenedAt}</span>
          {isMissing ? (
            <span className="project-card__status project-card__status--missing">
              Path unavailable
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
