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
      aria-label={isCreating ? "Creating Project…" : "Create Project"}
      className="project-card project-card--create"
      type="button"
      disabled={isCreating}
      onClick={onCreate}
    >
      <span className="project-card__create-icon" aria-hidden="true">
        {isCreating ? (
          <span className="button-spinner" />
        ) : (
          <Plus size={20} strokeWidth={1.8} />
        )}
      </span>
      <span className="project-card__create-copy">
        <span className="project-card__create-title">
          {isCreating ? "Creating Project…" : "Create Project"}
        </span>
        <span className="project-card__create-description">
          {isCreating
            ? "Waiting for a repository selection…"
            : "Select a local Git repository and open it in the workbench."}
        </span>
      </span>
    </button>
  );
}
