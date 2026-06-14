import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { Bot, Info, Plus } from "lucide-react";

import { Button } from "../../components/ui/button";
import {
  deleteAgentProfile,
  listAgentProfiles,
  type AgentProfileRecord,
} from "./settings-commands";
import { AgentProfileForm } from "./agent-profile-form";
import { toCommandError } from "../../shared/commands/command-error";
import { getSettingsMessages } from "../../shared/i18n/settings-messages";
import {
  type ProjectCompletionPolicy,
  type UpdateProjectSettingsInput,
  updateProjectSettings,
} from "../project/project-commands";
import type { ProjectSummary } from "../../app/app";
import {
  formatAgentTypeLabel,
  getAgentLogoSrc,
} from "../agents/agent-visuals";

type SettingsMenu = "general" | "agents";

interface AddFormState {
  projectId: number;
}

interface EditingProfileState {
  contextProjectId: number;
  profile: AgentProfileRecord;
}

const SETTINGS_MENU_DEFAULT_WIDTH = 180;
const SETTINGS_MENU_MIN_WIDTH = 180;
const SETTINGS_MENU_MAX_WIDTH = 420;
const SETTINGS_MENU_STEP = 16;

const SETTINGS_MENU_ITEMS: {
  iconTestId: string;
  key: SettingsMenu;
  label: string;
  MenuIcon: typeof Info;
}[] = [
  {
    iconTestId: "settings-menu-icon-general",
    key: "general",
    label: "General",
    MenuIcon: Info,
  },
  {
    iconTestId: "settings-menu-icon-agents",
    key: "agents",
    label: "Agents",
    MenuIcon: Bot,
  },
];

const settingsMessages = getSettingsMessages();

interface ProjectSettingsActivityProps {
  completionPolicy: ProjectCompletionPolicy;
  onProjectUpdated?: (project: ProjectSummary) => void;
  projectId: number;
  projectName: string;
}

interface GeneralSettingsFormProps {
  completionPolicy: ProjectCompletionPolicy;
  onSave: (
    input: Pick<UpdateProjectSettingsInput, "name" | "completionPolicy">,
  ) => Promise<void>;
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
  const [addForm, setAddForm] = useState<AddFormState | null>(null);
  const [editingProfile, setEditingProfile] =
    useState<EditingProfileState | null>(null);
  const [deletingProfileId, setDeletingProfileId] = useState<number | null>(
    null,
  );
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
  const currentProfiles = [
    ...currentProjectProfiles,
    ...currentGlobalProfiles,
  ].sort((left, right) => left.id - right.id);
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
    setProjectProfiles((current) => {
      const remaining = removeProfile(current, savedProfile.id);
      if (savedProfile.scope !== "project") return remaining;
      return mergeProfile(remaining, savedProfile);
    });
    setGlobalProfiles((current) => {
      const remaining = removeProfile(current, savedProfile.id);
      if (savedProfile.scope !== "global") return remaining;
      return mergeProfile(remaining, savedProfile);
    });
    setAddForm(null);
    setEditingProfile(null);
  }

  async function handleGeneralSettingsSave(
    input: Pick<UpdateProjectSettingsInput, "name" | "completionPolicy">,
  ) {
    const updatedProject = await updateProjectSettings({
      projectId,
      name: input.name,
      completionPolicy: input.completionPolicy,
    });
    onProjectUpdated?.({
      id: updatedProject.id,
      name: updatedProject.name,
      path: updatedProject.repoPath,
      completionPolicy: updatedProject.completionPolicy,
      recentOpenedAt: `Opened ${new Date(updatedProject.lastOpenedAt).toLocaleString()}`,
      status: "available",
    });
  }

  async function handleDeleteProfile(profile: AgentProfileRecord) {
    const isConfirmed = window.confirm(
      settingsMessages.deleteAgentProfileConfirm(profile.name),
    );
    if (!isConfirmed) {
      return;
    }

    setErrorMessage(null);
    setDeletingProfileId(profile.id);

    try {
      await deleteAgentProfile({ id: profile.id });
      setProjectProfiles((current) => removeProfile(current, profile.id));
      setGlobalProfiles((current) => removeProfile(current, profile.id));
      setEditingProfile((current) =>
        current?.profile.id === profile.id ? null : current,
      );
    } catch (error: unknown) {
      setErrorMessage(toCommandError(error).message);
    } finally {
      setDeletingProfileId(null);
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
            const Icon = item.MenuIcon;
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

        <div className={`settings-content settings-content--${activeMenu}`}>
          <SettingsContentFrame
            item={activeMenuItem}
            headerAction={
              activeMenu === "agents" ? (
                <Button
                  className="settings-section__header-action"
                  variant="secondary"
                  type="button"
                  aria-label="New agent"
                  onClick={() => {
                    setAddForm({ projectId });
                    setEditingProfile(null);
                  }}
                >
                  <Plus aria-hidden="true" size={14} strokeWidth={2} />
                  <span>New agent</span>
                </Button>
              ) : null
            }
          >
            {activeMenu === "general" ? (
              <GeneralSettingsForm
                key={`${projectId}:${projectName}:${completionPolicy}`}
                completionPolicy={completionPolicy}
                onSave={handleGeneralSettingsSave}
                projectName={projectName}
              />
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

                {currentLoadState === "loading" ? (
                  <p className="settings-agent-section__loading">Loading...</p>
                ) : currentProfiles.length === 0 ? (
                  <div className="settings-agent-table-empty">
                    <p>No agents</p>
                  </div>
                ) : (
                  <div className="settings-agent-table-scroll">
                    <table
                      className="settings-agent-table"
                      aria-label="Configured agents"
                    >
                      <thead>
                        <tr>
                          <th scope="col">Type</th>
                          <th scope="col">Name</th>
                          <th scope="col">Command</th>
                          <th scope="col">Scope</th>
                          <th scope="col">Workflow Skill</th>
                          <th scope="col">
                            {settingsMessages.agentActionsColumn}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentProfiles.map((profile) => {
                          const agentLabel = formatAgentTypeLabel(
                            profile.agentType,
                          );

                          return (
                            <tr
                              key={profile.id}
                              className="settings-agent-table__row"
                            >
                              <td>
                                <img
                                  alt={`Agent 类型：${agentLabel}`}
                                  className="settings-agent-table__logo"
                                  src={getAgentLogoSrc(profile.agentType)}
                                />
                              </td>
                              <td>
                                <button
                                  className="settings-agent-table__name-button"
                                  type="button"
                                  aria-label={`Edit ${profile.name}`}
                                  onClick={() => {
                                    setEditingProfile({
                                      contextProjectId: projectId,
                                      profile,
                                    });
                                    setAddForm(null);
                                  }}
                                >
                                  {profile.name}
                                </button>
                              </td>
                              <td className="settings-agent-table__command">
                                {formatCommandName(profile.command)}
                              </td>
                              <td>
                                {profile.scope === "global"
                                  ? "Global"
                                  : "Project"}
                              </td>
                              <td className="settings-agent-table__skill">
                                {profile.defaultSkill.trim().length > 0
                                  ? profile.defaultSkill
                                  : "—"}
                              </td>
                              <td>
                                <div className="settings-agent-table__actions">
                                  <button
                                    aria-label={`${settingsMessages.deleteAgentProfile} ${profile.name}`}
                                    className="settings-agent-table__delete-link"
                                    disabled={deletingProfileId === profile.id}
                                    type="button"
                                    onClick={() => {
                                      void handleDeleteProfile(profile);
                                    }}
                                  >
                                    {settingsMessages.deleteAgentProfile}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {currentAddForm ? (
                  <AgentProfileForm
                    key={`create-${currentAddForm.projectId}`}
                    mode="create"
                    scope="global"
                    projectId={currentAddForm.projectId}
                    onCancel={() => setAddForm(null)}
                    onSaved={handleProfileSaved}
                  />
                ) : null}

                {currentEditingProfile ? (
                  <AgentProfileForm
                    key={`edit-${currentEditingProfile.profile.id}`}
                    mode="edit"
                    scope={currentEditingProfile.profile.scope}
                    projectId={projectId}
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
  headerAction,
  item,
}: {
  children: ReactNode;
  headerAction?: ReactNode;
  item: (typeof SETTINGS_MENU_ITEMS)[number];
}) {
  return (
    <section
      className={`settings-section settings-section--${item.key}`}
      aria-label={item.label}
    >
      <div className="settings-section__header">
        <h3>{item.label}</h3>
        {headerAction}
      </div>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

function GeneralSettingsForm({
  completionPolicy,
  onSave,
  projectName,
}: GeneralSettingsFormProps) {
  const [projectNameValue, setProjectNameValue] = useState(projectName);
  const [completionPolicyValue, setCompletionPolicyValue] =
    useState<ProjectCompletionPolicy>(completionPolicy);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const trimmedProjectName = projectNameValue.trim();
  const isDirty =
    trimmedProjectName !== projectName ||
    completionPolicyValue !== completionPolicy;
  const isSaveDisabled =
    isSaving || trimmedProjectName.length === 0 || !isDirty;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaveDisabled) {
      return;
    }

    setErrorMessage(null);
    setIsSaving(true);

    try {
      await onSave({
        name: trimmedProjectName,
        completionPolicy: completionPolicyValue,
      });
    } catch (error: unknown) {
      setErrorMessage(toCommandError(error).message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      className="settings-card settings-general-card"
      onSubmit={handleSubmit}
    >
      <label className="settings-field">
        <span>Project Name</span>
        <input
          aria-label="Project Name"
          className="settings-input settings-input--form-control"
          disabled={isSaving}
          value={projectNameValue}
          onChange={(event) => setProjectNameValue(event.target.value)}
        />
      </label>
      <label className="settings-field">
        <span>Git completion strategy</span>
        <select
          aria-label="Git completion strategy"
          className="settings-input settings-input--form-control"
          disabled={isSaving}
          value={completionPolicyValue}
          onChange={(event) =>
            setCompletionPolicyValue(
              event.target.value as ProjectCompletionPolicy,
            )
          }
        >
          <option value="agent_auto_commit">Auto Commit</option>
          <option value="manual">Manual</option>
        </select>
      </label>
      {errorMessage ? (
        <p
          className="settings-status"
          role="status"
          aria-label="General settings status"
        >
          {errorMessage}
        </p>
      ) : null}
      <div className="settings-form__actions-row settings-form__actions-row--footer">
        <Button
          className="settings-save-button"
          disabled={isSaveDisabled}
          type="submit"
        >
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}

function mergeProfile(
  currentProfiles: AgentProfileRecord[],
  savedProfile: AgentProfileRecord,
): AgentProfileRecord[] {
  const remaining = removeProfile(currentProfiles, savedProfile.id);
  return [...remaining, savedProfile].sort((left, right) => left.id - right.id);
}

function removeProfile(
  currentProfiles: AgentProfileRecord[],
  profileId: number,
): AgentProfileRecord[] {
  return currentProfiles.filter((profile) => profile.id !== profileId);
}

function formatCommandName(command: string): string {
  const trimmedCommand = command.trim();
  if (trimmedCommand.length === 0) return "—";

  const normalizedCommand = trimmedCommand.replace(/\\/g, "/");
  const commandParts = normalizedCommand.split("/").filter(Boolean);
  return commandParts[commandParts.length - 1] ?? trimmedCommand;
}

function clampSettingsMenuWidth(width: number) {
  return Math.min(
    SETTINGS_MENU_MAX_WIDTH,
    Math.max(SETTINGS_MENU_MIN_WIDTH, width),
  );
}
