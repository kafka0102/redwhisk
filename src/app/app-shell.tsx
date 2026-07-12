import {
  Bolt,
  Bot,
  Code2,
  Kanban,
  Terminal,
  UserRoundCog,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { ActivityRouter, type ActivityKey } from "./activity-router";
import type { ProjectSummary } from "./app";
import { ProjectSwitcher } from "../features/project/project-switcher";
import { GlobalSettingsActivity } from "../features/settings/global-settings-activity";
import type { IssueOpenRequest } from "../features/issues/issue-open-request";
import { useAgentSessionNotifications } from "../features/agents/session-notifications/use-agent-session-notifications";
import type { SettingsMenu } from "../features/settings/project-settings-activity";
import {
  getDefaultProjectTerminalsActivityState,
  type ProjectTerminalsActivityState,
} from "../features/terminals/project-terminals-activity-state";
import { useI18n } from "../shared/i18n/i18n";

interface AppShellProps {
  onCreateProject: () => void;
  onProjectUpdated: (project: ProjectSummary) => void;
  project: ProjectSummary;
  projects: ProjectSummary[];
  onProjectsRefresh: () => Promise<void>;
  openAgentSessionRequest?: {
    projectId: number;
    requestId: number;
    sessionId: number;
  } | null;
}

const ACTIVITIES: Array<{
  key: ActivityKey;
  Icon: LucideIcon;
}> = [
  { key: "issues", Icon: Kanban },
  { key: "agents", Icon: Bot },
  { key: "code", Icon: Code2 },
  { key: "terminals", Icon: Terminal },
  { key: "settings", Icon: Bolt },
];

export function AppShell({
  onCreateProject,
  onProjectUpdated,
  onProjectsRefresh,
  openAgentSessionRequest,
  project,
  projects,
}: AppShellProps) {
  const { messages } = useI18n();
  useAgentSessionNotifications({
    projectId: project.id,
    projectName: project.name,
  });
  const [activeActivity, setActiveActivity] = useState<ActivityKey>("issues");
  const [activeProjectSettingsMenu, setActiveProjectSettingsMenu] =
    useState<SettingsMenu>("general");
  const [isGlobalSettingsOpen, setIsGlobalSettingsOpen] = useState(false);
  const [activeAgentSessionId, setActiveAgentSessionId] = useState<
    number | null
  >(null);
  const [
    projectTerminalsStateByProjectId,
    setProjectTerminalsStateByProjectId,
  ] = useState<Record<number, ProjectTerminalsActivityState>>({});
  const [requestedIssue, setRequestedIssue] = useState<IssueOpenRequest | null>(
    null,
  );
  const [issuesReturnSignal, setIssuesReturnSignal] = useState(0);
  const projectTerminalsState =
    projectTerminalsStateByProjectId[project.id] ??
    getDefaultProjectTerminalsActivityState();
  const openAgentSession = useCallback((sessionId: number) => {
    setActiveAgentSessionId(sessionId);
    setRequestedIssue(null);
    setActiveActivity("agents");
    setIsGlobalSettingsOpen(false);
  }, []);
  const openIssue = useCallback((request: IssueOpenRequest) => {
    setRequestedIssue(request);
    setActiveActivity("issues");
    setIsGlobalSettingsOpen(false);
  }, []);

  useEffect(() => {
    if (openAgentSessionRequest?.projectId !== project.id) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      openAgentSession(openAgentSessionRequest.sessionId);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [openAgentSession, openAgentSessionRequest, project.id]);

  const handleProjectTerminalsStateChange = useCallback(
    (nextState: React.SetStateAction<ProjectTerminalsActivityState>) => {
      setProjectTerminalsStateByProjectId((currentStateByProjectId) => {
        const currentState =
          currentStateByProjectId[project.id] ??
          getDefaultProjectTerminalsActivityState();

        return {
          ...currentStateByProjectId,
          [project.id]:
            typeof nextState === "function"
              ? nextState(currentState)
              : nextState,
        };
      });
    },
    [project.id],
  );

  async function handleWorkbenchHeaderDoubleClick(
    event: React.MouseEvent<HTMLElement>,
  ) {
    if (
      event.target instanceof Element &&
      event.target.closest(".project-switcher")
    ) {
      return;
    }

    const currentWindow = getCurrentWindow();

    if (await currentWindow.isMaximized()) {
      await currentWindow.unmaximize();
      return;
    }

    await currentWindow.maximize();
  }

  return (
    <div className="app-shell">
      <nav className="activity-bar" aria-label={messages.app.activityBarLabel}>
        <div className="activity-bar__activities">
          {ACTIVITIES.map(({ key, Icon }) => {
            const label =
              key === "issues"
                ? messages.app.issues
                : key === "agents"
                  ? messages.app.agents
                  : key === "code"
                    ? messages.agentsFeature.codeTab
                    : key === "terminals"
                      ? messages.app.terminals
                      : messages.app.settings;
            const ariaLabel =
              key === "settings" ? messages.app.projectSettings : label;

            return (
              <button
                className="activity-bar__button"
                type="button"
                key={key}
                aria-label={ariaLabel}
                aria-pressed={!isGlobalSettingsOpen && activeActivity === key}
                onClick={() => {
                  if (
                    key === "issues" &&
                    activeActivity === "issues" &&
                    !isGlobalSettingsOpen
                  ) {
                    setIssuesReturnSignal((value) => value + 1);
                    return;
                  }
                  setActiveActivity(key);
                  setIsGlobalSettingsOpen(false);
                }}
              >
                <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              </button>
            );
          })}
        </div>
        <button
          className="activity-bar__button activity-bar__button--icon-only"
          type="button"
          aria-label={messages.app.globalSettings}
          aria-pressed={isGlobalSettingsOpen}
          onClick={() => {
            setIsGlobalSettingsOpen(true);
          }}
        >
          <UserRoundCog aria-hidden="true" size={18} strokeWidth={1.8} />
        </button>
      </nav>
      <section
        className="workbench"
        aria-label={messages.app.workbench(project.name)}
      >
        <header
          className="workbench__header"
          data-tauri-drag-region
          onDoubleClick={(event) => {
            void handleWorkbenchHeaderDoubleClick(event);
          }}
        >
          <ProjectSwitcher
            currentProject={project}
            onCreateProject={onCreateProject}
            projects={projects}
            onProjectsRefresh={onProjectsRefresh}
          />
        </header>
        <div className="workbench__content">
          {isGlobalSettingsOpen ? (
            <GlobalSettingsActivity />
          ) : (
            <ActivityRouter
              activeActivity={activeActivity}
              activeAgentSessionId={activeAgentSessionId}
              issuesReturnSignal={issuesReturnSignal}
              onOpenAgentsActivity={(sessionId) => {
                openAgentSession(sessionId);
              }}
              onOpenIssue={openIssue}
              onOpenProjectSettingsAgents={() => {
                setActiveProjectSettingsMenu("agents");
                setActiveActivity("settings");
                setIsGlobalSettingsOpen(false);
              }}
              onOpenProjectSettingsLabels={() => {
                setActiveProjectSettingsMenu("labels");
                setActiveActivity("settings");
                setIsGlobalSettingsOpen(false);
              }}
              onProjectSettingsMenuChange={setActiveProjectSettingsMenu}
              onProjectUpdated={onProjectUpdated}
              onProjectTerminalsStateChange={handleProjectTerminalsStateChange}
              onSelectAgentSession={setActiveAgentSessionId}
              activeProjectSettingsMenu={activeProjectSettingsMenu}
              projectWorktreeSetupCommand={project.worktreeSetupCommand}
              projectId={project.id}
              projectName={project.name}
              projectPath={project.path}
              projectWorktreeLocation={project.worktreeLocation}
              projectTerminalsState={projectTerminalsState}
              requestedIssue={requestedIssue}
            />
          )}
        </div>
      </section>
    </div>
  );
}
