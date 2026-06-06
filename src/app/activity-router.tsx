import { AgentsActivity } from "../features/agents/agents-activity";
import { IssuesActivity } from "../features/issues/issues-activity";
import { ProjectSettingsActivity } from "../features/settings/project-settings-activity";

export type ActivityKey = "issues" | "agents" | "settings";

interface ActivityRouterProps {
  activeActivity: ActivityKey;
  activeAgentSessionId: number | null;
  onOpenAgentsActivity: (sessionId: number) => void;
  projectId: number;
  projectName: string;
}

export function ActivityRouter({
  activeActivity,
  activeAgentSessionId,
  onOpenAgentsActivity,
  projectId,
  projectName,
}: ActivityRouterProps) {
  if (activeActivity === "agents") {
    return <AgentsActivity activeSessionId={activeAgentSessionId} />;
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
      onOpenAgentsActivity={onOpenAgentsActivity}
      projectId={projectId}
    />
  );
}
