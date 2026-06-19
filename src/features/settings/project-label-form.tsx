import { useMemo, useState, type FormEvent } from "react";

import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useI18n } from "../../shared/i18n/i18n";
import { toCommandError } from "../../shared/commands/command-error";
import {
  saveProjectLabel,
  type AgentProfileRecord,
  type ProjectLabelRecord,
  type ProjectLabelScope,
} from "./settings-commands";
import { parseDefaultSkills } from "./agent-profile-skills";

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
  const [scope, setScope] = useState<ProjectLabelScope>(
    label?.scope ?? "global",
  );
  const [color, setColor] = useState(label?.color ?? PRESET_COLORS[0]);
  const [agentProfileId, setAgentProfileId] = useState<string>(
    label?.agentProfileId ? String(label.agentProfileId) : "none",
  );
  const [workflowSkill, setWorkflowSkill] = useState(
    label?.workflowSkill ?? "",
  );
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
    selectableProfiles.find(
      (profile) => String(profile.id) === agentProfileId,
    ) ?? null;
  const hasSelectedAgent = selectedProfile !== null;
  const availableWorkflowSkills = useMemo(
    () =>
      selectedProfile ? parseDefaultSkills(selectedProfile.defaultSkill) : [],
    [selectedProfile],
  );
  const hasWorkflowSkills = availableWorkflowSkills.length > 0;
  const selectedWorkflowSkill = availableWorkflowSkills.includes(workflowSkill)
    ? workflowSkill
    : "";

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
          hasSelectedAgent &&
          hasWorkflowSkills &&
          selectedWorkflowSkill.trim().length > 0
            ? selectedWorkflowSkill
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
          <div className="grid gap-1.5">
            <Label
              htmlFor="label-name"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.name}
            </Label>
            <Input
              id="label-name"
              aria-label="Name"
              autoCapitalize="none"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError !== null) {
                  setNameError(validateName(event.target.value));
                }
              }}
            />
            {nameError ? (
              <span role="alert" className="text-xs text-destructive">
                {nameError}
              </span>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label
              htmlFor="label-scope"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.scope}
            </Label>
            <Select
              items={[
                { value: "project", label: messages.settings.projectScope },
                { value: "global", label: messages.settings.globalScope },
              ]}
              value={scope}
              onValueChange={(value) => {
                const nextScope = value as ProjectLabelScope;
                setScope(nextScope);
                if (
                  agentProfileId !== "none" &&
                  !profiles.some((profile) => {
                    if (String(profile.id) !== agentProfileId) {
                      return false;
                    }
                    if (nextScope === "global") {
                      return profile.scope === "global";
                    }
                    return (
                      profile.scope === "global" ||
                      profile.projectId === projectId
                    );
                  })
                ) {
                  setAgentProfileId("none");
                  setWorkflowSkill("");
                }
              }}
            >
              <SelectTrigger
                id="label-scope"
                aria-label="Scope"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">
                  {messages.settings.projectScope}
                </SelectItem>
                <SelectItem value="global">
                  {messages.settings.globalScope}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label
              htmlFor="label-color"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.color}
            </Label>
            <input
              id="label-color"
              aria-label="Color"
              className="settings-input settings-label-form__color-input"
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value.toUpperCase())}
            />
            <div
              className="settings-label-form__presets"
              aria-label="Color presets"
            >
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
          </div>

          <div className="grid gap-1.5">
            <Label
              htmlFor="label-agent"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.agent}
            </Label>
            <Select
              items={[
                { value: "none", label: messages.settings.none },
                ...selectableProfiles.map((profile) => ({
                  value: String(profile.id),
                  label: profile.name,
                })),
              ]}
              value={agentProfileId}
              onValueChange={(value) => {
                setAgentProfileId(value as string);
                setWorkflowSkill("");
              }}
            >
              <SelectTrigger
                id="label-agent"
                aria-label="Agent"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{messages.settings.none}</SelectItem>
                {selectableProfiles.map((profile) => (
                  <SelectItem key={profile.id} value={String(profile.id)}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hasSelectedAgent && hasWorkflowSkills ? (
            <div className="grid gap-1.5">
              <Label
                htmlFor="label-workflow-skill"
                className="text-xs text-muted-foreground"
              >
                {messages.settings.workflowSkill}
              </Label>
              <Select
                items={[
                  { value: "", label: messages.settings.none },
                  ...availableWorkflowSkills.map((skillName) => ({
                    value: skillName,
                    label: skillName,
                  })),
                ]}
                value={selectedWorkflowSkill}
                onValueChange={(value) => setWorkflowSkill(value as string)}
              >
                <SelectTrigger
                  id="label-workflow-skill"
                  aria-label="Workflow Skill"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{messages.settings.none}</SelectItem>
                  {availableWorkflowSkills.map((skillName) => (
                    <SelectItem key={skillName} value={skillName}>
                      {skillName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        {statusMessage ? (
          <p
            className="issue-dialog__status"
            role="status"
            aria-label="Label status"
          >
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
