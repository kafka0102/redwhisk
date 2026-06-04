import { Bot, CircleDot, Settings } from "lucide-react";
import { useState } from "react";

import { ActivityRouter, type ActivityKey } from "./activity-router";
import type { ProjectSummary } from "./app";

interface AppShellProps {
  project: ProjectSummary;
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

export function AppShell({ project }: AppShellProps) {
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
        <header className="workbench__header">
          <div>
            <p className="eyebrow">Project</p>
            <h1>{project.name}</h1>
          </div>
          <p className="workbench__path">{project.path}</p>
        </header>
        <ActivityRouter activeActivity={activeActivity} project={project} />
      </section>
    </div>
  );
}
