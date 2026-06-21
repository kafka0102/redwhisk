import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { ProjectSummary } from "../../app/app";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

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

function inferHomeDirectory(paths: string[]) {
  for (const path of paths) {
    const unixMatch = path.match(/^(\/Users\/[^/]+|\/home\/[^/]+)(?:\/|$)/);

    if (unixMatch) {
      return unixMatch[1];
    }

    const windowsMatch = path.match(/^([A-Za-z]:\\Users\\[^\\]+)(?:\\|$)/);

    if (windowsMatch) {
      return windowsMatch[1];
    }
  }

  return null;
}

function formatProjectPath(path: string, homeDirectory: string | null) {
  if (!homeDirectory) {
    return path;
  }

  if (path === homeDirectory) {
    return "~";
  }

  if (path.startsWith(`${homeDirectory}/`)) {
    return `~/${path.slice(homeDirectory.length + 1)}`;
  }

  if (path.startsWith(`${homeDirectory}\\`)) {
    return `~\\${path.slice(homeDirectory.length + 1)}`;
  }

  return path;
}

export function ProjectList({
  isCreatingProject,
  onCreateProject,
  onProjectOpen,
  projects,
}: ProjectListProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const homeDirectory = useMemo(
    () => inferHomeDirectory(projects.map((project) => project.path)),
    [projects],
  );
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
    <section className="project-list-shell" aria-label="Projects">
      <div className="project-home__toolbar">
        <div className="project-search">
          <Search aria-hidden="true" size={15} strokeWidth={1.8} />
          <Input
            className="project-search__input"
            type="search"
            aria-label="Search projects"
            placeholder="searching projects"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query.length > 0 ? (
            <button
              className="project-search__clear"
              type="button"
              aria-label="Clear search"
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
          {isCreatingProject ? "Creating Project" : "New Project"}
        </Button>
      </div>
      <ul className="project-list" aria-label="Local projects">
        {visibleProjects.map((project) => (
          <li key={project.id} className="project-list__item">
            <button
              className="project-list__row"
              type="button"
              aria-label={`Open project ${project.name}`}
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
                  {formatProjectPath(project.path, homeDirectory)}
                </span>
                {project.status === "missing" ? (
                  <span className="project-list__meta">path unavailable</span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
