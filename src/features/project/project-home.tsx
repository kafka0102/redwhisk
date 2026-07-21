import { getCurrentWindow } from "@tauri-apps/api/window";

import type { ProjectSummary } from "../../app/app";
import { ProjectList } from "./project-list";

interface ProjectHomeProps {
  isCreatingProject: boolean;
  projects: ProjectSummary[];
  onCreateProject: () => void;
  onProjectOpen: (project: ProjectSummary) => void;
  onOpenInCurrentWindow: (project: ProjectSummary) => Promise<void> | void;
  onProjectsRefresh: () => Promise<void>;
}

export function ProjectHome({
  isCreatingProject,
  onCreateProject,
  onProjectsRefresh,
  projects,
  onOpenInCurrentWindow,
  onProjectOpen,
}: ProjectHomeProps) {
  async function handleWindowHeaderDoubleClick() {
    const currentWindow = getCurrentWindow();

    if (await currentWindow.isMaximized()) {
      await currentWindow.unmaximize();
      return;
    }

    await currentWindow.maximize();
  }

  return (
    <main className="project-home">
      <header
        className="project-home__window-header"
        data-tauri-drag-region
        onDoubleClick={() => {
          void handleWindowHeaderDoubleClick();
        }}
      />
      <ProjectList
        isCreatingProject={isCreatingProject}
        projects={projects}
        onCreateProject={onCreateProject}
        onProjectOpen={onProjectOpen}
        onOpenInCurrentWindow={onOpenInCurrentWindow}
        onProjectsRefresh={onProjectsRefresh}
      />
    </main>
  );
}
