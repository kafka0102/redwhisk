import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import { toCommandError } from "../../shared/commands/command-error";
import {
  listAgentSkills,
  saveProjectLabel,
  type AgentProfileRecord,
  type AgentSkillRecord,
  type ProjectLabelRecord,
  type ProjectLabelScope,
} from "./settings-commands";

const PRESET_COLORS = [
  "#E11D48",
  "#F97316",
  "#F59E0B",
  "#84CC16",
  "#10B981",
  "#06B6D4",
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#EC4899",
];

interface ProjectLabelFormProps {
  label?: ProjectLabelRecord;
  mode: "create" | "edit";
  onCancel: () => void;
  onSaved: (label: ProjectLabelRecord) => void;
  profiles: AgentProfileRecord[];
  projectId: number;
}

export function ProjectLabelForm({
  label,
  mode,
  onCancel,
  onSaved,
  profiles,
  projectId,
}: ProjectLabelFormProps) {
  const { messages } = useI18n();
  const [name, setName] = useState(label?.name ?? "");
  const [scope, setScope] = useState<ProjectLabelScope>(label?.scope ?? "project");
  const [color, setColor] = useState(label?.color ?? PRESET_COLORS[0]);
  const [agentProfileId, setAgentProfileId] = useState<string>(
    label?.agentProfileId ? String(label.agentProfileId) : "none",
  );
  const [workflowSkill, setWorkflowSkill] = useState(label?.workflowSkill ?? "");
  const [skills, setSkills] = useState<AgentSkillRecord[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const selectableProfiles = useMemo(() => {
    return profiles.filter((profile) => {
      if (scope === "global") {
        return profile.scope === "global";
      }
      return profile.scope === "global" || profile.projectId === projectId;
    });
  }, [profiles, projectId, scope]);

  const selectedProfile =
    selectableProfiles.find((profile) => String(profile.id) === agentProfileId) ?? null;
  const hasSelectedAgent = selectedProfile !== null;
  const hasWorkflowSkills = skills.length > 0;

  const loadSkillsForProfile = useCallback(
    async (profile: AgentProfileRecord | null) => {
      if (!profile) {
        setSkills([]);
        setIsLoadingSkills(false);
        return;
      }

      setIsLoadingSkills(true);
      setStatusMessage(null);

      try {
        const response = await listAgentSkills({
          agentType: profile.agentType,
          projectId: profile.scope === "global" ? null : projectId,
        });
        setSkills(response.skills);
        setWorkflowSkill((currentSkill) =>
          response.skills.some((skill) => skill.name === currentSkill) ? currentSkill : "",
        );
      } catch (error: unknown) {
        setSkills([]);
        setWorkflowSkill("");
        setStatusMessage(toCommandError(error).message);
      } finally {
        setIsLoadingSkills(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadSkillsForProfile(selectedProfile);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadSkillsForProfile, selectedProfile]);

  function validateName(nextName: string) {
    const trimmed = nextName.trim();
    if (trimmed.length === 0) {
      return "Label name is required.";
    }
    if (trimmed.length > 15) {
      return "Label name must be 15 characters or fewer.";
    }
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextNameError = validateName(name);
    setNameError(nextNameError);
    if (nextNameError) {
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      const saved = await saveProjectLabel({
        id: label?.id,
        name: name.trim(),
        scope,
        projectId: scope === "project" ? projectId : null,
        color,
        agentProfileId: selectedProfile?.id ?? null,
        workflowSkill:
          hasSelectedAgent && hasWorkflowSkills && workflowSkill.trim().length > 0
            ? workflowSkill
            : null,
      });
      onSaved(saved);
    } catch (error: unknown) {
      setStatusMessage(toCommandError(error).message);
    } finally {
      setIsSaving(false);
    }
  }

  const dialogTitle = mode === "create" ? "New label" : "Edit label";

  return (
    <div
      className="issue-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <form
        className="issue-dialog"
        aria-label={dialogTitle}
        aria-modal="true"
        role="dialog"
        onSubmit={handleSubmit}
      >
        <div className="issue-dialog__header">
          <h3>{dialogTitle}</h3>
          <button
            aria-label="Close"
            className="issue-dialog__close"
            type="button"
            onClick={onCancel}
          >
            &times;
          </button>
        </div>

        <div className="agent-dialog__body">
          <label className="settings-field">
            <span>{messages.settings.name}</span>
            <input
              aria-label="Name"
              className="settings-input"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError !== null) {
                  setNameError(validateName(event.target.value));
                }
              }}
            />
            {nameError ? (
              <span role="alert" className="settings-field__error">
                {nameError}
              </span>
            ) : null}
          </label>

          <label className="settings-field">
            <span>{messages.settings.scope}</span>
            <select
              aria-label="Scope"
              className="settings-input"
              value={scope}
              onChange={(event) => {
                const nextScope = event.target.value as ProjectLabelScope;
                setScope(nextScope);
                setSkills([]);
                if (
                  agentProfileId !== "none" &&
                  !profiles.some((profile) => {
                    if (String(profile.id) !== agentProfileId) {
                      return false;
                    }
                    if (nextScope === "global") {
                      return profile.scope === "global";
                    }
                    return profile.scope === "global" || profile.projectId === projectId;
                  })
                ) {
                  setAgentProfileId("none");
                  setWorkflowSkill("");
                }
              }}
            >
              <option value="project">{messages.settings.projectScope}</option>
              <option value="global">{messages.settings.globalScope}</option>
            </select>
          </label>

          <label className="settings-field">
            <span>{messages.settings.color}</span>
            <input
              aria-label="Color"
              className="settings-input settings-label-form__color-input"
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value.toUpperCase())}
            />
            <div className="settings-label-form__presets" aria-label="Color presets">
              {PRESET_COLORS.map((presetColor) => (
                <button
                  key={presetColor}
                  type="button"
                  className="settings-label-form__preset"
                  aria-label={presetColor}
                  style={{ backgroundColor: presetColor }}
                  onClick={() => setColor(presetColor)}
                />
              ))}
            </div>
          </label>

          <label className="settings-field">
            <span>{messages.settings.agent}</span>
            <select
              aria-label="Agent"
              className="settings-input"
              value={agentProfileId}
              onChange={(event) => {
                const nextValue = event.target.value;
                setAgentProfileId(nextValue);
                setWorkflowSkill("");
                setSkills([]);
              }}
            >
              <option value="none">{messages.settings.none}</option>
              {selectableProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>

          {hasSelectedAgent && hasWorkflowSkills ? (
            <label className="settings-field">
              <span>{messages.settings.workflowSkill}</span>
              <select
                aria-label="Workflow Skill"
                className="settings-input"
                disabled={isLoadingSkills}
                value={workflowSkill}
                onChange={(event) => setWorkflowSkill(event.target.value)}
              >
                <option value="">{messages.settings.none}</option>
                {skills.map((skill) => (
                  <option key={skill.path} value={skill.name}>
                    {skill.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {statusMessage ? (
          <p className="issue-dialog__status" role="status" aria-label="Label status">
            {statusMessage}
          </p>
        ) : null}

        <div className="issue-dialog__footer issue-dialog__footer--end">
          <button
            className="issues-button issues-button--primary"
            type="submit"
            disabled={isSaving}
          >
            {isSaving ? messages.settings.saving : messages.settings.save}
          </button>
        </div>
      </form>
    </div>
  );
}
