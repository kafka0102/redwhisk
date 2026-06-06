import { AgentsActivity } from "../features/agents/agents-activity";
import { IssuesActivity } from "../features/issues/issues-activity";
import { ProjectSettingsActivity } from "../features/settings/project-settings-activity";

export type ActivityKey = "issues" | "agents" | "settings";

interface ActivityRouterProps {
  activeActivity: ActivityKey;
  projectId: number;
  projectName: string;
  projectPath: string;
}

export function ActivityRouter({
  activeActivity,
  projectId,
  projectName,
  projectPath,
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

  return (
    <IssuesActivity
      projectId={projectId}
      projectName={projectName}
      projectPath={projectPath}
    />
  );
}
