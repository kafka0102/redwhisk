import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

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
  const [isSavingCompletionPolicy, setIsSavingCompletionPolicy] =
    useState(false);
  const [addFormScope, setAddFormScope] = useState<AgentScope | null>(null);
  const [editingProfile, setEditingProfile] =
    useState<AgentProfileRecord | null>(null);

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
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setErrorMessage(toCommandError(error).message);
        setLoadState("error");
      });

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  function handleProfileSaved(savedProfile: AgentProfileRecord) {
    if (savedProfile.scope === "project") {
      setProjectProfiles((current) => mergeProfile(current, savedProfile));
    } else {
      setGlobalProfiles((current) => mergeProfile(current, savedProfile));
    }
    setAddFormScope(null);
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
    <main className="activity-surface activity-surface--settings">
      <div className="settings-layout">
        <nav className="settings-menu" aria-label="Settings menu">
          <button
            className="settings-menu__item"
            type="button"
            aria-pressed={activeMenu === "general"}
            onClick={() => setActiveMenu("general")}
          >
            General
          </button>
          <button
            className="settings-menu__item"
            type="button"
            aria-pressed={activeMenu === "agents"}
            onClick={() => setActiveMenu("agents")}
          >
            Agents
          </button>
        </nav>

        <div className="settings-content">
          {activeMenu === "general" ? (
            <section className="settings-section" aria-label="General">
              <div className="settings-section__header">
                <h3>General</h3>
              </div>
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
            </section>
          ) : null}

          {activeMenu === "agents" ? (
            <>
              {errorMessage ? (
                <p
                  className="settings-status"
                  role="status"
                  aria-label="Settings status"
                >
                  {errorMessage}
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
                      setAddFormScope("project");
                      setEditingProfile(null);
                    }}
                  >
                    <Plus size={14} strokeWidth={2} />
                  </button>
                </div>
                {loadState === "loading" ? (
                  <p className="settings-agent-section__loading">Loading...</p>
                ) : projectProfiles.length === 0 ? (
                  <div className="settings-agent-list settings-agent-list--empty">
                    <p>No agents</p>
                  </div>
                ) : (
                  <div className="settings-agent-list">
                    {projectProfiles.map((profile) => (
                      <button
                        key={profile.id}
                        className="settings-agent-row"
                        type="button"
                        onClick={() => {
                          setEditingProfile(profile);
                          setAddFormScope(null);
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
                      setAddFormScope("global");
                      setEditingProfile(null);
                    }}
                  >
                    <Plus size={14} strokeWidth={2} />
                  </button>
                </div>
                {loadState === "loading" ? (
                  <p className="settings-agent-section__loading">Loading...</p>
                ) : globalProfiles.length === 0 ? (
                  <div className="settings-agent-list settings-agent-list--empty">
                    <p>No agents</p>
                  </div>
                ) : (
                  <div className="settings-agent-list">
                    {globalProfiles.map((profile) => (
                      <button
                        key={profile.id}
                        className="settings-agent-row"
                        type="button"
                        onClick={() => {
                          setEditingProfile(profile);
                          setAddFormScope(null);
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

              {addFormScope ? (
                <AgentProfileForm
                  key={`create-${addFormScope}`}
                  mode="create"
                  scope={addFormScope}
                  projectId={addFormScope === "project" ? projectId : null}
                  onCancel={() => setAddFormScope(null)}
                  onSaved={handleProfileSaved}
                />
              ) : null}

              {editingProfile ? (
                <AgentProfileForm
                  key={`edit-${editingProfile.id}`}
                  mode="edit"
                  scope={editingProfile.scope}
                  projectId={editingProfile.projectId}
                  profile={editingProfile}
                  onCancel={() => setEditingProfile(null)}
                  onSaved={handleProfileSaved}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </main>
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
