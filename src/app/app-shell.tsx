import { Bot, CircleDot, Settings, Terminal } from "lucide-react";
import { useCallback, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { ActivityRouter, type ActivityKey } from "./activity-router";
import type { ProjectSummary } from "./app";
import { ProjectSwitcher } from "../features/project/project-switcher";
import { GlobalSettingsActivity } from "../features/settings/global-settings-activity";
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
}

const ACTIVITIES: Array<{
  key: ActivityKey;
  Icon: typeof CircleDot;
}> = [
  { key: "issues", Icon: CircleDot },
  { key: "agents", Icon: Bot },
  { key: "terminals", Icon: Terminal },
  { key: "settings", Icon: Settings },
];

export function AppShell({
  onCreateProject,
  onProjectUpdated,
  onProjectsRefresh,
  project,
  projects,
}: AppShellProps) {
  const { messages } = useI18n();
  const [activeActivity, setActiveActivity] = useState<ActivityKey>("issues");
  const [isGlobalSettingsOpen, setIsGlobalSettingsOpen] = useState(false);
  const [activeAgentSessionId, setActiveAgentSessionId] = useState<
    number | null
  >(null);
  const [projectTerminalsStateByProjectId, setProjectTerminalsStateByProjectId] =
    useState<Record<number, ProjectTerminalsActivityState>>({});
  const [requestedIssueId, setRequestedIssueId] = useState<number | null>(null);
  const projectTerminalsState =
    projectTerminalsStateByProjectId[project.id] ??
    getDefaultProjectTerminalsActivityState();

  const handleProjectTerminalsStateChange = useCallback(
    (nextState: React.SetStateAction<ProjectTerminalsActivityState>) => {
      setProjectTerminalsStateByProjectId((currentStateByProjectId) => {
        const currentState =
          currentStateByProjectId[project.id] ??
          getDefaultProjectTerminalsActivityState();

        return {
          ...currentStateByProjectId,
          [project.id]:
            typeof nextState === "function" ? nextState(currentState) : nextState,
        };
      });
    },
    [project.id],
  );

  async function handleWorkbenchHeaderClick(
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
      return;
    }

    await currentWindow.maximize();
  }

  return (
    <div className="app-shell">
      <nav className="activity-bar" aria-label={messages.app.activityBarLabel}>
        {ACTIVITIES.map(({ key, Icon }) => {
          const label =
            key === "issues"
              ? messages.app.issues
              : key === "agents"
                ? messages.app.agents
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
              aria-pressed={activeActivity === key}
              onClick={() => {
                setActiveActivity(key);
                setIsGlobalSettingsOpen(false);
              }}
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
            </button>
          );
        })}
        <div className="activity-bar__spacer" aria-hidden="true" />
        <button
          className="activity-bar__button activity-bar__button--icon-only"
          type="button"
          aria-label={messages.app.globalSettings}
          aria-pressed={isGlobalSettingsOpen}
          onClick={() => {
            setIsGlobalSettingsOpen(true);
          }}
        >
          <Settings aria-hidden="true" size={18} strokeWidth={1.8} />
        </button>
      </nav>
      <section className="workbench" aria-label={`${project.name} workbench`}>
        <header
          className="workbench__header"
          data-tauri-drag-region
          onClick={(event) => {
            void handleWorkbenchHeaderClick(event);
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
              onOpenAgentsActivity={(sessionId) => {
                setActiveAgentSessionId(sessionId);
                setRequestedIssueId(null);
                setActiveActivity("agents");
                setIsGlobalSettingsOpen(false);
              }}
              onProjectUpdated={onProjectUpdated}
              onProjectTerminalsStateChange={handleProjectTerminalsStateChange}
              onSelectAgentSession={setActiveAgentSessionId}
              projectCompletionPolicy={project.completionPolicy}
              projectId={project.id}
              projectName={project.name}
              projectPath={project.path}
              projectTerminalsState={projectTerminalsState}
              requestedIssueId={requestedIssueId}
            />
          )}
        </div>
      </section>
    </div>
  );
}
