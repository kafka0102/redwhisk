import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { AgentProfileForm } from "./agent-profile-form";
import { ProjectAgentOverrideForm } from "./project-agent-override-form";
import {
  listAgentProfiles,
  listProjectAgentOverrides,
  type AgentProfileRecord,
  type ProjectAgentOverrideRecord,
} from "./settings-commands";
import { toCommandError } from "../../shared/commands/command-error";

interface ProjectSettingsActivityProps {
  projectId: number;
  projectName: string;
}

export function ProjectSettingsActivity({
  projectId,
  projectName,
}: ProjectSettingsActivityProps) {
  const [profiles, setProfiles] = useState<AgentProfileRecord[]>([]);
  const [overrides, setOverrides] = useState<ProjectAgentOverrideRecord[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [isGlobalSettingsOpen, setIsGlobalSettingsOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    void Promise.all([
      listAgentProfiles(),
      listProjectAgentOverrides({ projectId }),
    ])
      .then(([profileResponse, overrideResponse]) => {
        if (!isMounted) {
          return;
        }

        setProfiles(profileResponse.profiles);
        setOverrides(overrideResponse.overrides);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        setErrorMessage(toCommandError(error).message);
        setLoadState("error");
      });

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  const editingProfile = useMemo(
    () => profiles.find((profile) => profile.id === editingProfileId) ?? null,
    [editingProfileId, profiles],
  );

  return (
    <main className="activity-surface activity-surface--settings">
      <div className="settings-header">
        <div>
          <h2>Settings</h2>
          <p className="settings-header__lede">
            Current project: <strong>{projectName}</strong>
          </p>
        </div>
        <Button
          className="issues-button"
          type="button"
          variant="outline"
          onClick={() => {
            setIsGlobalSettingsOpen(true);
            setEditorMode(null);
            setEditingProfileId(null);
          }}
        >
          Open Global Settings
        </Button>
      </div>

      {errorMessage ? (
        <p
          className="settings-status"
          role="status"
          aria-label="Settings status"
        >
          {errorMessage}
        </p>
      ) : null}

      <section className="settings-panel" aria-label="Current Project settings">
        <div className="settings-panel__header">
          <div>
            <h3>Current Project</h3>
            <p>
              These overrides only affect <strong>{projectName}</strong>.
            </p>
          </div>
        </div>

        {loadState === "loading" ? (
          <p className="empty-state">Loading settings...</p>
        ) : null}
        {loadState !== "loading" && profiles.length === 0 ? (
          <p className="empty-state">
            Create a global Codex Agent Profile first, then return here to
            override it for this project.
          </p>
        ) : null}

        {loadState !== "loading" ? (
          <div className="settings-grid">
            {profiles.map((profile) => {
              const override =
                overrides.find(
                  (currentOverride) =>
                    currentOverride.agentProfileId === profile.id,
                ) ?? undefined;

              return (
                <ProjectAgentOverrideForm
                  key={overrideFormKey(projectId, profile, override)}
                  override={override}
                  profile={profile}
                  projectId={projectId}
                  onSaved={(savedOverride) =>
                    setOverrides((currentOverrides) =>
                      mergeOverride(currentOverrides, savedOverride),
                    )
                  }
                />
              );
            })}
          </div>
        ) : null}
      </section>

      {isGlobalSettingsOpen ? (
        <div
          className="global-settings-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsGlobalSettingsOpen(false);
            }
          }}
        >
          <div
            aria-label="Global Settings"
            aria-modal="true"
            className="global-settings-dialog"
            role="dialog"
          >
            <div className="global-settings-dialog__header">
              <div>
                <h3>Global Settings</h3>
                <p>
                  Manage reusable Codex Agent Profiles shared across projects.
                </p>
              </div>
              <button
                aria-label="Close global settings"
                className="issue-dialog__close"
                type="button"
                onClick={() => setIsGlobalSettingsOpen(false)}
              >
                x
              </button>
            </div>

            <div className="global-settings-dialog__body">
              <section className="settings-panel settings-panel--global">
                <div className="settings-panel__header">
                  <div>
                    <h4>Global Agent Profiles</h4>
                    <p>
                      Global profiles define the base command and prompt
                      defaults.
                    </p>
                  </div>
                  <Button
                    className="issues-button"
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditorMode("create");
                      setEditingProfileId(null);
                    }}
                  >
                    New Codex Profile
                  </Button>
                </div>

                {profiles.length === 0 ? (
                  <p className="empty-state">No Agent Profiles saved yet.</p>
                ) : (
                  <div
                    className="settings-list"
                    role="list"
                    aria-label="Global Agent Profiles"
                  >
                    {profiles.map((profile) => (
                      <div
                        key={profile.id}
                        className="settings-list__item"
                        role="listitem"
                      >
                        <div>
                          <h5>{profile.name}</h5>
                          <p>{profile.command}</p>
                        </div>
                        <Button
                          className="issues-button"
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setEditorMode("edit");
                            setEditingProfileId(profile.id);
                          }}
                        >
                          Edit
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {editorMode ? (
                <AgentProfileForm
                  key={
                    editorMode === "create"
                      ? "create"
                      : `edit-${editingProfile?.id ?? "missing"}`
                  }
                  mode={editorMode}
                  profile={editingProfile}
                  onCancel={() => {
                    setEditorMode(null);
                    setEditingProfileId(null);
                  }}
                  onSaved={(savedProfile) => {
                    setProfiles((currentProfiles) =>
                      mergeProfile(currentProfiles, savedProfile),
                    );
                    setEditorMode(null);
                    setEditingProfileId(savedProfile.id);
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function mergeProfile(
  currentProfiles: AgentProfileRecord[],
  savedProfile: AgentProfileRecord,
): AgentProfileRecord[] {
  const remainingProfiles = currentProfiles.filter(
    (profile) => profile.id !== savedProfile.id,
  );
  return [...remainingProfiles, savedProfile].sort(
    (left, right) => left.id - right.id,
  );
}

function mergeOverride(
  currentOverrides: ProjectAgentOverrideRecord[],
  savedOverride: ProjectAgentOverrideRecord,
): ProjectAgentOverrideRecord[] {
  const remainingOverrides = currentOverrides.filter(
    (override) => override.id !== savedOverride.id,
  );
  return [...remainingOverrides, savedOverride].sort(
    (left, right) => left.id - right.id,
  );
}

function overrideFormKey(
  projectId: number,
  profile: AgentProfileRecord,
  override: ProjectAgentOverrideRecord | undefined,
): string {
  if (override) {
    return `${projectId}-${profile.id}-override-${override.id}`;
  }

  return [
    projectId,
    profile.id,
    "inherited",
    profile.command,
    profile.defaultArgs.join("\n"),
    profile.defaultSkill,
    profile.promptTemplate,
    profile.enabled ? "enabled" : "disabled",
  ].join("|");
}
