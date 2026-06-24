import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Bot, Info, Tag } from "lucide-react";

import { Button } from "../../components/ui/button";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import {
  deleteAgentProfile,
  deleteProjectLabel,
  listAgentProfiles,
  listProjectLabels,
  type AgentProfileRecord,
  type ProjectLabelRecord,
} from "./settings-commands";
import { toCommandError } from "../../shared/commands/command-error";
import type {
  ProjectCompletionPolicy,
  ProjectWorktreeLocation,
} from "../project/project-commands";
import type { ProjectSummary } from "../../app/app";
import { useI18n } from "../../shared/i18n/i18n";
import type { I18nMessages } from "../../shared/i18n/messages";
import { toast } from "../../shared/toast";
import {
  DEFAULT_ACTIVITY_SIDEBAR_WIDTH,
  SIDEBAR_RESIZE_STEP,
} from "../../shared/layout/sidebar-width";
import { GeneralSettingsPanel } from "./settings-general-panel";
import { AgentsSettingsPanel } from "./settings-agents-panel";
import { LabelsSettingsPanel } from "./settings-labels-panel";

export type SettingsMenu = "general" | "agents" | "labels";

interface AddFormState {
  projectId: number;
}

interface EditingProfileState {
  contextProjectId: number;
  profile: AgentProfileRecord;
}

interface AddLabelFormState {
  projectId: number;
}

interface EditingLabelState {
  contextProjectId: number;
  label: ProjectLabelRecord;
}

const SETTINGS_MENU_DEFAULT_WIDTH = DEFAULT_ACTIVITY_SIDEBAR_WIDTH;
const SETTINGS_MENU_MIN_WIDTH = 180;
const SETTINGS_MENU_MAX_WIDTH = 420;

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
    iconTestId: "settings-menu-icon-labels",
    key: "labels",
    MenuIcon: Tag,
  },
];

interface ProjectSettingsActivityProps {
  activeMenu?: SettingsMenu;
  completionPolicy: ProjectCompletionPolicy;
  onMenuChange?: (menu: SettingsMenu) => void;
  onProjectUpdated?: (project: ProjectSummary) => void;
  projectId: number;
  projectName: string;
  projectPath?: string;
  worktreeLocation?: ProjectWorktreeLocation;
  worktreeSetupCommand?: string;
}

export function ProjectSettingsActivity({
  activeMenu: requestedMenu = "general",
  completionPolicy,
  onMenuChange,
  onProjectUpdated,
  projectId,
  projectName,
  projectPath = "",
  worktreeLocation = "repo_sibling",
  worktreeSetupCommand = "",
}: ProjectSettingsActivityProps) {
  const { messages } = useI18n();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [internalActiveMenu, setInternalActiveMenu] =
    useState<SettingsMenu>(requestedMenu);
  const [settingsMenuWidth, setSettingsMenuWidth] = useState(
    SETTINGS_MENU_DEFAULT_WIDTH,
  );
  const [projectProfiles, setProjectProfiles] = useState<AgentProfileRecord[]>(
    [],
  );
  const [globalProfiles, setGlobalProfiles] = useState<AgentProfileRecord[]>(
    [],
  );
  const [projectLabels, setProjectLabels] = useState<ProjectLabelRecord[]>([]);
  const [globalLabels, setGlobalLabels] = useState<ProjectLabelRecord[]>([]);
  const [profilesErrorMessage, setProfilesErrorMessage] = useState<
    string | null
  >(null);
  const [labelsErrorMessage, setLabelsErrorMessage] = useState<string | null>(
    null,
  );
  const [profilesLoadState, setProfilesLoadState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [labelsLoadState, setLabelsLoadState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [profilesProjectId, setProfilesProjectId] = useState(projectId);
  const [labelsProjectId, setLabelsProjectId] = useState(projectId);
  const [addForm, setAddForm] = useState<AddFormState | null>(null);
  const [editingProfile, setEditingProfile] =
    useState<EditingProfileState | null>(null);
  const [deletingProfileId, setDeletingProfileId] = useState<number | null>(
    null,
  );
  const [addLabelForm, setAddLabelForm] = useState<AddLabelFormState | null>(
    null,
  );
  const [editingLabel, setEditingLabel] = useState<EditingLabelState | null>(
    null,
  );
  const [deletingLabelId, setDeletingLabelId] = useState<number | null>(null);
  const dragStateRef = useRef<{
    startWidth: number;
    startX: number;
  } | null>(null);
  const activeMenu = onMenuChange ? requestedMenu : internalActiveMenu;

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
  const currentProfilesErrorMessage = isProfilesCurrent
    ? profilesErrorMessage
    : null;
  const currentProfilesLoadState = isProfilesCurrent
    ? profilesLoadState
    : "loading";
  const currentAddForm = addForm?.projectId === projectId ? addForm : null;
  const currentEditingProfile =
    editingProfile?.contextProjectId === projectId ? editingProfile : null;
  const isLabelsCurrent = labelsProjectId === projectId;
  const currentProjectLabels = isLabelsCurrent ? projectLabels : [];
  const currentGlobalLabels = isLabelsCurrent ? globalLabels : [];
  const currentLabels = [...currentProjectLabels, ...currentGlobalLabels].sort(
    (left, right) => left.id - right.id,
  );
  const currentLabelsErrorMessage = isLabelsCurrent ? labelsErrorMessage : null;
  const currentLabelsLoadState = isLabelsCurrent ? labelsLoadState : "loading";
  const currentAddLabelForm =
    addLabelForm?.projectId === projectId ? addLabelForm : null;
  const currentEditingLabel =
    editingLabel?.contextProjectId === projectId ? editingLabel : null;

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
        setProfilesErrorMessage(null);
        setProfilesProjectId(projectId);
        setProfilesLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setProjectProfiles([]);
        setGlobalProfiles([]);
        setProfilesErrorMessage(toCommandError(error).message);
        setProfilesProjectId(projectId);
        setProfilesLoadState("error");
      });

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    let isMounted = true;

    void Promise.all([
      listProjectLabels({ scope: "project", projectId }),
      listProjectLabels({ scope: "global", projectId: null }),
    ])
      .then(([projectResponse, globalResponse]) => {
        if (!isMounted) return;
        setProjectLabels(projectResponse.labels);
        setGlobalLabels(globalResponse.labels);
        setLabelsErrorMessage(null);
        setLabelsProjectId(projectId);
        setLabelsLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setProjectLabels([]);
        setGlobalLabels([]);
        setLabelsErrorMessage(toCommandError(error).message);
        setLabelsProjectId(projectId);
        setLabelsLoadState("error");
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

  function handleLabelSaved(savedLabel: ProjectLabelRecord) {
    setProjectLabels((current) => {
      const remaining = removeLabel(current, savedLabel.id);
      if (savedLabel.scope !== "project") return remaining;
      return mergeLabel(remaining, savedLabel);
    });
    setGlobalLabels((current) => {
      const remaining = removeLabel(current, savedLabel.id);
      if (savedLabel.scope !== "global") return remaining;
      return mergeLabel(remaining, savedLabel);
    });
    setAddLabelForm(null);
    setEditingLabel(null);
  }

  async function handleDeleteProfile(profile: AgentProfileRecord) {
    const isConfirmed = await confirm({
      message: messages.settings.deleteConfirm(profile.name),
    });
    if (!isConfirmed) {
      return;
    }

    setProfilesErrorMessage(null);
    setDeletingProfileId(profile.id);

    try {
      await deleteAgentProfile({ id: profile.id });
      setProjectProfiles((current) => removeProfile(current, profile.id));
      setGlobalProfiles((current) => removeProfile(current, profile.id));
      setEditingProfile((current) =>
        current?.profile.id === profile.id ? null : current,
      );
      toast.success(messages.toast.deleteSuccess);
    } catch (error: unknown) {
      setProfilesErrorMessage(toCommandError(error).message);
    } finally {
      setDeletingProfileId(null);
    }
  }

  async function handleDeleteLabel(label: ProjectLabelRecord) {
    const isConfirmed = await confirm({
      message: messages.settings.deleteConfirm(label.name),
    });
    if (!isConfirmed) {
      return;
    }

    setLabelsErrorMessage(null);
    setDeletingLabelId(label.id);

    try {
      await deleteProjectLabel({ id: label.id });
      setProjectLabels((current) => removeLabel(current, label.id));
      setGlobalLabels((current) => removeLabel(current, label.id));
      setEditingLabel((current) =>
        current?.label.id === label.id ? null : current,
      );
      toast.success(messages.toast.deleteSuccess);
    } catch (error: unknown) {
      setLabelsErrorMessage(toCommandError(error).message);
    } finally {
      setDeletingLabelId(null);
    }
  }

  function handleAddFormChange(form: AddFormState | null) {
    setAddForm(form);
  }

  function handleEditingProfileChange(state: EditingProfileState | null) {
    setEditingProfile(state);
  }

  function handleAddLabelFormChange(form: AddLabelFormState | null) {
    setAddLabelForm(form);
  }

  function handleEditingLabelChange(state: EditingLabelState | null) {
    setEditingLabel(state);
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
                onClick={() => {
                  if (!onMenuChange) {
                    setInternalActiveMenu(item.key);
                  }
                  onMenuChange?.(item.key);
                }}
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
                clampSettingsMenuWidth(currentWidth - SIDEBAR_RESIZE_STEP),
              );
            }

            if (event.key === "ArrowRight") {
              event.preventDefault();
              setSettingsMenuWidth((currentWidth) =>
                clampSettingsMenuWidth(currentWidth + SIDEBAR_RESIZE_STEP),
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
                  variant="outline"
                  type="button"
                  aria-label={messages.settings.newAgent}
                  onClick={() => {
                    setAddForm({ projectId });
                    setEditingProfile(null);
                  }}
                >
                  <span>{messages.settings.newAgent}</span>
                </Button>
              ) : activeMenu === "labels" ? (
                <Button
                  variant="outline"
                  type="button"
                  aria-label={messages.settings.newLabel}
                  onClick={() => {
                    setAddLabelForm({ projectId });
                    setEditingLabel(null);
                  }}
                >
                  <span>{messages.settings.newLabel}</span>
                </Button>
              ) : null
            }
          >
            {activeMenu === "general" ? (
              <GeneralSettingsPanel
                completionPolicy={completionPolicy}
                projectId={projectId}
                projectName={projectName}
                projectPath={projectPath}
                worktreeLocation={worktreeLocation}
                worktreeSetupCommand={worktreeSetupCommand}
                onProjectUpdated={onProjectUpdated}
              />
            ) : null}

            {activeMenu === "agents" ? (
              <AgentsSettingsPanel
                addForm={currentAddForm}
                deletingProfileId={deletingProfileId}
                editingProfile={currentEditingProfile}
                errorMessage={currentProfilesErrorMessage}
                loadState={currentProfilesLoadState}
                profiles={currentProfiles}
                projectId={projectId}
                onAddFormChange={handleAddFormChange}
                onDeleteProfile={handleDeleteProfile}
                onEditingProfileChange={handleEditingProfileChange}
                onProfileSaved={handleProfileSaved}
              />
            ) : null}

            {activeMenu === "labels" ? (
              <LabelsSettingsPanel
                addForm={currentAddLabelForm}
                deletingLabelId={deletingLabelId}
                editingLabel={currentEditingLabel}
                errorMessage={currentLabelsErrorMessage}
                labels={currentLabels}
                loadState={currentLabelsLoadState}
                profiles={currentProfiles}
                projectId={projectId}
                onAddFormChange={handleAddLabelFormChange}
                onDeleteLabel={handleDeleteLabel}
                onEditingLabelChange={handleEditingLabelChange}
                onLabelSaved={handleLabelSaved}
              />
            ) : null}
          </SettingsContentFrame>
        </div>
      </div>
      {confirmationDialog}
    </main>
  );
}

function SettingsContentFrame({
  children,
  headerAction,
  item,
  label,
}: {
  children: React.ReactNode;
  headerAction?: React.ReactNode;
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
  if (key === "general") return messages.settings.general;
  if (key === "agents") return messages.settings.agents;
  return messages.settings.labels;
}

function mergeLabel(
  currentLabels: ProjectLabelRecord[],
  savedLabel: ProjectLabelRecord,
): ProjectLabelRecord[] {
  const remaining = removeLabel(currentLabels, savedLabel.id);
  return [...remaining, savedLabel].sort((left, right) => left.id - right.id);
}

function removeLabel(
  currentLabels: ProjectLabelRecord[],
  labelId: number,
): ProjectLabelRecord[] {
  return currentLabels.filter((label) => label.id !== labelId);
}
