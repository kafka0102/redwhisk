import type { ProjectSummary } from "../../app/app";

interface AgentsActivityProps {
  project: ProjectSummary;
}

export function AgentsActivity({ project }: AgentsActivityProps) {
  return (
    <main className="activity-surface">
      <div>
        <p className="eyebrow">{project.name}</p>
        <h2>Agents</h2>
      </div>
      <p className="empty-state">
        Agent sessions will appear here after the project flow is implemented.
      </p>
    </main>
  );
}
