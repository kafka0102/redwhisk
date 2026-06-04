import { Plus } from "lucide-react";

export function CreateProjectCard() {
  return (
    <button className="project-card project-card--create" type="button">
      <span className="project-card__create-icon" aria-hidden="true">
        <Plus size={20} strokeWidth={1.8} />
      </span>
      <span>Create Project</span>
    </button>
  );
}
