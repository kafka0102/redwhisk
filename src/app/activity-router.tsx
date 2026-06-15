import { AgentsActivity } from "../features/agents/agents-activity";
import { IssuesActivity } from "../features/issues/issues-activity";
import { ProjectSettingsActivity } from "../features/settings/project-settings-activity";
import type { ProjectTerminalsActivityState } from "../features/terminals/project-terminals-activity-state";
import {
  ProjectTerminalsActivity,
} from "../features/terminals/project-terminals-activity";
import type { ProjectCompletionPolicy } from "../features/project/project-commands";
import type { ProjectSummary } from "./app";
import type { Dispatch, SetStateAction } from "react";

export type ActivityKey = "issues" | "agents" | "terminals" | "settings";

interface ActivityRouterProps {
  activeActivity: ActivityKey;
  activeAgentSessionId: number | null;
  onOpenAgentsActivity: (sessionId: number) => void;
  onProjectUpdated: (project: ProjectSummary) => void;
  onProjectTerminalsStateChange: Dispatch<
    SetStateAction<ProjectTerminalsActivityState>
  >;
  onSelectAgentSession: (sessionId: number) => void;
  projectCompletionPolicy: ProjectCompletionPolicy;
  projectId: number;
  projectName: string;
  projectPath: string;
  projectTerminalsState: ProjectTerminalsActivityState;
  requestedIssueId: number | null;
}

export function ActivityRouter({
  activeActivity,
  activeAgentSessionId,
  onOpenAgentsActivity,
  onProjectUpdated,
  onProjectTerminalsStateChange,
  onSelectAgentSession,
  projectCompletionPolicy,
  projectId,
  projectName,
  projectPath,
  projectTerminalsState,
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

  if (activeActivity === "terminals") {
    return (
      <ProjectTerminalsActivity
        key={projectId}
        onStateChange={onProjectTerminalsStateChange}
        projectId={projectId}
        projectName={projectName}
        projectPath={projectPath}
        state={projectTerminalsState}
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
