import { Bot, CircleDot, Settings } from "lucide-react";
import { useState } from "react";

import { ActivityRouter, type ActivityKey } from "./activity-router";
import type { ProjectSummary } from "./app";
import { ProjectSwitcher } from "../features/project/project-switcher";

interface AppShellProps {
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
];

export function AppShell({
  onProjectsRefresh,
  project,
  projects,
}: AppShellProps) {
  const [activeActivity, setActiveActivity] = useState<ActivityKey>("issues");

  return (
    <div className="app-shell">
      <nav className="activity-bar" aria-label="Activity Bar">
        {ACTIVITIES.map(({ key, label, Icon }) => (
          <button
            className="activity-bar__button"
            type="button"
            key={key}
            aria-pressed={activeActivity === key}
            onClick={() => setActiveActivity(key)}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <section className="workbench" aria-label={`${project.name} workbench`}>
        <header className="workbench__header" data-tauri-drag-region>
          <ProjectSwitcher
            currentProject={project}
            projects={projects}
            onProjectsRefresh={onProjectsRefresh}
          />
          <button
            className="workbench__header-settings"
            type="button"
            aria-label="Project Settings"
            aria-pressed={activeActivity === "settings"}
            onClick={() => setActiveActivity("settings")}
          >
            <Settings aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        </header>
        <div className="workbench__content">
          <ActivityRouter
            activeActivity={activeActivity}
            projectId={project.id}
            projectName={project.name}
          />
        </div>
      </section>
    </div>
  );
}
