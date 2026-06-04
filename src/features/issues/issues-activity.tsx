import type { ProjectSummary } from "../../app/app";

interface IssuesActivityProps {
  project: ProjectSummary;
}

export function IssuesActivity({ project }: IssuesActivityProps) {
  return (
    <main className="activity-surface">
      <div>
        <p className="eyebrow">{project.name}</p>
        <h2>Issues</h2>
      </div>
      <p className="empty-state">
        Issue tracking is not configured for this project yet.
      </p>
    </main>
  );
}
