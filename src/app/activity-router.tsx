import { AgentsActivity } from "../features/agents/agents-activity";
import { IssuesActivity } from "../features/issues/issues-activity";
import {
  ProjectSettingsActivity,
  type SettingsMenu,
} from "../features/settings/project-settings-activity";
import type { ProjectTerminalsActivityState } from "../features/terminals/project-terminals-activity-state";
import { ProjectTerminalsActivity } from "../features/terminals/project-terminals-activity";
import type { ProjectWorktreeLocation } from "../features/project/project-commands";
import type { ProjectSummary } from "./app";
import type { Dispatch, SetStateAction } from "react";

export type ActivityKey = "issues" | "agents" | "terminals" | "settings";

interface ActivityRouterProps {
  activeActivity: ActivityKey;
  activeAgentSessionId: number | null;
  activeProjectSettingsMenu: SettingsMenu;
  onOpenAgentsActivity: (sessionId: number) => void;
  onOpenIssue: (issueId: number) => void;
  onOpenProjectSettingsLabels: () => void;
  onProjectSettingsMenuChange: (menu: SettingsMenu) => void;
  onProjectUpdated: (project: ProjectSummary) => void;
  onProjectTerminalsStateChange: Dispatch<
    SetStateAction<ProjectTerminalsActivityState>
  >;
  onSelectAgentSession: (sessionId: number) => void;
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
  onOpenIssue,
  onOpenProjectSettingsLabels,
  onProjectSettingsMenuChange,
  onProjectUpdated,
  onProjectTerminalsStateChange,
  onSelectAgentSession,
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
        onOpenIssue={onOpenIssue}
        onSelectSession={onSelectAgentSession}
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

  return (
    <IssuesActivity
      key={projectId}
      onOpenAgentsActivity={onOpenAgentsActivity}
      onOpenProjectSettingsLabels={onOpenProjectSettingsLabels}
      projectId={projectId}
      requestedIssueId={requestedIssueId}
      worktreeSetupCommand={projectWorktreeSetupCommand}
    />
  );
}
