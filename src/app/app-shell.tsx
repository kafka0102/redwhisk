import { Bot, CircleDot, Settings } from "lucide-react";
import { useState } from "react";

import { ActivityRouter, type ActivityKey } from "./activity-router";
import type { ProjectSummary } from "./app";
import { ProjectSwitcher } from "../features/project/project-switcher";
import { GlobalSettingsActivity } from "../features/settings/global-settings-activity";
import { useI18n } from "../shared/i18n/i18n";

interface AppShellProps {
  onProjectUpdated: (project: ProjectSummary) => void;
  project: ProjectSummary;
  projects: ProjectSummary[];
  onProjectsRefresh: () => Promise<void>;
}

const ACTIVITIES: Array<{
  key: ActivityKey;
  label: string;
  Icon: typeof CircleDot;
}> = [
  { key: "issues", label: "Issues", Icon: CircleDot },
  { key: "agents", label: "Agents", Icon: Bot },
  { key: "settings", label: "Settings", Icon: Settings },
];

export function AppShell({
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
  const [requestedIssueId, setRequestedIssueId] = useState<number | null>(null);

  return (
    <div className="app-shell">
      <nav className="activity-bar" aria-label={messages.app.activityBarLabel}>
        {ACTIVITIES.map(({ key, label, Icon }) => (
          <button
            className="activity-bar__button"
            type="button"
            key={key}
            aria-label={key === "settings" ? messages.app.projectSettings : label}
            aria-pressed={activeActivity === key}
            onClick={() => {
              setActiveActivity(key);
              setIsGlobalSettingsOpen(false);
            }}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        ))}
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
        <header className="workbench__header" data-tauri-drag-region>
          <ProjectSwitcher
            currentProject={project}
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
              onOpenIssuesActivity={(issueId) => {
                setRequestedIssueId(issueId);
                setActiveActivity("issues");
                setIsGlobalSettingsOpen(false);
              }}
              onProjectUpdated={onProjectUpdated}
              onSelectAgentSession={setActiveAgentSessionId}
              projectCompletionPolicy={project.completionPolicy}
              projectId={project.id}
              projectName={project.name}
              requestedIssueId={requestedIssueId}
            />
          )}
        </div>
      </section>
    </div>
  );
}
