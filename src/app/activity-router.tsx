import {
  lazy,
  Suspense,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { IssuesActivity } from "../features/issues/issues-activity";
import type { IssueOpenRequest } from "../features/issues/issue-open-request";
import type { ProjectWorktreeLocation } from "../features/project/project-commands";
import type { SettingsMenu } from "../features/settings/project-settings-activity";
import type { ProjectTerminalsActivityState } from "../features/terminals/project-terminals-activity-state";
import { useI18n } from "../shared/i18n/i18n";
import type { CodeWorkspaceRoot } from "../shared/workspace/workspace-commands";
import type { ProjectSummary } from "./app";

const AgentsActivity = lazy(async () => {
  const module = await import("../features/agents/agents-activity");
  return { default: module.AgentsActivity };
});

const ChangesActivity = lazy(async () => {
  const module = await import("../features/changes/changes-activity");
  return { default: module.ChangesActivity };
});

const CodeActivity = lazy(async () => {
  const module = await import("../features/code/code-activity");
  return { default: module.CodeActivity };
});

const ProjectSettingsActivity = lazy(async () => {
  const module = await import("../features/settings/project-settings-activity");
  return { default: module.ProjectSettingsActivity };
});

const ProjectTerminalsActivity = lazy(async () => {
  const module =
    await import("../features/terminals/project-terminals-activity");
  return { default: module.ProjectTerminalsActivity };
});

export type ActivityKey =
  | "issues"
  | "agents"
  | "code"
  | "changes"
  | "terminals"
  | "settings";

interface ActivityRouterProps {
  activeActivity: ActivityKey;
  activeAgentSessionId: number | null;
  activeProjectSettingsMenu: SettingsMenu;
  issuesReturnSignal?: number;
  onOpenAgentsActivity: (sessionId: number) => void;
  onOpenIssue: (request: IssueOpenRequest) => void;
  onOpenProjectSettingsLabels: () => void;
  onProjectSettingsMenuChange: (menu: SettingsMenu) => void;
  onProjectUpdated: (project: ProjectSummary) => void;
  onProjectTerminalsStateChange: Dispatch<
    SetStateAction<ProjectTerminalsActivityState>
  >;
  onSelectAgentSession: (sessionId: number) => void;
  projectId: number;
  projectCodeWorkspaces: CodeWorkspaceRoot[];
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
  onOpenProjectSettingsLabels,
  onProjectSettingsMenuChange,
  onProjectUpdated,
  onProjectTerminalsStateChange,
  onSelectAgentSession,
  projectId,
  projectCodeWorkspaces,
  projectName,
  projectPath,
  projectWorktreeLocation,
  projectWorktreeSetupCommand,
  projectTerminalsState,
  requestedIssue,
}: ActivityRouterProps) {
  const { messages } = useI18n();
  // 终端 Activity 一旦打开就常驻挂载（hidden 切换），保留 xterm 与 live sequence，
  // 避免切到 Issues 再回来时整页卸载 → catch-up 重放 Codex log 花屏/空白。
  const [terminalsMounted, setTerminalsMounted] = useState(
    () => activeActivity === "terminals",
  );
  if (activeActivity === "terminals" && !terminalsMounted) {
    setTerminalsMounted(true);
  }

  const loadingFallback = (
    <p className="activity-surface__loading" role="status">
      {messages.settings.loading}
    </p>
  );

  // 默认 issues 保持同步加载；其余 Activity 按需 chunk，避免新项目窗口冷启动
  // 同步解析 Monaco / xterm / Agents 等大依赖。
  let primaryActivity: ReactNode = null;
  if (activeActivity === "issues") {
    primaryActivity = (
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
  } else if (activeActivity === "agents") {
    primaryActivity = (
      <Suspense fallback={loadingFallback}>
        <AgentsActivity
          activeSessionId={activeAgentSessionId}
          onOpenIssue={onOpenIssue}
          onSelectSession={onSelectAgentSession}
          projectId={projectId}
        />
      </Suspense>
    );
  } else if (activeActivity === "code") {
    primaryActivity = (
      <Suspense fallback={loadingFallback}>
        <CodeActivity
          key={projectId}
          projectId={projectId}
          roots={projectCodeWorkspaces}
        />
      </Suspense>
    );
  } else if (activeActivity === "changes") {
    primaryActivity = (
      <Suspense fallback={loadingFallback}>
        <ChangesActivity
          key={projectId}
          projectId={projectId}
          roots={projectCodeWorkspaces}
        />
      </Suspense>
    );
  } else if (activeActivity === "settings") {
    primaryActivity = (
      <Suspense fallback={loadingFallback}>
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
      </Suspense>
    );
  }

  return (
    <>
      {primaryActivity}
      {terminalsMounted ? (
        <Suspense
          fallback={activeActivity === "terminals" ? loadingFallback : null}
        >
          <div
            className="activity-keep-alive-host"
            hidden={activeActivity !== "terminals"}
          >
            <ProjectTerminalsActivity
              key={projectId}
              onStateChange={onProjectTerminalsStateChange}
              projectId={projectId}
              projectName={projectName}
              projectPath={projectPath}
              state={projectTerminalsState}
            />
          </div>
        </Suspense>
      ) : null}
    </>
  );
}
