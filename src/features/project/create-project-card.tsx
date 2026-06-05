import { Plus } from "lucide-react";

interface CreateProjectCardProps {
  isCreating: boolean;
  onCreate: () => void;
}

export function CreateProjectCard({
  isCreating,
  onCreate,
}: CreateProjectCardProps) {
  return (
    <button
      className="project-card project-card--create"
      type="button"
      disabled={isCreating}
      onClick={onCreate}
    >
      <span className="project-card__create-icon" aria-hidden="true">
        <Plus size={20} strokeWidth={1.8} />
      </span>
      <span>{isCreating ? "Creating Project" : "Create Project"}</span>
    </button>
  );
}
