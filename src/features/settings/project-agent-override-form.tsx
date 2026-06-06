import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  saveProjectAgentOverride,
  type AgentProfileRecord,
  type ProjectAgentOverrideRecord,
} from "./settings-commands";
import { toCommandError } from "../../shared/commands/command-error";

interface ProjectAgentOverrideFormProps {
  projectId: number;
  profile: AgentProfileRecord;
  override?: ProjectAgentOverrideRecord;
  onSaved: (override: ProjectAgentOverrideRecord) => void;
}

export function ProjectAgentOverrideForm({
  onSaved,
  override,
  profile,
  projectId,
}: ProjectAgentOverrideFormProps) {
  const [defaultArgsText, setDefaultArgsText] = useState(() =>
    (override?.defaultArgs ?? profile.defaultArgs).join("\n"),
  );
  const [defaultSkill, setDefaultSkill] = useState(
    () => override?.defaultSkill ?? profile.defaultSkill,
  );
  const [promptTemplate, setPromptTemplate] = useState(
    () => override?.promptTemplate ?? profile.promptTemplate,
  );
  const [enabled, setEnabled] = useState(
    () => override?.enabled ?? profile.enabled,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setIsSaving(true);
    setStatusMessage(null);

    try {
      const savedOverride = await saveProjectAgentOverride({
        projectId,
        agentProfileId: profile.id,
        defaultArgs: toArgsArray(defaultArgsText),
        defaultSkill,
        promptTemplate,
        enabled,
      });
      onSaved(savedOverride);
      setStatusMessage("Project override saved.");
    } catch (error: unknown) {
      setStatusMessage(toCommandError(error).message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="settings-card">
      <div className="settings-card__header">
        <div>
          <h4>{profile.name}</h4>
          <p>{profile.command}</p>
        </div>
        <span className="settings-chip">
          {override ? "Project override" : "Inherited"}
        </span>
      </div>

      <label className="settings-field">
        <span>Default args</span>
        <textarea
          aria-label={`Default args for ${profile.name}`}
          className="settings-textarea"
          rows={3}
          value={defaultArgsText}
          onChange={(event) => setDefaultArgsText(event.target.value)}
        />
      </label>

      <label className="settings-field">
        <span>Default skill</span>
        <input
          aria-label={`Default skill for ${profile.name}`}
          className="settings-input"
          value={defaultSkill}
          onChange={(event) => setDefaultSkill(event.target.value)}
        />
      </label>

      <label className="settings-field">
        <span>Prompt template</span>
        <textarea
          aria-label={`Prompt template for ${profile.name}`}
          className="settings-textarea"
          rows={5}
          value={promptTemplate}
          onChange={(event) => setPromptTemplate(event.target.value)}
        />
      </label>

      <label className="settings-checkbox">
        <input
          aria-label={`Enabled override for ${profile.name}`}
          checked={enabled}
          type="checkbox"
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>Enabled for this project</span>
      </label>

      <p
        className="settings-status"
        role="status"
        aria-label={`Project override status for ${profile.name}`}
      >
        {statusMessage}
      </p>

      <Button
        className="issues-button issues-button--primary settings-save-button"
        type="button"
        disabled={isSaving}
        onClick={handleSave}
      >
        {isSaving ? "Saving..." : "Save override"}
      </Button>
    </section>
  );
}

function toArgsArray(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
