import { AgentsActivity } from "../features/agents/agents-activity";
import { IssuesActivity } from "../features/issues/issues-activity";
import {
  ProjectSettingsActivity,
  type SettingsMenu,
} from "../features/settings/project-settings-activity";
import type { IssueOpenRequest } from "../features/issues/issue-open-request";
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
  issuesReturnSignal?: number;
  onOpenAgentsActivity: (sessionId: number) => void;
  onOpenIssue: (request: IssueOpenRequest) => void;
  onOpenProjectSettingsAgents: () => void;
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
  requestedIssue: IssueOpenRequest | null;
}

export function ActivityRouter({
  activeActivity,
  activeAgentSessionId,
  activeProjectSettingsMenu,
  issuesReturnSignal,
  onOpenAgentsActivity,
  onOpenIssue,
  onOpenProjectSettingsAgents,
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
  requestedIssue,
}: ActivityRouterProps) {
  if (activeActivity === "agents") {
    return (
      <AgentsActivity
        activeSessionId={activeAgentSessionId}
        onOpenIssue={onOpenIssue}
        onOpenProjectAgentSettings={onOpenProjectSettingsAgents}
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
      issuesReturnSignal={issuesReturnSignal}
      onOpenAgentsActivity={onOpenAgentsActivity}
      onOpenProjectSettingsLabels={onOpenProjectSettingsLabels}
      projectId={projectId}
      requestedIssue={requestedIssue}
      worktreeSetupCommand={projectWorktreeSetupCommand}
    />
  );
}
