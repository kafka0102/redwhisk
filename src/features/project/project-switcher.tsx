import { Check, ChevronDown, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { ProjectSummary } from "../../app/app";
import { openProjectWindow } from "./project-commands";
import { toCommandError } from "../../shared/commands/command-error";

interface ProjectSwitcherProps {
  currentProject: ProjectSummary;
  onCreateProject: () => void;
  projects: ProjectSummary[];
  onProjectsRefresh: () => Promise<void>;
}

const ICON_COLORS = [
  "var(--color-accent)",
  "#2563eb",
  "#16a34a",
  "#7c3aed",
  "#475569",
  "#65a30d",
];

export function ProjectSwitcher({
  currentProject,
  onCreateProject,
  onProjectsRefresh,
  projects,
}: ProjectSwitcherProps) {
  const popoverId = useId();
  const switcherRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    onProjectsRefresh().catch((refreshError: unknown) => {
      setError(toCommandError(refreshError).message);
    });
  }, [isOpen, onProjectsRefresh]);

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
      setError(toCommandError(openError).message);
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
        aria-label={`Current project ${currentProject.name}`}
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
          aria-label="Project Switcher"
        >
          <div className="project-switcher__actions">
            <button
              className="project-switcher__create"
              role="menuitem"
              type="button"
              onClick={handleCreateProject}
            >
              <span className="project-switcher__create-icon" aria-hidden="true">
                <Plus size={15} strokeWidth={2} />
              </span>
              <span>创建项目</span>
            </button>
          </div>
          <div className="project-switcher__list">
            {projects.map((project) => (
              <button
                className="project-switcher__item"
                key={project.id}
                data-current={project.id === currentProject.id}
                role="menuitem"
                type="button"
                title={project.path}
                onClick={() => void handleProjectSelect(project)}
              >
                <span
                  className="project-switcher__icon"
                  style={{ background: projectIconColor(project) }}
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
                      path unavailable
                    </span>
                  ) : null}
                </span>
                {project.id === currentProject.id ? (
                  <Check
                    aria-label="Current project"
                    className="project-switcher__check"
                    size={18}
                    strokeWidth={1.8}
                  />
                ) : null}
              </button>
            ))}
          </div>
          {error ? (
            <p
              className="project-switcher__error"
              role="status"
              aria-label="Project switcher status"
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

function projectIconColor(project: ProjectSummary): string {
  const source = project.id > 0 ? String(project.id) : project.name;
  let hash = 0;

  for (const character of source) {
    hash = (hash + character.charCodeAt(0)) % ICON_COLORS.length;
  }

  return ICON_COLORS[hash];
}
