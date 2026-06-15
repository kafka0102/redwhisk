import { AgentsActivity } from "../features/agents/agents-activity";
import { IssuesActivity } from "../features/issues/issues-activity";
import { ProjectSettingsActivity } from "../features/settings/project-settings-activity";
import type { ProjectCompletionPolicy } from "../features/project/project-commands";
import type { ProjectSummary } from "./app";

export type ActivityKey = "issues" | "agents" | "settings";

interface ActivityRouterProps {
  activeActivity: ActivityKey;
  activeAgentSessionId: number | null;
  onOpenAgentsActivity: (sessionId: number) => void;
  onProjectUpdated: (project: ProjectSummary) => void;
  onSelectAgentSession: (sessionId: number) => void;
  projectCompletionPolicy: ProjectCompletionPolicy;
  projectId: number;
  projectName: string;
  projectPath: string;
  requestedIssueId: number | null;
}

export function ActivityRouter({
  activeActivity,
  activeAgentSessionId,
  onOpenAgentsActivity,
  onProjectUpdated,
  onSelectAgentSession,
  projectCompletionPolicy,
  projectId,
  projectName,
  projectPath,
  requestedIssueId,
}: ActivityRouterProps) {
  if (activeActivity === "agents") {
    return (
      <AgentsActivity
        activeSessionId={activeAgentSessionId}
        onSelectSession={onSelectAgentSession}
        projectCompletionPolicy={projectCompletionPolicy}
        projectId={projectId}
      />
    );
  }

  if (activeActivity === "settings") {
    return (
      <ProjectSettingsActivity
        completionPolicy={projectCompletionPolicy}
        key={projectId}
        onProjectUpdated={onProjectUpdated}
        projectId={projectId}
        projectName={projectName}
        projectPath={projectPath}
      />
    );
  }

  return (
    <IssuesActivity
      onOpenAgentsActivity={onOpenAgentsActivity}
      projectId={projectId}
      requestedIssueId={requestedIssueId}
    />
  );
}
