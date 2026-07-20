import { Check, ChevronDown, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { ProjectSummary } from "../../app/app";
import { openProjectWindow } from "./project-commands";
import { getProjectIconColor } from "./project-icon-color";
import { ProjectRemoveMenu } from "./project-remove-menu";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";

interface ProjectSwitcherProps {
  currentProject: ProjectSummary;
  onCreateProject: () => void;
  projects: ProjectSummary[];
  onProjectsRefresh: () => Promise<void>;
}

export function ProjectSwitcher({
  currentProject,
  onCreateProject,
  onProjectsRefresh,
  projects,
}: ProjectSwitcherProps) {
  const { messages, t } = useI18n();
  const popoverId = useId();
  const switcherRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    onProjectsRefresh().catch((refreshError: unknown) => {
      setError(getCommandErrorMessage(refreshError, t));
    });
  }, [isOpen, onProjectsRefresh, t]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        switcherRef.current?.contains(event.target)
      ) {
        return;
      }

      setIsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen]);

  async function handleProjectSelect(project: ProjectSummary) {
    setError(null);

    if (project.id === currentProject.id) {
      setIsOpen(false);
      return;
    }

    try {
      await openProjectWindow({ projectId: project.id });
      setIsOpen(false);
    } catch (openError) {
      setError(getCommandErrorMessage(openError, t));
    }
  }

  function handleCreateProject() {
    setError(null);
    setIsOpen(false);
    onCreateProject();
  }

  return (
    <div className="project-switcher" ref={switcherRef}>
      <button
        className="project-switcher__trigger"
        type="button"
        aria-controls={isOpen ? popoverId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={messages.projectSwitcher.currentProjectWithName(
          currentProject.name,
        )}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="project-switcher__trigger-name">
          {currentProject.name}
        </span>
        <ChevronDown aria-hidden="true" size={16} strokeWidth={1.8} />
      </button>
      {isOpen ? (
        <div
          className="project-switcher__popover"
          id={popoverId}
          role="menu"
          aria-label={messages.projectSwitcher.menu}
        >
          <div className="project-switcher__actions">
            <button
              className="project-switcher__create"
              role="menuitem"
              type="button"
              onClick={handleCreateProject}
            >
              <span
                className="project-switcher__create-icon"
                aria-hidden="true"
              >
                <Plus size={15} strokeWidth={2} />
              </span>
              <span>{messages.projectSwitcher.createProject}</span>
            </button>
          </div>
          <div className="project-switcher__list">
            {projects.map((project) => {
              const isCurrent = project.id === currentProject.id;
              return (
                <div
                  className="project-switcher__item-shell"
                  key={project.id}
                  data-current={isCurrent}
                >
                  <button
                    className="project-switcher__item"
                    data-current={isCurrent}
                    role="menuitem"
                    type="button"
                    title={project.path}
                    onClick={() => void handleProjectSelect(project)}
                  >
                    <span
                      className="project-switcher__icon"
                      style={{ background: getProjectIconColor(project) }}
                      aria-hidden="true"
                    >
                      {projectInitial(project.name)}
                    </span>
                    <span className="project-switcher__item-body">
                      <span className="project-switcher__item-name">
                        {project.name}
                      </span>
                      <span className="project-switcher__item-path">
                        {project.path}
                      </span>
                      {project.status === "missing" ? (
                        <span className="project-switcher__item-status">
                          {messages.projectSwitcher.pathUnavailable}
                        </span>
                      ) : null}
                    </span>
                    {isCurrent ? (
                      <Check
                        aria-label={messages.projectSwitcher.currentProject}
                        className="project-switcher__check"
                        size={18}
                        strokeWidth={1.8}
                      />
                    ) : null}
                  </button>
                  {!isCurrent ? (
                    <ProjectRemoveMenu
                      messagesSource="projectSwitcher"
                      projectId={project.id}
                      onError={setError}
                      onRemoved={async () => {
                        setError(null);
                        await onProjectsRefresh();
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          {error ? (
            <p
              className="project-switcher__error"
              role="status"
              aria-label={messages.projectSwitcher.status}
            >
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function projectInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "P";
}
