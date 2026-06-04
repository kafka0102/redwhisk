import { AgentsActivity } from "../features/agents/agents-activity";
import { IssuesActivity } from "../features/issues/issues-activity";
import { ProjectSettingsActivity } from "../features/settings/project-settings-activity";
import type { ProjectSummary } from "./app";

export type ActivityKey = "issues" | "agents" | "settings";

interface ActivityRouterProps {
  activeActivity: ActivityKey;
  project: ProjectSummary;
}

export function ActivityRouter({
  activeActivity,
  project,
}: ActivityRouterProps) {
  if (activeActivity === "agents") {
    return <AgentsActivity project={project} />;
  }

  if (activeActivity === "settings") {
    return <ProjectSettingsActivity project={project} />;
  }

  return <IssuesActivity project={project} />;
}
