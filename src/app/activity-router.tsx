import { AgentsActivity } from "../features/agents/agents-activity";
import { IssuesActivity } from "../features/issues/issues-activity";
import { DesignSystemActivity } from "../features/design-system/design-system-activity";
import {
  ProjectSettingsActivity,
  type SettingsMenu,
} from "../features/settings/project-settings-activity";
import type { ProjectTerminalsActivityState } from "../features/terminals/project-terminals-activity-state";
import { ProjectTerminalsActivity } from "../features/terminals/project-terminals-activity";
import type {
  ProjectCompletionPolicy,
  ProjectWorktreeLocation,
} from "../features/project/project-commands";
import type { ProjectSummary } from "./app";
import type { Dispatch, SetStateAction } from "react";

export type ActivityKey =
  | "issues"
  | "agents"
  | "terminals"
  | "settings"
  | "design-system";

interface ActivityRouterProps {
  activeActivity: ActivityKey;
  activeAgentSessionId: number | null;
  activeProjectSettingsMenu: SettingsMenu;
  onOpenAgentsActivity: (sessionId: number) => void;
  onOpenProjectSettingsLabels: () => void;
  onProjectSettingsMenuChange: (menu: SettingsMenu) => void;
  onProjectUpdated: (project: ProjectSummary) => void;
  onProjectTerminalsStateChange: Dispatch<
    SetStateAction<ProjectTerminalsActivityState>
  >;
  onSelectAgentSession: (sessionId: number) => void;
  projectCompletionPolicy: ProjectCompletionPolicy;
  projectId: number;
  projectName: string;
  projectPath: string;
  projectWorktreeLocation: ProjectWorktreeLocation;
  projectWorktreeSetupCommand: string;
  projectTerminalsState: ProjectTerminalsActivityState;
  requestedIssueId: number | null;
}

export function ActivityRouter({
  activeActivity,
  activeAgentSessionId,
  activeProjectSettingsMenu,
  onOpenAgentsActivity,
  onOpenProjectSettingsLabels,
  onProjectSettingsMenuChange,
  onProjectUpdated,
  onProjectTerminalsStateChange,
  onSelectAgentSession,
  projectCompletionPolicy,
  projectId,
  projectName,
  projectPath,
  projectWorktreeLocation,
  projectWorktreeSetupCommand,
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
        activeMenu={activeProjectSettingsMenu}
        completionPolicy={projectCompletionPolicy}
        key={projectId}
        onMenuChange={onProjectSettingsMenuChange}
        onProjectUpdated={onProjectUpdated}
        projectId={projectId}
        projectName={projectName}
        projectPath={projectPath}
        worktreeLocation={projectWorktreeLocation}
        worktreeSetupCommand={projectWorktreeSetupCommand}
      />
    );
  }

  if (activeActivity === "design-system") {
    return <DesignSystemActivity />;
  }

  return (
    <IssuesActivity
      onOpenAgentsActivity={onOpenAgentsActivity}
      onOpenProjectSettingsLabels={onOpenProjectSettingsLabels}
      projectCompletionPolicy={projectCompletionPolicy}
      projectId={projectId}
      requestedIssueId={requestedIssueId}
      worktreeSetupCommand={projectWorktreeSetupCommand}
    />
  );
}
