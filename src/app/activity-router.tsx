import { AgentsActivity } from "../features/agents/agents-activity";
import { IssuesActivity } from "../features/issues/issues-activity";
import { ProjectSettingsActivity } from "../features/settings/project-settings-activity";

export type ActivityKey = "issues" | "agents" | "settings";

interface ActivityRouterProps {
  activeActivity: ActivityKey;
}

export function ActivityRouter({ activeActivity }: ActivityRouterProps) {
  if (activeActivity === "agents") {
    return <AgentsActivity />;
  }

  if (activeActivity === "settings") {
    return <ProjectSettingsActivity />;
  }

  return <IssuesActivity />;
}
