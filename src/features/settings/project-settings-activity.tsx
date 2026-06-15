import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Bot, Info, Plus, Terminal, X } from "lucide-react";

import { Button } from "../../components/ui/button";
import {
  deleteAgentProfile,
  listAgentProfiles,
  type AgentProfileRecord,
} from "./settings-commands";
import { AgentProfileForm } from "./agent-profile-form";
import { toCommandError } from "../../shared/commands/command-error";
import {
  type ProjectCompletionPolicy,
  type UpdateProjectSettingsInput,
  updateProjectSettings,
  validateProjectRepoPath,
} from "../project/project-commands";
import { ProjectDetailsForm } from "../project/project-details-form";
import type { ProjectSummary } from "../../app/app";
import {
  formatAgentTypeLabel,
  getAgentLogoSrc,
} from "../agents/agent-visuals";
import {
  closeProjectTerminal,
  createProjectTerminal,
} from "../terminals/project-terminal-commands";
import { ProjectTerminal } from "../terminals/project-terminal";
import { useI18n } from "../../shared/i18n/i18n";
import type { I18nMessages } from "../../shared/i18n/messages";

type SettingsMenu = "general" | "agents" | "terminals";

interface AddFormState {
  projectId: number;
}

interface EditingProfileState {
  contextProjectId: number;
  profile: AgentProfileRecord;
}

interface ProjectTerminalCardState {
  isExpanded: boolean;
  name: string;
  sessionId: number;
}

const SETTINGS_MENU_DEFAULT_WIDTH = 180;
const SETTINGS_MENU_MIN_WIDTH = 180;
const SETTINGS_MENU_MAX_WIDTH = 420;
const SETTINGS_MENU_STEP = 16;

const SETTINGS_MENU_ITEMS: {
  iconTestId: string;
  key: SettingsMenu;
  MenuIcon: typeof Info;
}[] = [
  {
    iconTestId: "settings-menu-icon-general",
    key: "general",
    MenuIcon: Info,
  },
  {
    iconTestId: "settings-menu-icon-agents",
    key: "agents",
    MenuIcon: Bot,
  },
  {
    iconTestId: "settings-menu-icon-terminals",
    key: "terminals",
    MenuIcon: Terminal,
  },
];

interface ProjectSettingsActivityProps {
  completionPolicy: ProjectCompletionPolicy;
  onProjectUpdated?: (project: ProjectSummary) => void;
  projectId: number;
  projectName: string;
  projectPath?: string;
}

interface GeneralSettingsFormProps {
  completionPolicy: ProjectCompletionPolicy;
  messages: I18nMessages;
  onSave: (
    input: Pick<
      UpdateProjectSettingsInput,
      "name" | "repoPath" | "completionPolicy"
    >,
  ) => Promise<void>;
  projectName: string;
  projectPath: string;
}

export function ProjectSettingsActivity({
  completionPolicy,
  onProjectUpdated,
  projectId,
  projectName,
  projectPath = "",
}: ProjectSettingsActivityProps) {
  const { messages, theme } = useI18n();
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
  const [creatingTerminal, setCreatingTerminal] = useState(false);
  const [terminalCards, setTerminalCards] = useState<ProjectTerminalCardState[]>(
    [],
  );
  const [terminalStatusMessage, setTerminalStatusMessage] = useState<
    string | null
  >(null);
  const [closingTerminalId, setClosingTerminalId] = useState<number | null>(
    null,
  );
  const dragStateRef = useRef<{
    startWidth: number;
    startX: number;
  } | null>(null);

  const activeMenuItem =
    SETTINGS_MENU_ITEMS.find((item) => item.key === activeMenu) ??
    SETTINGS_MENU_ITEMS[0];
  const activeMenuLabel = getSettingsMenuLabel(activeMenuItem.key, messages);
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
    input: Pick<
      UpdateProjectSettingsInput,
      "name" | "repoPath" | "completionPolicy"
    >,
  ) {
    const updatedProject = await updateProjectSettings({
      projectId,
      name: input.name,
      repoPath: input.repoPath,
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
      messages.settings.deleteConfirm(profile.name),
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

  async function handleCreateTerminal() {
    if (creatingTerminal) {
      return;
    }

    setTerminalStatusMessage(null);
    setCreatingTerminal(true);

    try {
      const terminal = await createProjectTerminal({ projectId });
      setTerminalCards((currentCards) => [
        ...currentCards,
        {
          sessionId: terminal.sessionId,
          name: terminal.name,
          isExpanded: true,
        },
      ]);
    } catch (error: unknown) {
      setTerminalStatusMessage(toCommandError(error).message);
    } finally {
      setCreatingTerminal(false);
    }
  }

  async function handleDeleteTerminal(sessionId: number) {
    setTerminalStatusMessage(null);
    setClosingTerminalId(sessionId);

    try {
      await closeProjectTerminal({ projectId, sessionId });
      setTerminalCards((currentCards) =>
        currentCards.filter((card) => card.sessionId !== sessionId),
      );
    } catch (error: unknown) {
      setTerminalStatusMessage(toCommandError(error).message);
    } finally {
      setClosingTerminalId(null);
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
        <nav className="settings-menu" aria-label={messages.settings.menuLabel}>
          {SETTINGS_MENU_ITEMS.map((item) => {
            const Icon = item.MenuIcon;
            const itemLabel = getSettingsMenuLabel(item.key, messages);
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
                <span>{itemLabel}</span>
              </button>
            );
          })}
        </nav>

        <div
          aria-label={messages.settings.splitterLabel}
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
            label={activeMenuLabel}
            headerAction={
              activeMenu === "agents" ? (
                <Button
                  className="settings-section__header-action"
                  variant="secondary"
                  type="button"
                  aria-label={messages.settings.newAgent}
                  onClick={() => {
                    setAddForm({ projectId });
                    setEditingProfile(null);
                  }}
                >
                  <Plus aria-hidden="true" size={14} strokeWidth={2} />
                  <span>{messages.settings.newAgent}</span>
                </Button>
              ) : activeMenu === "terminals" ? (
                <Button
                  className="settings-section__header-action"
                  variant="secondary"
                  size="icon"
                  type="button"
                  aria-label={messages.settings.newTerminal}
                  disabled={creatingTerminal}
                  onClick={() => {
                    void handleCreateTerminal();
                  }}
                >
                  <Plus aria-hidden="true" size={15} strokeWidth={2} />
                </Button>
              ) : null
            }
          >
            {activeMenu === "general" ? (
              <GeneralSettingsForm
                key={`${projectId}:${projectName}:${projectPath}:${completionPolicy}`}
                completionPolicy={completionPolicy}
                messages={messages}
                onSave={handleGeneralSettingsSave}
                projectName={projectName}
                projectPath={projectPath}
              />
            ) : null}

            {activeMenu === "agents" ? (
              <>
                {currentErrorMessage ? (
                  <p
                    className="settings-status"
                    role="status"
                    aria-label={messages.settings.status}
                  >
                    {currentErrorMessage}
                  </p>
                ) : null}

                {currentLoadState === "loading" ? (
                  <p className="settings-agent-section__loading">
                    {messages.settings.loading}
                  </p>
                ) : currentProfiles.length === 0 ? (
                  <div className="settings-agent-table-empty">
                    <p>{messages.settings.noAgents}</p>
                  </div>
                ) : (
                  <div className="settings-agent-table-scroll">
                    <table
                      className="settings-agent-table"
                      aria-label={messages.settings.configuredAgents}
                    >
                      <thead>
                        <tr>
                          <th scope="col">{messages.settings.type}</th>
                          <th scope="col">{messages.settings.name}</th>
                          <th scope="col">{messages.settings.command}</th>
                          <th scope="col">{messages.settings.scope}</th>
                          <th scope="col">{messages.settings.workflowSkill}</th>
                          <th scope="col">
                            {messages.settings.actions}
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
                                  ? messages.settings.globalScope
                                  : messages.settings.projectScope}
                              </td>
                              <td className="settings-agent-table__skill">
                                {profile.defaultSkill.trim().length > 0
                                  ? profile.defaultSkill
                                  : "—"}
                              </td>
                              <td>
                                <div className="settings-agent-table__actions">
                                  <button
                                    aria-label={`${messages.settings.delete} ${profile.name}`}
                                    className="settings-agent-table__delete-link"
                                    disabled={deletingProfileId === profile.id}
                                    type="button"
                                    onClick={() => {
                                      void handleDeleteProfile(profile);
                                    }}
                                  >
                                    {messages.settings.delete}
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

            {activeMenu === "terminals" ? (
              <>
                {terminalStatusMessage ? (
                  <p
                    className="settings-status"
                    role="status"
                    aria-label={messages.settings.status}
                  >
                    {terminalStatusMessage}
                  </p>
                ) : null}

                {terminalCards.length === 0 ? (
                  <div className="settings-agent-table-empty">
                    <p>{messages.settings.noTerminals}</p>
                  </div>
                ) : (
                  <div className="settings-terminals-list">
                    {terminalCards.map((terminalCard) => {
                      const cardPalette = getTerminalCardPalette(
                        theme,
                        terminalCard.sessionId,
                      );

                      return (
                        <section
                          key={terminalCard.sessionId}
                          className="settings-terminal-card"
                          style={
                            {
                              "--settings-terminal-card-background":
                                cardPalette.background,
                              "--settings-terminal-card-border":
                                cardPalette.border,
                              "--settings-terminal-card-icon-background":
                                cardPalette.iconBackground,
                              "--settings-terminal-card-icon-color":
                                cardPalette.iconColor,
                            } as CSSProperties
                          }
                        >
                          <button
                            className="settings-terminal-card__header"
                            type="button"
                            aria-expanded={terminalCard.isExpanded}
                            onClick={() => {
                              setTerminalCards((currentCards) =>
                                currentCards.map((card) =>
                                  card.sessionId === terminalCard.sessionId
                                    ? {
                                        ...card,
                                        isExpanded: !card.isExpanded,
                                      }
                                    : card,
                                ),
                              );
                            }}
                          >
                            <span className="settings-terminal-card__summary">
                              <span
                                className="settings-terminal-card__icon"
                                aria-hidden="true"
                              >
                                <Terminal size={15} strokeWidth={1.9} />
                              </span>
                              <span className="settings-terminal-card__name">
                                {terminalCard.name}
                              </span>
                            </span>
                          </button>
                          <button
                            className="settings-terminal-card__delete"
                            type="button"
                            aria-label={messages.settings.deleteTerminal(
                              terminalCard.name,
                            )}
                            disabled={closingTerminalId === terminalCard.sessionId}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeleteTerminal(terminalCard.sessionId);
                            }}
                          >
                            <X size={14} strokeWidth={2} />
                          </button>

                          {terminalCard.isExpanded ? (
                            <div className="settings-terminal-card__body">
                              <ProjectTerminal
                                projectId={projectId}
                                sessionId={terminalCard.sessionId}
                              />
                            </div>
                          ) : null}
                        </section>
                      );
                    })}
                  </div>
                )}
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
  label,
}: {
  children: ReactNode;
  headerAction?: ReactNode;
  item: (typeof SETTINGS_MENU_ITEMS)[number];
  label: string;
}) {
  return (
    <section
      className={`settings-section settings-section--${item.key}`}
      aria-label={label}
    >
      <div className="settings-section__header">
        <h3>{label}</h3>
        {headerAction}
      </div>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

function GeneralSettingsForm({
  completionPolicy,
  messages,
  onSave,
  projectName,
  projectPath,
}: GeneralSettingsFormProps) {
  const [projectNameValue, setProjectNameValue] = useState(projectName);
  const [projectPathValue, setProjectPathValue] = useState(projectPath);
  const [completionPolicyValue, setCompletionPolicyValue] =
    useState<ProjectCompletionPolicy>(completionPolicy);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChoosingRepoPath, setIsChoosingRepoPath] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const trimmedProjectName = projectNameValue.trim();
  const trimmedProjectPath = projectPathValue.trim();
  const isDirty =
    trimmedProjectName !== projectName ||
    trimmedProjectPath !== projectPath ||
    completionPolicyValue !== completionPolicy;
  const isSaveDisabled =
    isSaving ||
    isChoosingRepoPath ||
    trimmedProjectName.length === 0 ||
    trimmedProjectPath.length === 0 ||
    !isDirty;

  async function handleChooseRepoPath() {
    setErrorMessage(null);
    setIsChoosingRepoPath(true);

    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select Git Repository",
      });

      if (typeof selectedPath !== "string") {
        return;
      }

      const validatedPath = await validateProjectRepoPath({
        repoPath: selectedPath,
      });
      setProjectPathValue(validatedPath.repoPath);
    } catch (error: unknown) {
      setErrorMessage(toCommandError(error).message);
    } finally {
      setIsChoosingRepoPath(false);
    }
  }

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
        repoPath: trimmedProjectPath,
        completionPolicy: completionPolicyValue,
      });
    } catch (error: unknown) {
      setErrorMessage(toCommandError(error).message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ProjectDetailsForm
      ariaStatusLabel={`${messages.settings.general} ${messages.settings.status}`}
      autoCommitLabel={messages.settings.autoCommit}
      chooseFolderLabel={messages.settings.chooseFolder}
      className="settings-card settings-general-card"
      completionPolicy={completionPolicyValue}
      completionStrategyLabel={messages.settings.completionStrategy}
      errorMessage={errorMessage}
      isChoosingRepoPath={isChoosingRepoPath}
      isSubmitting={isSaving}
      onChooseRepoPath={handleChooseRepoPath}
      onCompletionPolicyChange={setCompletionPolicyValue}
      onNameChange={setProjectNameValue}
      onSubmit={handleSubmit}
      projectName={projectNameValue}
      projectNameLabel={messages.settings.projectName}
      repoPath={projectPathValue}
      repoPathLabel={messages.settings.repositoryPath}
      manualLabel={messages.settings.manual}
      submitDisabled={isSaveDisabled}
      submitLabel={messages.settings.save}
      submittingLabel={messages.settings.saving}
    />
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

function getSettingsMenuLabel(
  key: SettingsMenu,
  messages: I18nMessages,
): string {
  if (key === "general") {
    return messages.settings.general;
  }

  if (key === "agents") {
    return messages.settings.agents;
  }

  return messages.settings.terminals;
}

function getTerminalCardPalette(theme: "light" | "dark", seed: number) {
  const lightPalettes = [
    {
      background: "#f7f1e7",
      border: "#dccab0",
      iconBackground: "rgba(120, 82, 38, 0.12)",
      iconColor: "#7a5226",
    },
    {
      background: "#eaf4ee",
      border: "#bfd6c5",
      iconBackground: "rgba(42, 108, 68, 0.12)",
      iconColor: "#2a6c44",
    },
    {
      background: "#edf2fb",
      border: "#c5d1ea",
      iconBackground: "rgba(44, 87, 146, 0.12)",
      iconColor: "#2c5792",
    },
    {
      background: "#f8ecef",
      border: "#e1c2cb",
      iconBackground: "rgba(138, 57, 83, 0.12)",
      iconColor: "#8a3953",
    },
  ];
  const darkPalettes = [
    {
      background: "#2a231b",
      border: "#4d3e2f",
      iconBackground: "rgba(239, 213, 180, 0.12)",
      iconColor: "#efd5b4",
    },
    {
      background: "#1c2923",
      border: "#355443",
      iconBackground: "rgba(191, 225, 206, 0.12)",
      iconColor: "#bfe1ce",
    },
    {
      background: "#1d2430",
      border: "#364660",
      iconBackground: "rgba(198, 215, 243, 0.12)",
      iconColor: "#c6d7f3",
    },
    {
      background: "#2c2026",
      border: "#553746",
      iconBackground: "rgba(239, 204, 216, 0.12)",
      iconColor: "#efccd8",
    },
  ];
  const palettes = theme === "dark" ? darkPalettes : lightPalettes;
  const paletteIndex = Math.abs(seed) % palettes.length;
  return palettes[paletteIndex];
}
