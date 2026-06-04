import type { ProjectSummary } from "../../app/app";

interface ProjectSettingsActivityProps {
  project: ProjectSummary;
}

export function ProjectSettingsActivity({
  project,
}: ProjectSettingsActivityProps) {
  return (
    <main className="activity-surface">
      <div>
        <p className="eyebrow">{project.name}</p>
        <h2>Settings</h2>
      </div>
      <p className="empty-state">
        Project settings will be available in a later story.
      </p>
    </main>
  );
}
