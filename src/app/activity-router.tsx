import { AgentsActivity } from "../features/agents/agents-activity";
import { IssuesActivity } from "../features/issues/issues-activity";
import { ProjectSettingsActivity } from "../features/settings/project-settings-activity";

export type ActivityKey = "issues" | "agents" | "settings";

interface ActivityRouterProps {
  activeActivity: ActivityKey;
  projectId: number;
  projectName: string;
}

export function ActivityRouter({
  activeActivity,
  projectId,
  projectName,
}: ActivityRouterProps) {
  if (activeActivity === "agents") {
    return <AgentsActivity />;
  }

  if (activeActivity === "settings") {
    return (
      <ProjectSettingsActivity
        key={projectId}
        projectId={projectId}
        projectName={projectName}
      />
    );
  }

  return <IssuesActivity projectId={projectId} />;
}
