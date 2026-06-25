import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { ProjectSummary } from "../../app/app";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useI18n } from "../../shared/i18n/i18n";
import { formatHomePathForDisplay } from "../../shared/paths/home-path";

interface ProjectListProps {
  isCreatingProject: boolean;
  projects: ProjectSummary[];
  onCreateProject: () => void;
  onProjectOpen: (project: ProjectSummary) => void;
}

const PROJECT_ICON_COLORS = [
  "#2563eb",
  "#16a34a",
  "#7c3aed",
  "#475569",
  "#65a30d",
] as const;

function getProjectInitial(name: string) {
  const trimmedName = name.trim();

  return (trimmedName[0] ?? "?").toLocaleUpperCase();
}

function getProjectColor(project: ProjectSummary) {
  const source = `${project.id}:${project.name}:${project.path}`;
  let hash = 0;

  for (const character of source) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return PROJECT_ICON_COLORS[hash % PROJECT_ICON_COLORS.length];
}

export function ProjectList({
  isCreatingProject,
  onCreateProject,
  onProjectOpen,
  projects,
}: ProjectListProps) {
  const { messages } = useI18n();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProjects = useMemo(
    () =>
      normalizedQuery.length === 0
        ? projects
        : projects.filter((project) =>
            project.name.toLocaleLowerCase().includes(normalizedQuery),
          ),
    [normalizedQuery, projects],
  );

  return (
    <section
      className="project-list-shell"
      aria-label={messages.projectHome.projects}
    >
      <div className="project-home__toolbar">
        <div className="project-search">
          <Search aria-hidden="true" size={15} strokeWidth={1.8} />
          <Input
            className="project-search__input"
            type="search"
            aria-label={messages.projectHome.searchProjects}
            placeholder={messages.projectHome.searchProjectsPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query.length > 0 ? (
            <button
              className="project-search__clear"
              type="button"
              aria-label={messages.projectHome.clearSearch}
              onClick={() => setQuery("")}
            >
              <X aria-hidden="true" size={14} strokeWidth={1.9} />
            </button>
          ) : null}
        </div>
        <Button
          type="button"
          variant={"outline"}
          disabled={isCreatingProject}
          onClick={onCreateProject}
        >
          {isCreatingProject
            ? messages.projectHome.creatingProject
            : messages.projectHome.newProject}
        </Button>
      </div>
      <ul
        className="project-list"
        aria-label={messages.projectHome.localProjects}
      >
        {visibleProjects.map((project) => (
          <li key={project.id} className="project-list__item">
            <button
              className="project-list__row"
              type="button"
              aria-label={messages.projectHome.openProject(project.name)}
              onClick={() => onProjectOpen(project)}
            >
              <span
                className="project-list__icon"
                style={{ backgroundColor: getProjectColor(project) }}
                aria-hidden="true"
              >
                {getProjectInitial(project.name)}
              </span>
              <span className="project-list__body">
                <span className="project-list__name">{project.name}</span>
                <span className="project-list__path">
                  {formatHomePathForDisplay(project.path)}
                </span>
                {project.status === "missing" ? (
                  <span className="project-list__meta">
                    {messages.projectHome.pathUnavailable}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
