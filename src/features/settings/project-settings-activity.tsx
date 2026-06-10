import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Bot, Info, Plus } from "lucide-react";

import {
  listAgentProfiles,
  type AgentProfileRecord,
  type AgentScope,
} from "./settings-commands";
import { AgentProfileForm } from "./agent-profile-form";
import { toCommandError } from "../../shared/commands/command-error";
import {
  updateProjectCompletionPolicy,
  type ProjectCompletionPolicy,
} from "../project/project-commands";
import type { ProjectSummary } from "../../app/app";

type SettingsMenu = "general" | "agents";

interface AddFormState {
  projectId: number;
  scope: AgentScope;
}

interface EditingProfileState {
  contextProjectId: number;
  profile: AgentProfileRecord;
}

const SETTINGS_MENU_DEFAULT_WIDTH = 200;
const SETTINGS_MENU_MIN_WIDTH = 200;
const SETTINGS_MENU_MAX_WIDTH = 420;
const SETTINGS_MENU_STEP = 16;

const SETTINGS_MENU_ITEMS: {
  iconTestId: string;
  key: SettingsMenu;
  label: string;
  TitleIcon: typeof Info;
}[] = [
  {
    iconTestId: "settings-menu-icon-general",
    key: "general",
    label: "General",
    TitleIcon: Info,
  },
  {
    iconTestId: "settings-menu-icon-agents",
    key: "agents",
    label: "Agents",
    TitleIcon: Bot,
  },
];

interface ProjectSettingsActivityProps {
  completionPolicy: ProjectCompletionPolicy;
  onProjectUpdated?: (project: ProjectSummary) => void;
  projectId: number;
  projectName: string;
}

export function ProjectSettingsActivity({
  completionPolicy,
  onProjectUpdated,
  projectId,
  projectName,
}: ProjectSettingsActivityProps) {
  const [activeMenu, setActiveMenu] = useState<SettingsMenu>("agents");
  const [settingsMenuWidth, setSettingsMenuWidth] = useState(
    SETTINGS_MENU_DEFAULT_WIDTH,
  );
  const [projectProfiles, setProjectProfiles] = useState<AgentProfileRecord[]>(
    [],
  );
  const [globalProfiles, setGlobalProfiles] = useState<AgentProfileRecord[]>(
    [],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [profilesProjectId, setProfilesProjectId] = useState(projectId);
  const [isSavingCompletionPolicy, setIsSavingCompletionPolicy] =
    useState(false);
  const [addForm, setAddForm] = useState<AddFormState | null>(null);
  const [editingProfile, setEditingProfile] =
    useState<EditingProfileState | null>(null);
  const dragStateRef = useRef<{
    startWidth: number;
    startX: number;
  } | null>(null);

  const activeMenuItem =
    SETTINGS_MENU_ITEMS.find((item) => item.key === activeMenu) ??
    SETTINGS_MENU_ITEMS[0];
  const isProfilesCurrent = profilesProjectId === projectId;
  const currentProjectProfiles = isProfilesCurrent ? projectProfiles : [];
  const currentGlobalProfiles = isProfilesCurrent ? globalProfiles : [];
  const currentErrorMessage = isProfilesCurrent ? errorMessage : null;
  const currentLoadState = isProfilesCurrent ? loadState : "loading";
  const currentAddForm = addForm?.projectId === projectId ? addForm : null;
  const currentEditingProfile =
    editingProfile?.contextProjectId === projectId ? editingProfile : null;

  const clearDragState = useCallback(() => {
    if (!dragStateRef.current) {
      return;
    }

    dragStateRef.current = null;
    window.document.body.style.cursor = "";
    window.document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    let isMounted = true;

    void Promise.all([
      listAgentProfiles({ scope: "project", projectId }),
      listAgentProfiles({ scope: "global", projectId: null }),
    ])
      .then(([projectResponse, globalResponse]) => {
        if (!isMounted) return;
        setProjectProfiles(projectResponse.profiles);
        setGlobalProfiles(globalResponse.profiles);
        setErrorMessage(null);
        setProfilesProjectId(projectId);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setProjectProfiles([]);
        setGlobalProfiles([]);
        setErrorMessage(toCommandError(error).message);
        setProfilesProjectId(projectId);
        setLoadState("error");
      });

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      if (!dragStateRef.current) {
        return;
      }

      const nextWidth =
        dragStateRef.current.startWidth +
        event.clientX -
        dragStateRef.current.startX;
      setSettingsMenuWidth(clampSettingsMenuWidth(nextWidth));
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", clearDragState);
    window.addEventListener("blur", clearDragState);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", clearDragState);
      window.removeEventListener("blur", clearDragState);
      clearDragState();
    };
  }, [clearDragState]);

  function handleProfileSaved(savedProfile: AgentProfileRecord) {
    if (savedProfile.scope === "project") {
      setProjectProfiles((current) => mergeProfile(current, savedProfile));
    } else {
      setGlobalProfiles((current) => mergeProfile(current, savedProfile));
    }
    setAddForm(null);
    setEditingProfile(null);
  }

  async function handleCompletionPolicyChange(
    nextPolicy: ProjectCompletionPolicy,
  ) {
    if (nextPolicy === completionPolicy || isSavingCompletionPolicy) {
      return;
    }

    setErrorMessage(null);
    setIsSavingCompletionPolicy(true);

    try {
      const updatedProject = await updateProjectCompletionPolicy({
        projectId,
        completionPolicy: nextPolicy,
      });
      onProjectUpdated?.({
        id: updatedProject.id,
        name: updatedProject.name,
        path: updatedProject.repoPath,
        completionPolicy: updatedProject.completionPolicy,
        recentOpenedAt: `Opened ${new Date(updatedProject.lastOpenedAt).toLocaleString()}`,
        status: "available",
      });
    } catch (error: unknown) {
      setErrorMessage(toCommandError(error).message);
    } finally {
      setIsSavingCompletionPolicy(false);
    }
  }

  return (
    <main
      className="activity-surface activity-surface--settings"
      style={
        {
          "--settings-menu-width": `${settingsMenuWidth}px`,
        } as CSSProperties
      }
    >
      <div className="settings-layout">
        <nav className="settings-menu" aria-label="Settings menu">
          {SETTINGS_MENU_ITEMS.map((item) => {
            const Icon = item.TitleIcon;
            return (
              <button
                key={item.key}
                className="settings-menu__item"
                type="button"
                aria-pressed={activeMenu === item.key}
                onClick={() => setActiveMenu(item.key)}
              >
                <Icon
                  aria-hidden="true"
                  data-testid={item.iconTestId}
                  size={15}
                  strokeWidth={1.9}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div
          aria-label="Resize settings menu"
          aria-orientation="vertical"
          aria-valuemax={SETTINGS_MENU_MAX_WIDTH}
          aria-valuemin={SETTINGS_MENU_MIN_WIDTH}
          aria-valuenow={settingsMenuWidth}
          className="settings-splitter"
          role="separator"
          tabIndex={0}
          onMouseDown={(event) => {
            if (event.button !== 0) {
              return;
            }

            event.preventDefault();
            dragStateRef.current = {
              startWidth: settingsMenuWidth,
              startX: event.clientX,
            };
            window.document.body.style.cursor = "col-resize";
            window.document.body.style.userSelect = "none";
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setSettingsMenuWidth((currentWidth) =>
                clampSettingsMenuWidth(currentWidth - SETTINGS_MENU_STEP),
              );
            }

            if (event.key === "ArrowRight") {
              event.preventDefault();
              setSettingsMenuWidth((currentWidth) =>
                clampSettingsMenuWidth(currentWidth + SETTINGS_MENU_STEP),
              );
            }

            if (event.key === "Home") {
              event.preventDefault();
              setSettingsMenuWidth(SETTINGS_MENU_MIN_WIDTH);
            }

            if (event.key === "End") {
              event.preventDefault();
              setSettingsMenuWidth(SETTINGS_MENU_MAX_WIDTH);
            }
          }}
        />

        <div className="settings-content">
          <SettingsContentFrame item={activeMenuItem}>
            {activeMenu === "general" ? (
              <>
                <div className="settings-basic-info">
                  <span className="settings-basic-info__label">Project</span>
                  <p>{projectName}</p>
                </div>
                <label className="settings-field">
                  <span>Completion Policy</span>
                  <select
                    aria-label="Completion Policy"
                    className="settings-input"
                    disabled={isSavingCompletionPolicy}
                    value={completionPolicy}
                    onChange={(event) =>
                      void handleCompletionPolicyChange(
                        event.target.value as ProjectCompletionPolicy,
                      )
                    }
                  >
                    <option value="manual">manual</option>
                    <option value="agent_auto_commit">agent_auto_commit</option>
                  </select>
                </label>
              </>
            ) : null}

            {activeMenu === "agents" ? (
              <>
                {currentErrorMessage ? (
                  <p
                    className="settings-status"
                    role="status"
                    aria-label="Settings status"
                  >
                    {currentErrorMessage}
                  </p>
                ) : null}

                <section
                  className="settings-agent-section"
                  aria-label="Project Agents"
                >
                  <div className="settings-agent-section__header">
                    <h3>Project Agents</h3>
                    <button
                      className="settings-agent-section__add"
                      type="button"
                      aria-label="Add project agent"
                      onClick={() => {
                        setAddForm({ projectId, scope: "project" });
                        setEditingProfile(null);
                      }}
                    >
                      <Plus size={14} strokeWidth={2} />
                    </button>
                  </div>
                  {currentLoadState === "loading" ? (
                    <p className="settings-agent-section__loading">
                      Loading...
                    </p>
                  ) : currentProjectProfiles.length === 0 ? (
                    <div className="settings-agent-list settings-agent-list--empty">
                      <p>No agents</p>
                    </div>
                  ) : (
                    <div className="settings-agent-list">
                      {currentProjectProfiles.map((profile) => (
                        <button
                          key={profile.id}
                          className="settings-agent-row"
                          type="button"
                          onClick={() => {
                            setEditingProfile({
                              contextProjectId: projectId,
                              profile,
                            });
                            setAddForm(null);
                          }}
                        >
                          <span className="settings-agent-row__name">
                            {profile.name}
                          </span>
                          <span className="settings-agent-row__command">
                            {profile.command}
                          </span>
                          <span className="settings-agent-row__mode">
                            {profile.mode}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section
                  className="settings-agent-section"
                  aria-label="Global Agents"
                >
                  <div className="settings-agent-section__header">
                    <h3>Global Agents</h3>
                    <button
                      className="settings-agent-section__add"
                      type="button"
                      aria-label="Add global agent"
                      onClick={() => {
                        setAddForm({ projectId, scope: "global" });
                        setEditingProfile(null);
                      }}
                    >
                      <Plus size={14} strokeWidth={2} />
                    </button>
                  </div>
                  {currentLoadState === "loading" ? (
                    <p className="settings-agent-section__loading">
                      Loading...
                    </p>
                  ) : currentGlobalProfiles.length === 0 ? (
                    <div className="settings-agent-list settings-agent-list--empty">
                      <p>No agents</p>
                    </div>
                  ) : (
                    <div className="settings-agent-list">
                      {currentGlobalProfiles.map((profile) => (
                        <button
                          key={profile.id}
                          className="settings-agent-row"
                          type="button"
                          onClick={() => {
                            setEditingProfile({
                              contextProjectId: projectId,
                              profile,
                            });
                            setAddForm(null);
                          }}
                        >
                          <span className="settings-agent-row__name">
                            {profile.name}
                          </span>
                          <span className="settings-agent-row__command">
                            {profile.command}
                          </span>
                          <span className="settings-agent-row__mode">
                            {profile.mode}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                {currentAddForm ? (
                  <AgentProfileForm
                    key={`create-${currentAddForm.projectId}-${currentAddForm.scope}`}
                    mode="create"
                    scope={currentAddForm.scope}
                    projectId={
                      currentAddForm.scope === "project" ? projectId : null
                    }
                    onCancel={() => setAddForm(null)}
                    onSaved={handleProfileSaved}
                  />
                ) : null}

                {currentEditingProfile ? (
                  <AgentProfileForm
                    key={`edit-${currentEditingProfile.profile.id}`}
                    mode="edit"
                    scope={currentEditingProfile.profile.scope}
                    projectId={currentEditingProfile.profile.projectId}
                    profile={currentEditingProfile.profile}
                    onCancel={() => setEditingProfile(null)}
                    onSaved={handleProfileSaved}
                  />
                ) : null}
              </>
            ) : null}
          </SettingsContentFrame>
        </div>
      </div>
    </main>
  );
}

function SettingsContentFrame({
  children,
  item,
}: {
  children: ReactNode;
  item: (typeof SETTINGS_MENU_ITEMS)[number];
}) {
  const Icon = item.TitleIcon;

  return (
    <section className="settings-section" aria-label={item.label}>
      <div className="settings-section__header">
        <h3>
          <Icon
            aria-hidden="true"
            data-testid={`settings-title-icon-${item.key}`}
            size={16}
            strokeWidth={1.9}
          />
          <span>{item.label}</span>
        </h3>
      </div>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

function mergeProfile(
  currentProfiles: AgentProfileRecord[],
  savedProfile: AgentProfileRecord,
): AgentProfileRecord[] {
  const remaining = currentProfiles.filter(
    (profile) => profile.id !== savedProfile.id,
  );
  return [...remaining, savedProfile].sort((left, right) => left.id - right.id);
}

function clampSettingsMenuWidth(width: number) {
  return Math.min(
    SETTINGS_MENU_MAX_WIDTH,
    Math.max(SETTINGS_MENU_MIN_WIDTH, width),
  );
}
